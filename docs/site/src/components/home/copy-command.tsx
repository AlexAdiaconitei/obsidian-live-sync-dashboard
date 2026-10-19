'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** A shell command shown in full, with a button that copies it to the clipboard. */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(command).then(() => setCopied(true));
      }}
      className="group inline-flex max-w-full items-center gap-2.5 rounded-lg border border-ls-line bg-ls-panel py-2 pl-3 pr-2.5 text-left transition-colors hover:border-ls-accent/60 hover:bg-ls-raise focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ls-accent motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="select-none font-mono text-[0.78rem] text-ls-muted">
        $
      </span>
      {/* Long commands wrap instead of being truncated, so the reader sees exactly what the
          button copies. */}
      <code className="min-w-0 break-all font-mono text-[0.78rem] text-ls-ink">{command}</code>
      <span className="ml-1 shrink-0 text-ls-muted transition-colors group-hover:text-ls-accent motion-reduce:transition-none">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
      <span className="sr-only">
        {copied ? 'Copied' : `Copy ${label ?? 'this command'} to the clipboard`}
      </span>
    </button>
  );
}
