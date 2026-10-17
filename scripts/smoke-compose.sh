#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
project="livesync-compose-smoke-$$"
mkdir -p .local
fixture=$(mktemp -d .local/compose-smoke.XXXXXXXX)
compose_file="${3:-deploy/compose.yml}"
environment_file=deploy/.env.example
build_flag=--no-build
if [[ "$compose_file" == *dokploy* ]]; then
  environment_file=deploy/.env.dokploy.example
  build_flag=--build
fi
export PANEL_IMAGE="${1:?usage: smoke-compose.sh <panel-image> <backup-image>}"
export BACKUP_IMAGE="${2:?usage: smoke-compose.sh <panel-image> <backup-image>}"
export PANEL_PULL_POLICY=never BACKUP_PULL_POLICY=never
export TS_AUTHKEY=smoke-only-not-a-real-key TS_HOSTNAME=smoke
export TS_FQDN=smoke.example.ts.net
export COUCHDB_USER=compose-smoke-admin COUCHDB_PASSWORD=compose-smoke-password-long
export PANEL_CSRF_SECRET=compose-smoke-only-secret-at-least-32-characters
export RCLONE_REMOTE=fixture:/work/remote
export RCLONE_CONF_B64
RCLONE_CONF_B64=$(printf '[fixture]\ntype = local\n' | base64 | tr -d '\r\n')
export AGE_RECIPIENT
AGE_RECIPIENT=$(docker run --rm --entrypoint sh "$BACKUP_IMAGE" -c \
  'age-keygen -o /tmp/key 2>/dev/null && age-keygen -y /tmp/key')
cat > "$fixture/override.yml" <<'YAML'
services:
  panel:
    pull_policy: never
  backup:
    pull_policy: never
  ts:
    entrypoint: ["/bin/sh", "-c", "exec sleep 86400"]
    healthcheck:
      test: ["CMD", "true"]
      interval: 1s
      start_period: 0s
YAML
compose=(docker compose -p "$project" --env-file "$environment_file" -f "$compose_file" -f "$fixture/override.yml")
cleanup() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -f "$fixture/override.yml" "$fixture/raw.yml" "$fixture/rendered.yml"
  rmdir "$fixture" 2>/dev/null || true
}
trap cleanup EXIT
docker compose --env-file deploy/.env.example -f deploy/compose.yml config --quiet
docker compose --env-file deploy/.env.example -f deploy/compose.existing.yml config --quiet
docker compose --env-file deploy/.env.example -f deploy/compose.yml -f deploy/compose.homelab.yml config --quiet
docker compose --env-file deploy/.env.dokploy.example -f deploy/compose.dokploy.yml config --quiet
docker compose --env-file deploy/.env.dokploy.example -f deploy/compose.dokploy.existing.yml config --quiet
docker compose --env-file deploy/.env.dokploy.example -f deploy/compose.dokploy.yml -f deploy/compose.homelab.yml config --quiet
"${compose[@]}" up -d "$build_flag" --wait --wait-timeout 120
probe() {
  "${compose[@]}" exec -T panel node --input-type=module -e '
    import assert from "node:assert/strict";
    import { accessSync, constants, readFileSync, writeFileSync, unlinkSync } from "node:fs";
    assert.equal(process.getuid(), 1000);
    const headers = { Authorization: "Basic " + Buffer.from(process.env.COUCHDB_USER + ":" + process.env.COUCHDB_PASSWORD).toString("base64") };
    const ready = await fetch("http://127.0.0.1:8080/health/ready");
    assert.equal(ready.status, 200);
    await ready.body?.cancel();
    for (const db of ["_users", "_replicator", process.env.PANEL_DB]) {
      const response = await fetch("http://127.0.0.1:5984/" + db, { headers });
      assert.equal(response.status, 200, db);
      await response.body?.cancel();
    }
    for (const port of [8080, 8081, 8082]) {
      const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      assert.ok(port === 8081 ? response.status === 303 && response.headers.get("location") === "/login" : [401, 403].includes(response.status));
      await response.body?.cancel();
    }
    accessSync("/backup/requests", constants.W_OK);
    writeFileSync("/backup/requests/.compose-probe", "ok");
    unlinkSync("/backup/requests/.compose-probe");
    assert.equal(JSON.parse(readFileSync("/backup/status/status.json", "utf8")).schemaVersion, 1);
  '
  "${compose[@]}" exec -T ts sh -c 'grep -F '\''${TS_CERT_DOMAIN}:443'\'' /config/serve.json >/dev/null'
  "${compose[@]}" exec -T couchdb bash -c 'grep -F "bind_address = 127.0.0.1" /opt/couchdb/etc/local.d/10-livesync.ini >/dev/null'
  diff <(tr -d '\r' < deploy/tailscale/serve.json) <("${compose[@]}" exec -T ts cat /config/serve.json)
  diff <(tr -d '\r' < deploy/couchdb/livesync.ini) <("${compose[@]}" exec -T couchdb cat /config/livesync.ini)
  for service in ts couchdb panel backup; do
    id=$("${compose[@]}" ps -q "$service")
    [[ $(docker inspect --format '{{json .HostConfig.PortBindings}}' "$id") == '{}' ]]
  done
  if "${compose[@]}" exec -T backup timeout 2 bash -c ':> /dev/tcp/ts/5984' 2>/dev/null; then
    echo 'CouchDB is reachable outside the sidecar loopback' >&2
    exit 1
  fi
}
probe
"${compose[@]}" exec -T ts sh -c 'echo persistent > /var/lib/tailscale/compose-smoke'
"${compose[@]}" exec -T panel node --input-type=module -e '
  const url = "http://127.0.0.1:5984/" + process.env.PANEL_DB + "/_local/compose-smoke";
  const headers = { Authorization: "Basic " + Buffer.from(process.env.COUCHDB_USER + ":" + process.env.COUCHDB_PASSWORD).toString("base64"), "Content-Type": "application/json" };
  const response = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ persists: true }) });
  if (!response.ok) throw Error("Cannot seed persistence probe");
  await response.body?.cancel();
'
"${compose[@]}" exec -T backup backup.sh --manual
cp "$compose_file" "$fixture/raw.yml"
docker compose -p "$project" --env-file "$environment_file" -f "$fixture/raw.yml" -f "$fixture/override.yml" \
  config > "$fixture/rendered.yml"
docker compose -p "$project" --env-file "$environment_file" -f "$fixture/rendered.yml" \
  up -d --no-build --force-recreate --wait --wait-timeout 120
probe
"${compose[@]}" exec -T ts sh -c 'test "$(cat /var/lib/tailscale/compose-smoke)" = persistent'
"${compose[@]}" exec -T panel node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  const headers = { Authorization: "Basic " + Buffer.from(process.env.COUCHDB_USER + ":" + process.env.COUCHDB_PASSWORD).toString("base64") };
  const response = await fetch("http://127.0.0.1:5984/" + process.env.PANEL_DB + "/_local/compose-smoke", { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).persists, true);
  assert.ok(JSON.parse(readFileSync("/backup/status/status.json", "utf8")).lastSuccess);
'
"${compose[@]}" exec -T backup bash -c 'test -s /config/rclone/rclone.conf && test -n "$(find /work/remote -name "*.age" -print -quit)"'
echo 'Compose smoke passed: boot, permissions, encrypted backup, relocated Raw config and persistent recreation.'
echo 'Tailscale login is replaced by an isolated namespace fixture; no real tailnet or Dokploy server was contacted.'
