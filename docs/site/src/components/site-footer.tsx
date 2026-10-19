import { appName, gitUrl, licence } from '@/lib/shared';

/** The site footer, with the licence and author links used on the author's other sites. */
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-[74rem] px-5 pb-10 sm:px-8">
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2.5 border-t border-ls-line pt-4 text-[0.75rem] text-ls-muted">
        <p className="m-0">
          {appName} ·{' '}
          <a href={licence.file} className="hover:text-ls-ink">
            {licence.spdx} License
          </a>{' '}
          · Written with AI assistance (GPT 6.1-Sol and Claude Opus 5.5) ·{' '}
          <a href={gitUrl} className="hover:text-ls-ink">
            Source on GitHub
          </a>
        </p>
        <p className="m-0 font-mono text-[0.625rem] tracking-[0.12em]">
          SELF-HOSTED · TAILNET-ONLY · NO TELEMETRY
        </p>
      </div>
    </footer>
  );
}
