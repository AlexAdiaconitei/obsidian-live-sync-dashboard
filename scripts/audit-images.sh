#!/usr/bin/env bash
set -euo pipefail
panel="${1:?usage: audit-images.sh <panel-image> <worker-image>}"
worker="${2:?usage: audit-images.sh <panel-image> <worker-image>}"
scanner='aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa'
export MSYS_NO_PATHCONV=1
mkdir -p .local
scan_workspace=$(mktemp -d "$PWD/.local/image-audit.XXXXXXXX")
cleanup() {
  rm -f "$scan_workspace/panel.tar" "$scan_workspace/worker.tar"
  rmdir "$scan_workspace" 2>/dev/null || true
}
trap cleanup EXIT
mount_directory=$scan_workspace
if command -v cygpath >/dev/null 2>&1; then mount_directory=$(cygpath -w "$scan_workspace"); fi
docker image save --output "$mount_directory/panel.tar" "$panel"
docker image save --output "$mount_directory/worker.tar" "$worker"
# The scanner drops DAC override capabilities and may run as a different UID.
chmod 755 "$scan_workspace"
chmod 644 "$scan_workspace/panel.tar" "$scan_workspace/worker.tar"
for image in panel worker; do
  docker run --rm --cap-drop ALL --security-opt no-new-privileges \
    --mount "type=bind,source=$mount_directory,target=/scan,readonly" \
    --mount type=volume,source=livesync-audit-trivy-cache,target=/root/.cache \
    "$scanner" image --quiet --scanners vuln --severity MEDIUM,HIGH,CRITICAL \
    --format template \
    --template '{{range .}}{{ $target := .Target }}{{range .Vulnerabilities}}{{printf "%s %s %s %s %s\n" $target .VulnerabilityID .Severity .PkgName .InstalledVersion}}{{end}}{{end}}' \
    --exit-code 1 --input "/scan/$image.tar"
  printf '%s\n' "$image image vulnerability check passed."
done
