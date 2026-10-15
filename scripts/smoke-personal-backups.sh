#!/usr/bin/env bash
set -euo pipefail
image="${1:?usage: smoke-personal-backups.sh <panel-image>}"
name="livesync-personal-smoke-$$"
database="$name-couchdb"
cleanup() { docker rm -f "$name" "$database" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$database" -e COUCHDB_USER=smoke-admin -e COUCHDB_PASSWORD=smoke-password couchdb:3.5.2 >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$database" bash -c ':> /dev/tcp/127.0.0.1/5984' 2>/dev/null; then break; fi
  sleep 1
done
docker run -d --name "$name" --read-only --cap-drop ALL --security-opt no-new-privileges \
  --network "container:$database" --tmpfs /tmp:size=16m,mode=1777 \
  --tmpfs /app/backup-work:size=16m,uid=1000,gid=1000,mode=0700 \
  -e COUCHDB_URL=http://127.0.0.1:5984 -e COUCHDB_USER=smoke-admin -e COUCHDB_PASSWORD=smoke-password \
  -e PUBLIC_COUCHDB_URL=https://notes.example.test -e PUBLIC_ADMIN_URL=https://admin.example.test \
  -e PUBLIC_SETUP_URL=https://owner.example.test -e PANEL_ADMINS=admin@example.test \
  -e PANEL_CSRF_SECRET=smoke-only-secret-at-least-32-characters \
  -e GOOGLE_DRIVE_CLIENT_ID=fixture-client -e GOOGLE_DRIVE_CLIENT_SECRET=fixture-secret \
  -e GOOGLE_DRIVE_TOKEN_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  -e PERSONAL_BACKUP_WORK_DIR=/app/backup-work "$image" >/dev/null
for attempt in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$name")
  [[ "$state" != healthy ]] || break
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
  const command = readFileSync("/proc/1/cmdline", "utf8").split("\0").filter(Boolean);
  if (!command.includes("--permission") || !command.includes("--allow-child-process")) throw Error("Missing configured permissions");
  const probe = spawnSync(process.execPath, [...command.slice(1, -1), "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
    import { spawnSync } from "node:child_process";
    import { Readable } from "node:stream";
    import { gunzipSync } from "node:zlib";
    import { ageArchive } from "/app/build/src/backup/personal.js";
    assert.notEqual(process.getuid(), 0);
    assert.equal(process.permission.has("child"), true);
    assert.equal(process.permission.has("worker"), false);
    assert.equal(process.permission.has("addons"), false);
    assert.throws(() => readFileSync("/etc/passwd"), {code:"ERR_ACCESS_DENIED"});
    assert.throws(() => writeFileSync("/app/blocked", "x"), {code:"ERR_ACCESS_DENIED"});
    const identity = spawnSync("age-keygen", [], {encoding:"utf8"});
    assert.equal(identity.status, 0);
    const recipient = spawnSync("age-keygen", ["-y"], {input:identity.stdout,encoding:"utf8"}).stdout.trim();
    const key = "/app/backup-work/disposable-identity.txt";
    const archive = "/app/backup-work/disposable.age";
    writeFileSync(key, identity.stdout, {mode:0o600});
    try {
      await ageArchive(Readable.from(["owner fixture\\n"]), recipient, archive);
      assert.equal(readFileSync(archive).includes(Buffer.from("owner fixture")), false);
      const decrypted = spawnSync("age", ["-d", "-i", key, archive]);
      assert.equal(decrypted.status, 0);
      assert.equal(gunzipSync(decrypted.stdout).toString(), "owner fixture\\n");
    } finally { unlinkSync(key); unlinkSync(archive); }
  `], {encoding:"utf8"});
  if (probe.status !== 0) throw Error(`Personal archive probe failed: ${probe.stderr}`);
'
echo 'Personal archive smoke passed with configured production permissions.'
