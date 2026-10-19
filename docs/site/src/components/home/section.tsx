import type { ReactNode } from 'react';

/**
 * A landing page band: a top border, a label in the left column on wide screens, and the content.
 * The label is not a number because the sections have no order.
 */
export function Section({
  label,
  title,
  lede,
  children,
  id,
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className="border-t border-ls-line py-16 first:border-t-0 sm:py-20 lg:py-24"
    >
      <div className="grid gap-8 lg:grid-cols-[9rem_minmax(0,1fr)] lg:gap-12">
        <p className="eyebrow lg:sticky lg:top-24 lg:self-start lg:pt-2">{label}</p>

        <div className="min-w-0">
          <h2 className="display max-w-[22ch] text-[clamp(1.65rem,3.2vw,2.35rem)] text-ls-ink">
            {title}
          </h2>
          {lede ? (
            <p className="mt-4 max-w-[62ch] text-[1.0125rem] leading-relaxed text-ls-muted">
              {lede}
            </p>
          ) : null}
          {children ? <div className="mt-9">{children}</div> : null}
        </div>
      </div>
    </section>
  );
}
