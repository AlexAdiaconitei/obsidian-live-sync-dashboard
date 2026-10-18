# Releases

`package.json` holds the version. `CHANGELOG.md` holds the release notes, in English, with exactly
one `## [version] - YYYY-MM-DD` section per release. Pushing a version tag starts the release
workflow, which checks the version and the notes, then builds and publishes the Docker images.

1. Change the version in `package.json` and the changelog in the same commit. When operators must
   act before or after updating, add an `### Upgrade notes` subsection to that version.
2. Run `pnpm run verify` with the disposable CouchDB integration tests enabled, `pnpm run build`,
   `pnpm run test:browser` with all three engines, the image smoke test and the worker tests.
3. Create and push the matching `vMAJOR.MINOR.PATCH-rc.N` or stable tag.
4. The workflow checks the tag, the version and the notes, which must exist, must not be empty and
   must not be duplicated. The CI and release jobs each start their own disposable CouchDB, run the
   integration tests and the Chromium, Firefox and WebKit tests, and audit the dependencies and both
   finished production images. If any check fails, no image is pushed.
5. The workflow pushes the tested images to GHCR by version. Only then does the notes job create or
   update the GitHub release, with `--notes-file` and `--verify-tag`.

The release also attaches `compose.dokploy.yml`, `compose.dokploy.existing.yml` and
`dokploy.env.example`. Neither Dokploy file builds anything or mounts source code. The environment
file pins the published panel and worker digests under `ghcr.io/<owner>/<repository>` and
`ghcr.io/<owner>/<repository>-backup`, and leaves the credentials as placeholders. Both image
packages carry the repository source label, so their GitHub package permissions can inherit the
repository's access. To deploy, follow
[the Dokploy guide](https://alexadiaconitei.github.io/obsidian-live-sync-dashboard/docs/install/dokploy/).

RC tags never get `latest` or minor-version aliases, and their GitHub releases are marked as
prereleases. Stable aliases are published only when the repository variable
`PUBLISH_STABLE_ALIASES` is `true`. Deployments should still pin a version or digest. The workflow
never changes the visibility of the repository or the packages.

The repository and both GHCR packages are private, and only the identities that deploy them have
read access. Before making them public, run the [manual checks](testing.md#manual-checks-before-a-release),
then change the visibility and check that the images pull without credentials. The MIT license
does not make a private repository public.

Images are built for the runner's architecture, Linux amd64. Add arm64 builds and smoke tests
before claiming arm64 support. Never move an existing release tag. Re-running a failed tag workflow
uses the same commit and reads the notes from its changelog again.

The pinned Actions come from their official repositories:
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[buildx](https://github.com/docker/setup-buildx-action) and
[registry login](https://github.com/docker/login-action). When you bump one, update its pin and run
the full image checks in the same change.
