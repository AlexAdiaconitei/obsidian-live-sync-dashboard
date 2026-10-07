#!/bin/sh
# Container build tooling only: installs the pnpm pinned by package.json, then removes the
# bundled npm, Yarn and Corepack so no unused package manager stays in the build stage.
set -eu
version=$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")
npm install --global "pnpm@$version" --ignore-scripts --no-audit --no-fund
rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-*
rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
pnpm --version
