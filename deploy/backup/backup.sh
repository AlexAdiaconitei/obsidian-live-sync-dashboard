#!/usr/bin/env bash
set -euo pipefail
umask 027
exec 9>/run/worker/backup.lock
flock -n 9 || exit 75
mkdir -p /work
find /work -maxdepth 1 -type f -name 'obsidian-couchdb-*.tar.gz.age' -delete
config=/run/worker/config.json
state=/backup/status/status.json
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
atomic_state() {
  chown 1000:1000 /backup/status/.status.tmp
  chmod 640 /backup/status/.status.tmp
  mv /backup/status/.status.tmp "$state"
}
jq --slurpfile config "$config" '.schedule=$config[0].schedule |
  .timezone=$config[0].timezone | .retentionDays=$config[0].retentionDays' "$state" > /backup/status/.status.tmp
atomic_state
save_run() {
  local item=$1
  jq --argjson item "$item" '.running=null | .lastAttempt=$item |
    (if $item.outcome == "success" then .lastSuccess=$item else . end) |
    .history=([$item] + .history | .[:32])' "$state" > /backup/status/.status.tmp
  atomic_state
  printf '%s\n' "$item" > "/backup/status/completed/$(jq -r '.requestId' <<< "$item").json"
}
running=$(jq -c '.running' "$state")
if [[ "$running" != null ]]; then
  interrupted=$(jq -c --arg at "$(now)" '.outcome="failure" | .endedAt=$at | .error="interrupted"' <<< "$running")
  save_run "$interrupted"
fi
[[ "${1:-}" != --recover ]] || exit 0
request_file=''
if [[ "${1:-}" == --request ]]; then
  request_file="${2:?request path required}"
  [[ "$request_file" =~ ^/backup/requests/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$ && ! -L "$request_file" ]] || exit 1
  [[ -f "$request_file" ]] || exit 0
  if [[ $(stat -c %s "$request_file") -gt 4096 ]] || ! jq -e '
    type == "object" and .schemaVersion == 1 and
    (.requestId | type == "string" and test("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")) and
    (.actor | type == "string" and length > 0 and length <= 254 and (test("[\\x00-\\x1f\\x7f]") | not)) and
    (.requestedAt | type == "string" and test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$"))
    ' "$request_file" >/dev/null 2>&1; then
    rm -f "$request_file"
    echo 'backup: rejected invalid request' >&2
    exit 1
  fi
  id=$(jq -r .requestId "$request_file")
  [[ "$request_file" == "/backup/requests/$id.json" ]] || { rm -f "$request_file"; exit 1; }
  actor=$(jq -r .actor "$request_file")
  trigger=manual
else
  [[ "${1:---manual}" == --manual || "${1:-}" == --cron ]] || exit 1
  id=$(cat /proc/sys/kernel/random/uuid)
  actor=worker
  trigger=manual
  [[ "${1:-}" != --cron ]] || trigger=cron
fi
if [[ -f "/backup/status/completed/$id.json" ]] || jq -e --arg id "$id" \
  '(.history + [.lastAttempt,.lastSuccess]) | any(. != null and .requestId == $id and .outcome != "running")' "$state" >/dev/null; then
  [[ -z "$request_file" ]] || rm -f "$request_file"
  exit 0
fi
run=$(jq -cn --arg id "$id" --arg actor "$actor" --arg trigger "$trigger" --arg at "$(now)" \
  '{requestId:$id,actor:$actor,trigger:$trigger,startedAt:$at,endedAt:null,outcome:"running",file:null,sizeBytes:null,error:null,uploadOk:false,retentionOk:false,notificationOk:false}')
jq --argjson run "$run" '.running=$run | .lastAttempt=$run' "$state" > /backup/status/.status.tmp
atomic_state
file="obsidian-couchdb-$(date -u +%Y%m%dT%H%M%SZ)-$id.tar.gz.age"
archive="/work/$file"
stage=archive_failed
cleanup() {
  exit_code=$?
  trap - EXIT
  if [[ $exit_code != 0 ]]; then
    run=$(jq -c --arg at "$(now)" --arg error "$stage" '.outcome="failure" | .endedAt=$at | .error=$error' <<< "$run")
  fi
  save_run "$run"
  [[ -z "$request_file" ]] || rm -f "$request_file"
  rm -f "$archive"
  # A 30-day deduplication ledger is separate from the 32 visible attempts.
  find /backup/status/completed -type f -name '*.json' -mtime +30 -delete
  echo "backup: $(jq -r '.outcome' <<< "$run") $id"
  exit "$exit_code"
}
trap cleanup EXIT
recipient=$(jq -r .recipient "$config")
remote=$(jq -r .remote "$config")
retention=$(jq -r .retentionDays "$config")
export RCLONE_CONFIG=/config/rclone/rclone.conf
export TZ
TZ=$(jq -r .timezone "$config")
[[ -n "$(find /data -type f -name '*.couch' -print -quit)" ]]
# CouchDB keeps writing while the archive is made. GNU tar exits 1 when a file changed or a
# compaction file disappeared during the read; only exit 2 or more is a failed archive.
archive_data() {
  local script='{ tar -C /data -czf - . || [[ $? == 1 ]]; } | age -r "$1" -o "$2"'
  timeout 1800 bash -o pipefail -c "$script" _ "$recipient" "$archive" 2>/dev/null
}
if ! archive_data; then
  rm -f "$archive"
  archive_data
fi
size=$(stat -c %s "$archive")
[[ "$size" -gt 0 ]]
run=$(jq -c --arg file "$file" --argjson size "$size" '.file=$file | .sizeBytes=$size' <<< "$run")
stage=upload_failed
timeout 1800 rclone copyto "$archive" "$remote/$file" --retries 3 --quiet 2>/dev/null
run=$(jq -c '.uploadOk=true' <<< "$run")
stage=retention_failed
timeout 300 rclone delete "$remote" --min-age "${retention}d" --include 'obsidian-couchdb-*.tar.gz.age' --quiet 2>/dev/null
run=$(jq -c '.retentionOk=true' <<< "$run")
push=$(jq -r .push "$config")
if [[ -n "$push" ]]; then
  separator='?'
  [[ "$push" != *\?* ]] || separator='&'
  if wget -T 10 -qO /dev/null "${push}${separator}status=up&msg=OK%20${size}B" 2>/dev/null; then
    run=$(jq -c '.notificationOk=true' <<< "$run")
  fi
fi
run=$(jq -c --arg at "$(now)" '.outcome="success" | .endedAt=$at' <<< "$run")
