'use client';

import type { CurrentBatchResponse } from '@thirtydates/shared';
import { Countdown } from './Countdown';
import { formatDayTime } from '@/lib/format';

const HEADLINE: Record<CurrentBatchResponse['phase'], string> = {
  awaiting_deal: 'The table is being set',
  selection: 'Monday Deal Active',
  exchange_questions: 'Voice exchange: choose your questions',
  exchange_answers: 'Voice exchange: Response Clock running',
  bridge: 'First-Meet Bridge',
};

/** Weekly countdown. Times render in the viewer's zone; the server clock is authoritative. */
export function WeekBanner({ batch }: { batch: CurrentBatchResponse }) {
  const c = batch.clock;
  const next: Record<CurrentBatchResponse['phase'], { label: string; at: string }> = {
    awaiting_deal: { label: 'Six cards arrive', at: c.deal_at },
    selection: { label: 'Selection closes', at: c.selection_closes_at },
    exchange_questions: { label: 'Response Clock starts', at: c.questions_close_at },
    exchange_answers: { label: 'Response Clock closes', at: c.answers_close_at },
    bridge: { label: 'Next deal', at: c.next_deal_at },
  };
  const n = next[batch.phase];

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">
          Week of {new Date(`${batch.batch_week}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}
        </p>
        <h1 className="mt-1 text-4xl">{HEADLINE[batch.phase]}</h1>
        <p className="mt-1 text-muted">
          {n.label} {formatDayTime(n.at)} · in <Countdown to={n.at} serverNow={batch.server_now} />
        </p>
      </div>
      {batch.phase === 'selection' && (
        <div className="flex items-center gap-3" aria-label={`${batch.selections_remaining} of 3 selections left`}>
          <span className="text-sm text-muted">Selections</span>
          <span className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-3 w-3 rounded-full border ${i < batch.selections_remaining ? 'border-brass bg-brass' : 'border-line'}`} />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
