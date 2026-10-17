#!/usr/bin/env bash
set -euo pipefail
image="${1:?usage: smoke-image.sh <panel-image>}"
name="livesync-smoke-$$"
database="$name-couchdb"
cleanup() { docker rm -f "$name" "$database" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$database" -e COUCHDB_USER=smoke-admin -e COUCHDB_PASSWORD=smoke-password couchdb:3.5.2 >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$database" bash -c ':> /dev/tcp/127.0.0.1/5984' 2>/dev/null; then break; fi
  sleep 1
done
docker run -d --name "$name" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --network "container:$database" \
  --tmpfs /tmp:size=16m,mode=1777 \
  --tmpfs /backup/status:size=1m,uid=1000,gid=1000,mode=0770 \
  --tmpfs /backup/requests:size=1m,uid=1000,gid=1000,mode=0770 \
  -e COUCHDB_URL=http://127.0.0.1:5984 \
  -e COUCHDB_USER=smoke-admin -e COUCHDB_PASSWORD=smoke-password \
  -e PUBLIC_COUCHDB_URL=https://notes.example.ts.net \
  -e PUBLIC_ADMIN_URL=https://notes.example.ts.net:8443 \
  -e PUBLIC_SETUP_URL=https://notes.example.ts.net:9443 \
  -e PANEL_ADMINS=admin@example.com \
  -e PANEL_CSRF_SECRET=smoke-only-random-secret-at-least-32-characters \
  -e INSTANCE_QUOTA_GIB=100 -e DEFAULT_USER_QUOTA_GIB=5 \
  -e BACKUP_STATE_DIR=/backup/status -e BACKUP_REQUESTS_DIR=/backup/requests \
  "$image" >/dev/null
for attempt in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$name")
  if [[ "$state" == healthy ]]; then break; fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]]; then
    docker logs "$name"
    exit 1
  fi
  sleep 1
done
[[ "$state" == healthy ]] || { docker logs "$name"; exit 1; }
docker exec "$name" node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { spawnSync } from "node:child_process";
  if (process.getuid() === 0) throw Error("Root runtime");
  const command = readFileSync("/proc/1/cmdline", "utf8").split("\0").filter(Boolean);
  if (!command.includes("--permission")) throw Error("Runtime permissions disabled");
  const probe = spawnSync(process.execPath, [...command.slice(1, -1), "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
    assert.ok(readFileSync("/app/dist/app.css").length);
    assert.throws(() => readFileSync("/etc/passwd"), { code: "ERR_ACCESS_DENIED" });
    assert.equal(process.permission.has("fs.write", "/app"), false);
    assert.equal(process.permission.has("fs.write", "/backup/requests/request.json"), true);
    writeFileSync("/backup/requests/.probe.tmp", "probe", { flag: "wx", mode: 0o660 });
    renameSync("/backup/requests/.probe.tmp", "/backup/requests/probe.json");
    assert.equal(readFileSync("/backup/requests/probe.json", "utf8"), "probe");
    unlinkSync("/backup/requests/probe.json");
    for (const scope of ["child", "worker", "addons"]) {
      assert.equal(process.permission.has(scope), false);
    }
  `], { encoding: "utf8" });
  if (probe.status !== 0) throw Error(`Permission probe failed: ${probe.stderr}`);
  for (const port of [8080, 8081, 8082]) {
    const response = await fetch(`http://127.0.0.1:${port}/`, {redirect:"manual"});
    if (!(port === 8081 ? response.status === 303 && response.headers.get("location") === "/login" : [401,403].includes(response.status))) throw Error("Identity missing but access allowed");
    await response.body?.cancel();
  }
  const ready = await fetch("http://127.0.0.1:8080/health/ready");
  if (ready.status !== 200) throw Error("Readiness must include initialized CouchDB");
  await ready.body?.cancel();
  const asset = await fetch("http://127.0.0.1:8080/assets/app.css", {headers: {"Tailscale-User-Login":"admin@example.com"}});
  if (!asset.ok) throw Error("Local stylesheet unavailable");
  await asset.body?.cancel();
'
docker exec "$database" bash -c 'kill -TERM $(pgrep -o beam.smp)'
sleep 1
docker exec "$name" node --input-type=module -e '
  const live = await fetch("http://127.0.0.1:8080/health/live");
  if (!live.ok) throw Error("Process must stay healthy after dependency loss");
  await live.body?.cancel();
  const ready = await fetch("http://127.0.0.1:8080/health/ready");
  if (ready.status !== 503) throw Error("Readiness must fail after CouchDB loss");
  await ready.body?.cancel();
'
