import Image from 'next/image';
import { withBasePath } from '@/lib/base-path';

/**
 * A panel screenshot in the reader's colour scheme.
 *
 * Every shot exists in light and dark. The page renders both and CSS hides one, instead of
 * swapping them in JavaScript, so the right one shows on first paint.
 *
 * `next/image` does not add `basePath` to a literal `src`, so every path goes through
 * `withBasePath`. Without it the screenshots return 404 on GitHub Pages.
 *
 * `pnpm run screenshots` captures the shots from `pnpm run demo`, which has only fictional data.
 */

export type ShotName =
  | 'admin-overview'
  | 'admin-person'
  | 'admin-inventory'
  | 'admin-backups'
  | 'admin-events'
  | 'owner-vaults'
  | 'owner-setup'
  | 'owner-backups';

const SHOTS: Record<ShotName, { width: number; height: number }> = {
  'admin-overview': { width: 2880, height: 1800 },
  'admin-person': { width: 2880, height: 2408 },
  'admin-inventory': { width: 2880, height: 1800 },
  'admin-backups': { width: 2880, height: 1800 },
  'admin-events': { width: 2880, height: 1800 },
  'owner-vaults': { width: 2880, height: 1800 },
  'owner-setup': { width: 2880, height: 1800 },
  'owner-backups': { width: 2880, height: 1800 },
};

export function Shot({
  name,
  alt,
  caption,
  priority = false,
  className = '',
  sizes = '(min-width: 1280px) 1100px, 100vw',
}: {
  name: ShotName;
  alt: string;
  caption?: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  const { width, height } = SHOTS[name];

  return (
    <figure className={`m-0 ${className}`}>
      <div className="overflow-hidden rounded-xl border border-ls-line bg-ls-panel shadow-[0_1px_2px_rgb(0_0_0/0.04),0_22px_50px_-34px_rgb(0_0_0/0.35)]">
        <Image
          src={withBasePath(`/media/${name}.png`)}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          priority={priority}
          className="h-auto w-full dark:hidden"
        />
        <Image
          src={withBasePath(`/media/${name}-dark.png`)}
          alt=""
          width={width}
          height={height}
          sizes={sizes}
          priority={priority}
          className="hidden h-auto w-full dark:block"
        />
      </div>
      {caption ? (
        <figcaption className="mt-3 text-[0.8rem] leading-relaxed text-ls-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
