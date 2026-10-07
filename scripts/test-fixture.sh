#!/usr/bin/env bash
# This bootstrap is exclusively for a disposable CI/development CouchDB instance.
set -euo pipefail
url="${TEST_COUCHDB_URL:?Set disposable TEST_COUCHDB_URL}"
user="${TEST_COUCHDB_USER:?Set fixture user}"
password="${TEST_COUCHDB_PASSWORD:?Set fixture password}"
[[ "$url" =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?/?$ && "$user" == adminfixture && "$password" == fixture-password-long ]] || {
  echo 'Refusing to bootstrap anything except the documented disposable local fixture.' >&2
  exit 1
}
port="${BASH_REMATCH[2]:-:5984}"
port="${port#:}"
[[ ${#port} -le 5 && "$port" =~ ^[0-9]+$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || {
  echo 'Fixture port must be between 1 and 65535.' >&2
  exit 1
}
url="${url%/}"
curl --fail --silent --show-error --max-time 30 --user "$user:$password" \
  --header 'Content-Type: application/json' \
  --data '{"action":"enable_single_node","bind_address":"0.0.0.0","port":5984,"singlenode":true}' \
  "$url/_cluster_setup" >/dev/null
code=$(curl --silent --show-error --max-time 30 --user "$user:$password" \
  --request PUT --output /dev/null --write-out '%{http_code}' "$url/_users")
[[ "$code" == 201 || "$code" == 202 || "$code" == 412 ]] || {
  echo 'Disposable fixture _users initialization failed.' >&2
  exit 1
}
