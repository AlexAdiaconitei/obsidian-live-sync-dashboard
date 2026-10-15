#!/usr/bin/env bash
set -euo pipefail
image="${1:?usage: test-worker.sh <worker-image>}"
docker run --rm -i --entrypoint bash "$image" -s <<'TEST'
set -euo pipefail
mkdir -p /data /dest /backup/status/completed /backup/requests /run/worker /config/rclone
dd if=/dev/urandom of=/data/fixture.couch bs=1024 count=32 status=none
recipient=$(age-keygen -o /tmp/disposable-test-key.txt 2>&1 | sed -n 's/^Public key: //p')
printf '%s\n' '[local]' 'type = local' > /config/rclone/rclone.conf
jq -n --arg recipient "$recipient" '{recipient:$recipient,remote:"/dest",schedule:"30 3 * * *",timezone:"UTC",retentionDays:30,push:""}' > /run/worker/config.json
jq '{schemaVersion:1,running:null,lastAttempt:null,lastSuccess:null,history:[],schedule,timezone,retentionDays}' /run/worker/config.json > /backup/status/status.json
backup.sh --manual
jq -e '.lastAttempt.outcome == "success" and .lastSuccess.uploadOk and .lastSuccess.retentionOk and .running == null' /backup/status/status.json
file=$(jq -r '.lastSuccess.file' /backup/status/status.json)
age -d -i /tmp/disposable-test-key.txt "/dest/$file" | tar -xzO ./fixture.couch > /tmp/restored.couch
cmp /data/fixture.couch /tmp/restored.couch
id=$(jq -r '.lastAttempt.requestId' /backup/status/status.json)
# Recovery also deduplicates a finalized status if termination preceded ledger creation.
rm -f "/backup/status/completed/$id.json"
jq -n --arg id "$id" '{schemaVersion:1,requestId:$id,actor:"admin@example.com",requestedAt:"2026-10-07T00:00:00Z"}' > "/backup/requests/$id.json"
backup.sh --request "/backup/requests/$id.json"
jq -e '.history | length == 1' /backup/status/status.json
[[ ! -f "/backup/requests/$id.json" ]]
id=$(cat /proc/sys/kernel/random/uuid)
jq -n --arg id "$id" '{schemaVersion:1,requestId:$id,actor:"admin@example.com",requestedAt:"2026-10-07T00:00:00Z"}' > "/backup/requests/$id.json"
flock /run/worker/backup.lock sleep 3 &
lock_pid=$!
sleep 0.2
set +e
backup.sh --request "/backup/requests/$id.json"
result=$?
set -e
[[ "$result" == 75 && -f "/backup/requests/$id.json" ]]
wait "$lock_pid"
backup.sh --request "/backup/requests/$id.json"
jq -e '.history | length == 2' /backup/status/status.json
jq '.recipient="invalid-age-recipient"' /run/worker/config.json > /run/worker/config.tmp
mv /run/worker/config.tmp /run/worker/config.json
if backup.sh --manual; then exit 1; fi
jq -e '.lastAttempt.error == "archive_failed" and .lastAttempt.outcome == "failure" and .lastSuccess.outcome == "success"' /backup/status/status.json
jq '.running=.lastSuccess | .running.outcome="running" | .running.endedAt=null' /backup/status/status.json > /backup/status/status.tmp
mv /backup/status/status.tmp /backup/status/status.json
backup.sh --recover
jq -e '.running == null and .lastAttempt.error == "interrupted"' /backup/status/status.json
id=$(cat /proc/sys/kernel/random/uuid)
printf '%s' '{malformed JSON}' > "/backup/requests/$id.json"
if backup.sh --request "/backup/requests/$id.json"; then exit 1; fi
[[ ! -f "/backup/requests/$id.json" ]]
# Treat shell-looking actor values as literal data.
id=$(cat /proc/sys/kernel/random/uuid)
jq -n --arg id "$id" '{schemaVersion:1,requestId:$id,actor:"$(touch /tmp/request-executed)",requestedAt:"2026-10-07T00:00:00Z"}' > "/backup/requests/$id.json"
backup.sh --request "/backup/requests/$id.json" || true
[[ ! -f /tmp/request-executed ]]
jq '.remote="/dev/null/not-a-directory"' /run/worker/config.json > /run/worker/config.tmp
mv /run/worker/config.tmp /run/worker/config.json
jq --arg recipient "$recipient" '.recipient=$recipient' /run/worker/config.json > /run/worker/config.tmp
mv /run/worker/config.tmp /run/worker/config.json
if backup.sh --manual; then exit 1; fi
jq -e '.lastAttempt.error == "upload_failed" and .lastSuccess.outcome == "success"' /backup/status/status.json
jq '.remote="/dest"' /run/worker/config.json > /run/worker/config.tmp
mv /run/worker/config.tmp /run/worker/config.json
mkdir -p /run/worker/bin
cat > /run/worker/bin/rclone <<'MOCK'
#!/bin/bash
[[ "$1" != delete ]] || exit 1
exec /usr/bin/rclone "$@"
MOCK
chmod 755 /run/worker/bin/rclone
if PATH="/run/worker/bin:$PATH" backup.sh --manual; then exit 1; fi
jq -e '.lastAttempt.error == "retention_failed" and .lastAttempt.uploadOk and (.lastAttempt.retentionOk | not)' /backup/status/status.json
jq '.push="http://127.0.0.1:1/unavailable"' /run/worker/config.json > /run/worker/config.tmp
mv /run/worker/config.tmp /run/worker/config.json
backup.sh --manual
jq -e '.lastAttempt.outcome == "success" and (.lastAttempt.notificationOk | not)' /backup/status/status.json
before=$(jq -c '{running,lastAttempt,lastSuccess,history}' /backup/status/status.json)
AGE_RECIPIENT="$recipient" RCLONE_REMOTE=/dest BACKUP_CRON='0 0 1 1 *' \
  TZ=Europe/Madrid RETENTION_DAYS=14 /usr/local/bin/entry.sh &
entry_pid=$!
trap 'kill "$entry_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if jq -e '.schedule == "0 0 1 1 *" and .timezone == "Europe/Madrid" and .retentionDays == 14' \
    /backup/status/status.json >/dev/null; then break; fi
  sleep 0.1
done
jq -e '.schedule == "0 0 1 1 *" and .timezone == "Europe/Madrid" and .retentionDays == 14' /backup/status/status.json
[[ "$before" == "$(jq -c '{running,lastAttempt,lastSuccess,history}' /backup/status/status.json)" ]]
manual_finished=false
for attempt in $(seq 1 20); do
  if backup.sh --manual; then manual_finished=true; break; else [[ $? == 75 ]]; fi
  sleep 0.1
done
[[ "$manual_finished" == true ]]
jq -e '.lastAttempt.outcome == "success" and .schedule == "0 0 1 1 *"' /backup/status/status.json
[[ -z "$(find /work -maxdepth 1 -type f -name '*.age' -print -quit)" ]]
kill "$entry_pid"
wait "$entry_pid" || true
trap - EXIT
mkdir -p /run/worker/tar-bin
cat > /run/worker/tar-bin/tar <<'MOCK'
#!/bin/bash
/bin/tar "$@" || exit
exit "$TAR_STATUS"
MOCK
chmod 755 /run/worker/tar-bin/tar
PATH="/run/worker/tar-bin:$PATH" TAR_STATUS=1 backup.sh --manual
jq -e '.lastAttempt.outcome == "success"' /backup/status/status.json
if PATH="/run/worker/tar-bin:$PATH" TAR_STATUS=2 backup.sh --manual; then exit 1; fi
jq -e '.lastAttempt.error == "archive_failed"' /backup/status/status.json
printf 'small CouchDB fixture\n' > /data/fixture.couch
backup.sh --manual
jq -e '.lastAttempt.outcome == "success" and .lastAttempt.sizeBytes < 1024' /backup/status/status.json
file=$(jq -r '.lastSuccess.file' /backup/status/status.json)
age -d -i /tmp/disposable-test-key.txt "/dest/$file" | tar -xzO ./fixture.couch > /tmp/small-restored.couch
cmp /data/fixture.couch /tmp/small-restored.couch
mv /data/fixture.couch /tmp/small-fixture.couch
if backup.sh --manual; then echo 'Empty data volume accepted' >&2; exit 1; fi
jq -e '.lastAttempt.error == "archive_failed" and .lastSuccess.outcome == "success"' /backup/status/status.json
mv /tmp/small-fixture.couch /data/fixture.couch
for schedule in '61 3 * * *' '0 24 * * *' '0 0 32 * *' '0 0 * 13 *' '0 0 * * 7' '*/0 0 * * *' '0-60 0 * * *' '5-2 0 * * *'; do
  set +e
  timeout 1 env AGE_RECIPIENT="$recipient" RCLONE_REMOTE=/dest BACKUP_CRON="$schedule" /usr/local/bin/entry.sh >/dev/null 2>&1
  result=$?
  set -e
  [[ "$result" == 1 ]] || { echo "Invalid cron schedule accepted: $schedule" >&2; exit 1; }
done
printf '%s\n' 'Worker encryption, upload, deduplication, lock, failure and recovery checks passed.'
TEST
