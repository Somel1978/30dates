'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useDevToolsAvailable } from '@/lib/devTools';

type Mode = 'light' | 'dark';

function ThemeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('td-theme', next);
    } catch {
      // Preference simply won't persist.
    }
    setMode(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="tap rounded-full text-muted transition-colors hover:text-ink"
      aria-label={mode === 'dark' ? 'Switch to light editorial mode' : 'Switch to dark mode'}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {mode === 'dark' ? (
          <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0-1.414-1.414M7.05 7.05 5.636 5.636M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        )}
      </svg>
    </button>
  );
}

/** Calm, centred shell: a slim masthead and a single reading column. */
const NAV_LINK = 'tap whitespace-nowrap rounded-full px-2 text-sm hover:text-ink sm:px-3';

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = href === '/' ? path === '/' : path.startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`${NAV_LINK} ${active ? 'text-ink' : 'text-muted'}`}>
      {children}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  // Re-checked on navigation so the link appears right after signing in.
  const devTools = useDevToolsAvailable(path);
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-[env(safe-area-inset-bottom)] sm:px-8">
      <header className="flex items-center justify-between py-4">
        <Link href="/" className="tap -ml-2 rounded-full px-2 font-serif text-2xl tracking-tight">
          Thirty <span className="italic text-brass">Dates</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center justify-end">
          <NavLink href="/">This week</NavLink>
          <NavLink href="/matches">Matches</NavLink>
          <NavLink href="/profile">Profile</NavLink>
          {devTools && <NavLink href="/test">Test tools</NavLink>}
          <ThemeToggle />
        </nav>
      </header>
      <main className="flex-1 pb-16">{children}</main>
    </div>
  );
}
