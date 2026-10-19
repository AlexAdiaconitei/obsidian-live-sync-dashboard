import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/*
 * The same build answers on two prefixes:
 *
 *   pnpm dev                    → /                                (nothing set)
 *   GitHub Pages project site   → /obsidian-live-sync-dashboard    (DOCS_BASE_PATH)
 *
 * so the prefix is read from the environment rather than written down. `basePath` refuses
 * a trailing slash, so it is trimmed here instead of in every caller.
 */
const basePath = (process.env.DOCS_BASE_PATH ?? '').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,

  // Emits `/docs/index.html` rather than `/docs.html`, which GitHub Pages resolves without
  // a rewrite rule.
  trailingSlash: true,

  basePath,
  // Required with `output: 'export'`: there is no optimiser to serve `/_next/image`.
  images: { unoptimized: true },

  // next/link takes basePath on its own. Nothing else does, so src/lib/base-path.ts reads
  // it from here.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default withMDX(config);
