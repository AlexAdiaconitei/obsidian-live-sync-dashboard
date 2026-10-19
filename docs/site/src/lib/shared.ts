export const appName = 'LiveSync Dashboard';
export const fullName = 'Obsidian LiveSync Dashboard';
export const tagline =
  'A self-hosted panel for the CouchDB behind Obsidian LiveSync: people, vaults, quotas, setup URIs and backups.';

export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'AlexAdiaconitei',
  repo: 'obsidian-live-sync-dashboard',
  branch: 'main',
};

export const gitUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/** Where the MDX sources live inside the repository, for the "edit on GitHub" link. */
export const contentPath = 'docs/site/content/docs';

export const licence = {
  spdx: 'MIT',
  file: `${gitUrl}/blob/main/LICENSE`,
};

/** Placeholder hostnames used throughout the docs, so every example reads the same. */
export const example = {
  fqdn: 'notes.tail123456.ts.net',
};
