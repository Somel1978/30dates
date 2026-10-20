'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useDevToolsAvailable } from '@/lib/devTools';

/** Top-level screens carry the wordmark and the tab bar; full-screen flows (folio, exchange,
 *  match) bring their own back link and bottom action bar instead. */
const TAB_SCREENS = ['/', '/matches', '/profile', '/test'];
const WORDMARK_SCREENS = [...TAB_SCREENS, '/signin', '/auth/verify', '/onboarding'];

function Tab({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = href === '/' ? path === '/' : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors ${
        active ? 'text-brass' : 'text-muted/70 hover:text-ink'
      }`}
    >
      <span className={`h-1 w-1 rounded-full ${active ? 'bg-brass' : 'bg-transparent'}`} aria-hidden="true" />
      {label}
    </Link>
  );
}

/** Mobile-first frame: one phone-width column, centred on larger screens. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Re-checked on navigation so the tab appears right after signing in.
  const devTools = useDevToolsAvailable(path);
  const tabs = TAB_SCREENS.includes(path);
  const wordmark = WORDMARK_SCREENS.includes(path);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[env(safe-area-inset-top)]">
      {wordmark && (
        <header className="flex h-14 items-center">
          <Link href="/" className="font-serif text-[1.5rem] tracking-tight">
            Thirty <span className="italic text-brass">Dates</span>
          </Link>
        </header>
      )}
      <main className={`flex-1 ${tabs ? 'pb-24' : 'pb-6'} ${wordmark ? '' : 'pt-4'}`}>{children}</main>
      {tabs && (
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-md px-3">
            <Tab href="/" label="This week" />
            <Tab href="/matches" label="Matches" />
            <Tab href="/profile" label="Profile" />
            {devTools && <Tab href="/test" label="Test tools" />}
          </div>
        </nav>
      )}
    </div>
  );
}
