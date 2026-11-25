import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';

import { Shot } from '@/components/shot';
import { Section } from '@/components/home/section';
import { CopyCommand } from '@/components/home/copy-command';
import { PortalSplit } from '@/components/home/portal-split';
import { BrandTile } from '@/components/notebook-mark';
import { AboutCard } from '@/components/about/AboutCard';
import { withBasePath } from '@/lib/base-path';
import { appName, fullName, gitUrl, tagline } from '@/lib/shared';

export const metadata: Metadata = {
  title: `${fullName}: a self-hosted panel for Obsidian LiveSync`,
  description: tagline,
};

const primary =
  'inline-flex items-center gap-2 rounded-lg bg-ls-accent px-4 py-2.5 text-[0.9rem] font-medium text-ls-accent-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ls-accent motion-reduce:transition-none';
const secondary =
  'inline-flex items-center gap-2 rounded-lg border border-ls-line px-4 py-2.5 text-[0.9rem] font-medium text-ls-ink transition-colors hover:bg-ls-raise motion-reduce:transition-none';

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-[74rem] px-5 sm:px-8">
      {/* --- hero ------------------------------------------------------------ */}
      <section className="pt-14 pb-16 sm:pt-20 lg:pt-24 lg:pb-20">
        <p className="eyebrow">Obsidian LiveSync</p>
        <div className="mt-4 flex items-center gap-3 sm:gap-4">
          <BrandTile size="lg" />
          <h1 className="display text-[clamp(2.4rem,7vw,4.25rem)] text-ls-ink">{appName}</h1>
        </div>

        <p className="mt-6 max-w-[56ch] text-[1.0125rem] leading-relaxed text-ls-muted sm:text-[1.075rem]">
          A self-hosted panel for the CouchDB server behind{' '}
          <a href="https://github.com/vrtmrz/obsidian-livesync" className="text-ls-ink underline">
            Obsidian LiveSync
          </a>
          . Administrators create accounts and set storage quotas. Each person manages their own
          vaults, sets up devices with encrypted setup URIs and backs up to their own Google Drive.
        </p>

        <p className="mt-4 text-[0.85rem] text-ls-muted">
          MIT licensed · English and Spanish · reachable only through your tailnet
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/docs" className={primary}>
            Read the docs
            <ArrowRight className="size-4" />
          </Link>
          <CopyCommand command={`git clone ${gitUrl}`} label="the clone command" />
        </div>
      </section>

      <section className="pb-16 sm:pb-20 lg:pb-24">
        <Shot
          name="admin-overview"
          alt="The administration overview: CouchDB status, vault count, last backup, the instance quota and a table of databases with document counts and sizes"
          caption="The administration overview, from the local demo with fictional data."
          priority
        />
      </section>

      <Section
        label="How it works"
        title="One Tailscale node, three addresses"
        lede="Tailscale Serve terminates HTTPS on three ports. Nothing is reachable from outside the
          tailnet, and CouchDB itself listens only on loopback."
      >
        <PortalSplit />
      </Section>

      {/* --- close ------------------------------------------------------------ */}
      <section className="border-t border-ls-line py-16 sm:py-20 lg:py-24">
        <h2 className="display max-w-[22ch] text-[clamp(1.8rem,4vw,2.75rem)] text-ls-ink">
          Deploy the whole stack, or add the panel to your CouchDB.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[1.0125rem] leading-relaxed text-ls-muted">
          One Compose file runs Tailscale, CouchDB, the panel and a backup worker. Existing servers
          keep their databases, accounts and passwords when the panel adopts them.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/docs/install/dokploy" className={primary}>
            Deploy with Dokploy
            <ArrowRight className="size-4" />
          </Link>
          <Link href="/docs/install/docker-compose" className={secondary}>
            Docker Compose
          </Link>
          <Link href="/docs/install/existing-server" className={secondary}>
            Existing server
          </Link>
        </div>
      </section>

      <Section
        id="about"
        label="About"
        title="Behind the project"
      >
        <AboutCard photo={withBasePath('/alex.webp')} />
      </Section>
    </main>
  );
}
