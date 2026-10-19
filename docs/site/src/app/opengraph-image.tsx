import { ImageResponse } from 'next/og';
import { OgCard } from '@/lib/og';

// `output: 'export'` needs this: no server exists to generate the image on request.
export const dynamic = 'force-static';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'LiveSync Dashboard, a self-hosted panel for Obsidian LiveSync';

/** The card for the landing page. Docs pages get their own from `og/docs/[...slug]`. */
export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Obsidian LiveSync"
        title="A self-hosted panel for your sync server"
        description="People, vaults, storage quotas, encrypted setup URIs and backups for the CouchDB behind Obsidian LiveSync."
      />
    ),
    size,
  );
}
