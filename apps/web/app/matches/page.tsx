'use client';

import type { MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { ChevronRight } from '@/components/icons';
import { Notice, ScreenHeader, Spinner } from '@/components/primitives';
import { useResource } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Propose a 45-min window',
  scheduled: 'Meeting scheduled',
  raincheck_pending: 'Raincheck pending',
  met: 'You’ve met',
  expired: 'Closed',
};

export default function MatchesPage() {
  const session = useMemberSession();
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null);

  if (!matches.data) return matches.error ? <Notice tone="error">{matches.error.message}</Notice> : <Spinner />;

  return (
    <div>
      <ScreenHeader title="Matches" subtitle="Made the moment you’ve both answered by voice." />
      {matches.data.length === 0 ? (
        <p className="mt-6 font-serif text-[1.5rem] leading-snug text-ink/80">No matches yet. They’re rare on purpose; each one starts with a Monday batch.</p>
      ) : (
        <ul role="list">
          {matches.data.map((m) => (
            <li key={m.id} className={m.status === 'expired' ? 'opacity-50' : undefined}>
              <Link href={`/matches/${m.id}`} className="flex items-center gap-4 border-b border-line py-5">
                {m.counterpart.photo_ids[0] ? (
                  // Plain img: the authenticated, private photo endpoint.
                  <img src={`/api/photos/${m.counterpart.photo_ids[0]}`} alt="" className="h-14 w-14 rounded-full object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brass/40 font-serif text-2xl text-brass" aria-hidden="true">
                    {m.counterpart.first_name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1">
                  <span className="block font-serif text-[1.625rem] leading-tight">
                    {m.counterpart.first_name}, {m.counterpart.age}
                  </span>
                  <span className="mt-1 block font-mono text-[10.5px] uppercase tracking-[0.14em] text-brass">
                    {m.event && m.status === 'scheduled' ? `Meeting ${formatDateTime(m.event.starts_at)}` : STATUS[m.status]}
                  </span>
                </span>
                <ChevronRight size={18} className="text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
