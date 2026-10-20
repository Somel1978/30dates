import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

/**
 * Render every page per request. Pages fetch their data client-side, so pre-rendering buys
 * nothing, and Next's prerender header (s-maxage only) lets browsers cache the HTML
 * heuristically: after an update that cached page points at CSS/JS files that no longer exist.
 * Dynamic pages are sent with no-store; the hashed /_next/static files keep their long cache.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Thirty Dates', template: '%s · Thirty Dates' },
  description: 'Six considered introductions every Monday. For adults aged 30 to 55.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D1616',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${serif.variable} ${sans.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
