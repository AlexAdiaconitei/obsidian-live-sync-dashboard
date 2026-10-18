#!/usr/bin/env bash
set -euo pipefail
version="${1:?usage: changelog-section.sh <version> [file]}"
file="${2:-CHANGELOG.md}"
awk -v version="$version" '
  /^## \[/ {
    heading = $0
    sub(/^## \[/, "", heading)
    sub(/\].*$/, "", heading)
    collecting = (heading == version)
    if (collecting) count++
    next
  }
  collecting { body = body $0 "\n"; if ($0 ~ /[^[:space:]]/) nonempty = 1 }
  END {
    if (count != 1 || !nonempty) {
      print "Expected one nonempty exact changelog section" > "/dev/stderr"
      exit 1
    }
    sub(/^\n+/, "", body)
    printf "%s", body
  }
' "$file"
