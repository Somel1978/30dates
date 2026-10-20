'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useDevToolsAvailable } from '@/lib/devTools';
import { Heart, Person, Table, Wrench } from './icons';

/** Screens shown before membership: no tab bar. */
const BARE = ['/signin', '/auth', '/onboarding'];

function Tab({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  const path = usePathname();
  const active = href === '/' ? path === '/' || path.startsWith('/exchanges') : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors ${
        active ? 'text-brass' : 'text-muted hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * Mobile-first app frame: one phone-width column (centred on larger screens), a slim top bar and
 * a thumb-reachable tab bar at the bottom.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Re-checked on navigation so the tab appears right after signing in.
  const devTools = useDevToolsAvailable(path);
  const bare = BARE.some((p) => path.startsWith(p));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      <header className="flex h-14 items-center justify-center pt-[env(safe-area-inset-top)]">
        <Link href="/" className="font-serif text-2xl tracking-tight">
          Thirty <span className="italic text-brass">Dates</span>
        </Link>
      </header>
      <main className={`flex-1 ${bare ? 'pb-10' : 'pb-28'}`}>{children}</main>
      {!bare && (
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-md px-2">
            <Tab href="/" label="This week" icon={<Table />} />
            <Tab href="/matches" label="Matches" icon={<Heart />} />
            <Tab href="/profile" label="Profile" icon={<Person />} />
            {devTools && <Tab href="/test" label="Test tools" icon={<Wrench />} />}
          </div>
        </nav>
      )}
    </div>
  );
}
