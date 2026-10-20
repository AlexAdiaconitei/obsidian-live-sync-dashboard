# Changelog

Release notes come from this file. Each `vX.Y.Z` or `vX.Y.Z-rc.N` tag uses the matching version
section. This project follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

## [1.0.0] - 2026-10-20

First public release.

### Portals and accounts

- Separate administration and owner portals, in English and Spanish, with light and dark themes and
  mobile layouts. Styles, icons and scripts are compiled locally; only the optional Google folder
  picker loads Google's scripts.
- Administrators sign in through Tailscale Serve, matched against `PANEL_ADMINS`. Owners sign in with
  their CouchDB username and sync password, so devices can share a Tailscale account without
  sharing application accounts or vaults.
- Administrators invite owners with private, single-use links that expire after 24 hours. Owners
  choose their password, change it later, and download their account details before activation.
- Owner sessions renew while in use, end after one hour without activity or 12 hours after
  sign-in, and end on every device when the password changes, access is disabled or the owner
  signs out.
- Owners create vaults by entering a name, up to 20 from the owner portal; administrators can add
  more for any person. Repeating a creation request returns the same vault, and recreating a
  deleted vault uses a new database.
- Existing CouchDB accounts and vaults can be adopted without renaming databases or changing
  passwords or `_security` memberships. Adoption refuses databases with their own
  `validate_doc_update`, and a missing recovery code can be registered later.
- Access can be disabled and enabled again, passwords reset, and interrupted account or vault
  operations reconciled. Every administrative change is audited without secrets.

### Device setup

- Setup URIs are generated in the browser with the pinned LiveSync commonlib, with end-to-end
  encryption and path obfuscation on. The encryption passphrase and the URI password never reach
  the server.
- New vaults start with a generated passphrase and publish LiveSync's preferred settings on the
  remote. The sync password is checked against CouchDB before any URI is generated.
- Temporary and persistent URIs, a QR code that opens full screen for phone cameras, and a `.txt`
  export of the complete setup. Step-by-step instructions cover the first and later devices.
- `pnpm run recovery-code <data.json>` reads a vault's recovery code from the LiveSync settings of
  a configured device.

### Quotas and the sync gateway

- Obsidian syncs through a quota gateway on port 443, in front of a private CouchDB. It enforces an
  instance limit and per-person quotas with serialized write admission, persistent journals for
  interrupted writes, and guards that reject direct writes by regular users.
- Quotas count synced documents, attachments and live conflicts across each person's vaults.
  Administrators and owners see usage and available space.
- Request bodies are bounded, failed logins are limited per username, refused requests are logged
  without document ids, and the bundled CouchDB locks an account for five minutes after five failed
  logins.
- Owners can rebuild a vault they own from LiveSync. The panel recreates its database with the same
  access, version document and quota guard.

### Vault recovery and deletion

- Owners download a vault recovery ZIP of up to 1 GiB with its CouchDB records, conflicts,
  deletions, attachments, recovery identity and encryption salt, plus restoration instructions.
- Owners delete a vault after choosing whether to download a recovery copy, typing its name and
  entering their password. Databases shared with other accounts or roles need administrator review.

### Backups

- An independent instance backup worker encrypts archives with age and uploads them through rclone
  on a schedule or on request, with locking, retention, bounded history, recovery after
  interrupted runs and push monitoring.
- An optional second worker, `backup-secondary`, sends archives to another rclone destination with
  its own schedule and retention. It starts only with `COMPOSE_PROFILES=secondary-backup`.
- Optional personal Google Drive backups: each owner authorizes their own account, picks a folder
  they own, and supplies a public age key, which the panel can create in the browser. Exports
  include conflicts, deletions, revision ancestry, attachments, recovery identities and the
  end-to-end encryption salt. They run daily or on request and retry failures after an hour.
- **Recover your vaults** opens a personal backup or recovery ZIP in the browser with the recovery
  key and the vault passphrases, and downloads the notes as folders that open as Obsidian vaults.
  Nothing chosen or typed on the page is uploaded.

### Deployment

- Compose files for the complete stack and for an existing CouchDB server, a homelab override, and
  Dokploy definitions that run only published images. The panel and backup workers run with
  read-only file systems and `no-new-privileges`.
- Tag-driven releases build and test both images, scan them, and publish them to GHCR with these
  notes and a Dokploy environment pinned to their digests.
- A local demo runs both portals with sample data and no external services.

### Known limitations

- The supported deployment keeps the dashboard on a tailnet. Public deployment is planned in
  [ROADMAP.md](ROADMAP.md).
- Live backups are not transactional snapshots across vaults. Personal exports do not replace
  instance backups.
- Shared vaults, automated restores and tested arm64 images are not included. A server operator who
  replaces the browser code remains inside the trust boundary for future secret entry.
