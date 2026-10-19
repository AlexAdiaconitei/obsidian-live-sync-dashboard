# Tests and remaining acceptance checks

`pnpm run verify` checks formatting, lint and types, then runs the Node.js tests. The CouchDB
integration tests need `TEST_COUCHDB_URL`, `TEST_COUCHDB_USER` and `TEST_COUCHDB_PASSWORD`, and are
skipped without them. The browser tests run separately with `pnpm run test:browser`, after you
build the assets and install the Playwright engines.

Test files run one at a time. The CouchDB fixtures measure usage across the whole instance, so
running them in parallel would let one test change another's measurements.

`pnpm run audit` checks the runtime and development dependencies. The CI and release jobs stop on
any advisory rated moderate or higher, before they build or publish images.

## What the suites cover

The personal Drive tests simulate Google's responses, but use real age encryption and decryption
and a real export and restore on an isolated CouchDB, with conflicts, deleted leaves and
attachments. The browser tests choose a folder, cancel, and go back to the default folder against a
stub of Google Picker, with the real owner routes and CouchDB storage. `age` and `age-keygen` must be
on PATH for the encryption tests and the full owner browser flow, and the CI and release jobs
install them. `scripts/smoke-personal-backups.sh <panel-image>` also encrypts and decrypts with age
as UID 1000 under the production Node permissions. Real Google consent, revocation, folder creation
and retention are manual checks, listed in
[Personal backups](https://alexadiaconitei.github.io/obsidian-live-sync-dashboard/docs/backups/personal/).

The Compose tests check that the optional `backup-secondary` worker starts only with its profile,
uses the primary worker's image, limits and healthcheck, and shares no status, request, work or
rclone volume with it. They are skipped without Docker Compose. CI runs no S3 server. The worker's
S3 behaviour (multipart uploads, retention and keys limited to one bucket or prefix) was checked by
hand against MinIO and Garage v2.3.

The owner onboarding tests cover separate accounts behind one shared Tailscale identity, expired
and reused invitations, session revocation, vaults created by owners, wrong sync passwords and the
.txt downloads. They decode both URI types with the official LiveSync library and use them to write
through the quota gateway to a disposable CouchDB. Two official DirectFileManipulator clients write,
read and delete notes with encryption and path obfuscation, and the test checks that the raw
database holds no plaintext notes or paths. This runs LiveSync client code, but not the Obsidian
plugin.

After you build both images, `bash scripts/audit-images.sh <panel-image> <worker-image>` scans their
OS packages and bundled dependencies with a pinned Trivy. Any medium, high or critical finding fails
the check. CI and the release workflow run it before publishing. The scanner downloads its public
vulnerability database and reads exported image archives, without the Docker socket.

## CouchDB fixture

The CI and release jobs each run a disposable CouchDB 3.5.2 at `http://127.0.0.1:15984`, with the
username `adminfixture` and the password `fixture-password-long`. These credentials exist only for
test data. Before the checks, the jobs run `scripts/test-fixture.sh`, which turns on single-node
mode and creates `_users`, following the
[CouchDB single-node setup](https://docs.couchdb.org/en/stable/setup/single-node.html). The script
and the gateway tests accept only those credentials, on the loopback hosts `127.0.0.1`, `localhost`
and `[::1]` with any port. They reject other hosts and credentials. The script is a test helper,
never part of application startup. Do not run it against production.

For local integration tests, start a new disposable container with the same values, on a free port,
with no volume shared with production data:

```sh
docker run -d --rm --name lsd-fix-couch -p 127.0.0.1:25984:5984 \
  -e COUCHDB_USER=adminfixture -e COUCHDB_PASSWORD=fixture-password-long couchdb:3.5.2
export TEST_COUCHDB_URL=http://127.0.0.1:25984
export TEST_COUCHDB_USER=adminfixture
export TEST_COUCHDB_PASSWORD=fixture-password-long
# Wait until curl --fail "$TEST_COUCHDB_URL/_up" succeeds.
bash scripts/test-fixture.sh
pnpm run verify
pnpm run build
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm run test:browser
docker stop lsd-fix-couch
```

## Browser tests

CI runs the browser tests in Chromium, Firefox and WebKit. They cover onboarding, authorization,
setup URI encryption in the browser and page layout, against the disposable CouchDB. Two local
HTTPS servers forward fixed test identities to the portals. A disposable container generates a
temporary certificate, which stays in the test process's memory. The tests use no real Tailscale
Serve endpoint, and run neither Obsidian nor the LiveSync plugin, so passing them does not prove
that sync works on Windows or iPhone.

## Manual checks before a release

Record evidence for each of these:

- The three Serve ports, the real Tailscale admin identity, owner sign-in, and the grants for shared
  users and monitors, including that unexpected identities are refused.
- Two real LiveSync devices syncing notes and attachments in the same vault. Note the plugin and
  Obsidian versions on Windows and iPhone.
- A restore on an isolated server of `_users`, `_security`, the registry, the vault identities and
  the decrypted notes.
- The target workload of 20 people and 100 vaults, with real attachments, backup duration and disk
  use.
- An upgrade from the previous release, and a rollback to a version with a compatible schema.
- User and instance quotas through the sync gateway, concurrent writes to several vaults,
  attachments and live conflicts, rejection of direct writes, and recovery of an interrupted write
  after stopping the panel and restarting CouchDB.

## Container tests

The Docker smoke test starts a disposable CouchDB and checks that the production panel runs as a
non-root user on a read-only filesystem. It calls all three listeners, then stops CouchDB and
checks that the readiness check fails while the process stays up. The worker test encrypts and
decrypts real fixture bytes and uploads to a local destination. It covers locking, duplicate
requests, interrupted runs, malformed requests, data that looks like shell code, and a failure at
each stage. Neither test reads homelab keys or production vaults.

CI and the release workflow also run `scripts/smoke-compose.sh` with the built production images,
against both the source-build stack and the standalone Dokploy stack. It starts the complete
Compose stack and checks backup-volume ownership, an encrypted upload and the system databases. It
then recreates the stack from a Raw Compose file in another directory and checks that the state
survived. It compares the mounted inline configs with the reference files in the repository, and
checks that CouchDB's listener refuses connections from outside. A local namespace fixture stands in
for the Tailscale container, so the test never joins a tailnet.

## Deployment verification

Build the production images, then run the isolated regression check:

```sh
docker build --target production -t livesync-dashboard:smoke .
docker build -t livesync-backup:smoke deploy/backup
bash scripts/smoke-compose.sh livesync-dashboard:smoke livesync-backup:smoke
bash scripts/smoke-compose.sh livesync-dashboard:smoke livesync-backup:smoke deploy/compose.dokploy.yml
```

The check starts all four services from the production Compose file. It checks the system
databases, that the listeners are only on loopback, and the queue permissions, then makes an
encrypted backup. It then recreates the stack with prebuilt images, from a rendered Raw Compose file
in another directory, and checks that the state survived. It creates and deletes only its own
temporary project and volumes. The fixture that replaces Tailscale passes its health check, but the
test does not cover a real login, certificates, Serve identity headers, credentials for external
storage, or deploying through the Dokploy interface.

The scale fixture creates 20 people and 100 vaults. It checks the owners' vault lists, paginated
registry reads and concurrent statistics requests. It measures provisioning with small databases,
so it says nothing about replication throughput or backup capacity for a production-sized dataset.
