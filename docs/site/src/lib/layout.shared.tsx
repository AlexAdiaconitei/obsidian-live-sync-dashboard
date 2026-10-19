import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitUrl } from './shared';
import { BrandTile } from '@/components/notebook-mark';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <BrandTile size="sm" />
          <span className="text-[1.02em] font-semibold tracking-tight">{appName}</span>
        </span>
      ),
    },
    // `on: 'nav'` keeps these out of the docs sidebar, where the page tree lists them.
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url', on: 'nav' },
      { text: 'Deploy', url: '/docs/install/dokploy', on: 'nav' },
      { text: 'Backups', url: '/docs/backups/instance', on: 'nav' },
    ],
    githubUrl: gitUrl,
  };
}
