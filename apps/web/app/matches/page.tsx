'use client';

import type { MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { Badge, Notice, Panel, Spinner } from '@/components/primitives';
import { useResource } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Choosing how to meet',
  scheduled: 'Meeting scheduled',
  raincheck_pending: 'Raincheck pending',
  met: 'Met',
  expired: 'Closed',
};

export default function MatchesPage() {
  const session = useMemberSession();
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null);

  if (!matches.data) return matches.error ? <Notice tone="error">{matches.error.message}</Notice> : <Spinner />;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl">Matches</h1>
      <p className="mt-2 text-muted">Formed when your Sunday #1 Signals align.</p>
      {matches.data.length === 0 ? (
        <Panel className="mt-8 p-8 text-center">
          <p className="text-muted">No matches yet. They’re rare on purpose.</p>
        </Panel>
      ) : (
        <ul role="list" className="mt-8 space-y-3">
          {matches.data.map((m) => (
            <li key={m.id}>
              <Link href={`/matches/${m.id}`} className="block rounded-card border border-line/70 bg-panel p-5 shadow-card transition-colors hover:border-brass/50">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-serif text-2xl">{m.counterpart.first_name}</span>
                  <Badge tone={m.status === 'expired' ? 'default' : 'brass'}>{STATUS[m.status]}</Badge>
                </div>
                {m.event && m.status !== 'expired' && <p className="mt-1 text-sm text-muted">{formatDateTime(m.event.starts_at)}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
