'use client';

import type { MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { ChevronRight } from '@/components/icons';
import { Notice, Panel, ScreenHeader, Spinner } from '@/components/primitives';
import { useResource } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Propose a meet-up',
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
        <Panel className="p-6 text-center">
          <p className="font-medium">No matches yet</p>
          <p className="mt-1 text-sm text-muted">They’re rare on purpose. Each one starts with a Monday batch.</p>
        </Panel>
      ) : (
        <ul role="list" className="space-y-2.5">
          {matches.data.map((m) => (
            <li key={m.id}>
              <Link
                href={`/matches/${m.id}`}
                className={`flex min-h-[4.5rem] items-center gap-3.5 rounded-2xl border bg-panel px-4 py-3 shadow-card ${
                  m.status === 'expired' ? 'border-line opacity-60' : 'border-brass/50'
                }`}
              >
                {m.counterpart.photo_ids[0] ? (
                  // Plain img: the authenticated, private photo endpoint.
                  <img src={`/api/photos/${m.counterpart.photo_ids[0]}`} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine text-lg font-semibold" aria-hidden="true">
                    {m.counterpart.first_name.slice(0, 1)}
                  </span>
                )}
                <span className="flex-1">
                  <span className="block font-medium">
                    {m.counterpart.first_name}, {m.counterpart.age}
                  </span>
                  <span className="block text-[0.8125rem] text-muted">
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
