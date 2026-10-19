# LiveSync Dashboard docs

The landing page and documentation site, built with [Fumadocs](https://fumadocs.dev) on Next.js
and exported to static files. It is a separate pnpm project: it does not share the application's
lockfile, and installing it does not install the application.

```sh
pnpm install   # docs/site/pnpm-workspace.yaml is the workspace root here, not the app's
pnpm dev       # http://localhost:3000
pnpm build     # writes out/
pnpm preview   # build, then serve out/
```

## Base path

GitHub Pages serves the site from `/<repository>`, so the prefix comes from `DOCS_BASE_PATH`.
`DOCS_SITE_URL` sets `metadataBase`, which Next.js uses only to build the absolute URL of the Open
Graph image. In Git Bash on Windows, set `MSYS_NO_PATHCONV=1`, or the shell turns
`/obsidian-live-sync-dashboard` into a Windows path.

## Deploying

`.github/workflows/docs.yml` builds and deploys the site on every push to `main` that changes
`docs/`. It fails if any built link points outside the base path. The repository's Pages source
must be set to **GitHub Actions**.

## Layout

```
content/docs/          the pages, as MDX. meta.json sets the order in each folder.
src/app/(home)/        the landing page and its footer
src/app/docs/          the docs layout and the [[...slug]] page
src/components/home/   components used only by the landing page
src/app/global.css     the palette, copied from src/styles/app.css in the application
public/media/          panel screenshots, light and dark
```

## Screenshots

The screenshots come from the application's demo, which has only fictional data. From the
application root, start `pnpm run demo`, then run `pnpm run screenshots`. The script captures each
page at 1440×900 with a device scale of 2, in both colour schemes, without the demo banner. If ports
5173 and 5174 are busy, set `DEMO_ADMIN_PORT` and `DEMO_OWNER_PORT` for both commands.
