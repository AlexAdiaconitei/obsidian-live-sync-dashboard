import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { appName, fullName, tagline } from '@/lib/shared';
import { withBasePath } from '@/lib/base-path';
import './global.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/* Next.js uses `metadataBase` only to build the absolute Open Graph image URL. The docs workflow
   sets it through DOCS_SITE_URL. */
const siteUrl =
  process.env.DOCS_SITE_URL ?? 'https://alexadiaconitei.github.io/obsidian-live-sync-dashboard/';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${fullName}: a self-hosted panel for Obsidian LiveSync`,
    template: `%s · ${appName}`,
  },
  description: tagline,
  applicationName: appName,
  // metadata.icons is one of the paths Next does not prefix with basePath.
  icons: { icon: withBasePath('/brand/favicon.svg') },
  openGraph: { title: fullName, description: tagline, siteName: appName, type: 'website' },
  twitter: { card: 'summary_large_image', title: fullName, description: tagline },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} font-sans`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
