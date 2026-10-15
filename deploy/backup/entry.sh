#!/usr/bin/env bash
set -euo pipefail
umask 027
: "${AGE_RECIPIENT:?Set a public age recipient}"
: "${RCLONE_REMOTE:?Set rclone destination}"
schedule="${BACKUP_CRON:-30 3 * * *}"
timezone="${TZ:-UTC}"
retention="${RETENTION_DAYS:-30}"
[[ "$schedule" =~ ^[0-9*/,\ -]+$ && $(wc -w <<< "$schedule") == 5 ]] || exit 1
valid_cron_field() {
  local field=$1 minimum=$2 maximum=$3 component base step first last
  local -a components
  IFS=, read -r -a components <<< "$field"
  [[ "$field" != ,* && "$field" != *, && "$field" != *,,* ]] || return 1
  for component in "${components[@]}"; do
    [[ "$component" =~ ^(\*|[0-9]{1,2}(-[0-9]{1,2})?)(/[0-9]{1,4})?$ ]] || return 1
    base=${component%/*}
    if [[ "$component" == */* ]]; then
      step=${component##*/}
      (( 10#$step > 0 )) || return 1
    fi
    [[ "$base" != '*' ]] || continue
    first=${base%-*}
    last=${base#*-}
    first=$((10#$first))
    last=$((10#$last))
    (( first >= minimum && last <= maximum && first <= last )) || return 1
  done
}
read -r -a cron_fields <<< "$schedule"
valid_cron_field "${cron_fields[0]}" 0 59 &&
  valid_cron_field "${cron_fields[1]}" 0 23 &&
  valid_cron_field "${cron_fields[2]}" 1 31 &&
  valid_cron_field "${cron_fields[3]}" 1 12 &&
  valid_cron_field "${cron_fields[4]}" 0 6 || exit 1
[[ "$timezone" =~ ^[a-zA-Z0-9_+/-]+$ && -f "/usr/share/zoneinfo/$timezone" ]] || exit 1
[[ "$retention" =~ ^[0-9]+$ && "$retention" -ge 1 && "$retention" -le 3650 ]] || exit 1
mkdir -p /backup/requests /backup/status/completed /config/rclone /run/worker /run/cron /work
chmod 700 /work
chown 1000:1000 /backup/requests /backup/status
chmod 2770 /backup/requests
chmod 2750 /backup/status
if [[ ! -s /config/rclone/rclone.conf ]]; then
  : "${RCLONE_CONF_B64:?Set seed rclone config or provide persistent config}"
  printf '%s' "$RCLONE_CONF_B64" | base64 -d > /config/rclone/rclone.conf
  chmod 600 /config/rclone/rclone.conf
fi
jq -n --arg recipient "$AGE_RECIPIENT" --arg remote "$RCLONE_REMOTE" \
  --arg schedule "$schedule" --arg timezone "$timezone" --arg push "${PUSH_URL:-}" \
  --argjson retention "$retention" \
  '{recipient:$recipient,remote:$remote,schedule:$schedule,timezone:$timezone,push:$push,retentionDays:$retention}' \
  > /run/worker/config.json
chmod 600 /run/worker/config.json
exec 9>/run/worker/backup.lock
flock 9
if [[ ! -f /backup/status/status.json ]]; then
  jq '{schemaVersion:1,running:null,lastAttempt:null,lastSuccess:null,history:[],schedule,timezone,retentionDays}' \
    /run/worker/config.json > /backup/status/.initial.tmp
  chown 1000:1000 /backup/status/.initial.tmp
  chmod 640 /backup/status/.initial.tmp
  mv /backup/status/.initial.tmp /backup/status/status.json
else
  jq --arg schedule "$schedule" --arg timezone "$timezone" --argjson retention "$retention" \
    '.schedule=$schedule | .timezone=$timezone | .retentionDays=$retention' \
    /backup/status/status.json > /backup/status/.metadata.tmp
  chown 1000:1000 /backup/status/.metadata.tmp
  chmod 640 /backup/status/.metadata.tmp
  mv /backup/status/.metadata.tmp /backup/status/status.json
fi
flock -u 9
exec 9>&-
printf '%s /usr/local/bin/backup.sh --cron\n' "$schedule" > /run/cron/root
export TZ="$timezone"
crond -f -l 8 -c /run/cron &
cron_pid=$!
trap 'kill "$cron_pid" 2>/dev/null || true; exit 0' TERM INT
while kill -0 "$cron_pid" 2>/dev/null; do
  backup.sh --recover || [[ $? == 75 ]]
  for request in /backup/requests/*.json; do
    [[ -f "$request" ]] || continue
    backup.sh --request "$request" || true
  done
  sleep 5 & wait $! || true
done
exit 1
