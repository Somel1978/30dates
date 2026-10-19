'use client';

import type { CurrentBatchResponse } from '@thirtydates/shared';
import { useEffect, useState } from 'react';
import { formatDayTime, formatDuration } from '@/lib/format';

/**
 * Weekly countdown. The server clock is authoritative: we offset local time by the difference
 * observed when the batch was fetched so countdowns don't drift with a wrong device clock.
 */
export function WeekBanner({ batch }: { batch: CurrentBatchResponse }) {
  const [skew] = useState(() => Date.parse(batch.server_now) - Date.now());
  const [now, setNow] = useState(() => Date.now() + skew);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + skew), 30_000);
    return () => window.clearInterval(id);
  }, [skew]);

  const until = (iso: string) => formatDuration(Date.parse(iso) - now);
  const c = batch.clock;

  let headline: string;
  let detail: string;
  switch (batch.phase) {
    case 'awaiting_deal':
      headline = 'The table is being set';
      detail = `Monday deal lands ${formatDayTime(c.deal_at)} · in ${until(c.deal_at)}`;
      break;
    case 'validation':
      headline = 'Monday Deal Active';
      detail = `Stamps close ${formatDayTime(c.stamps_close_at)} · ${until(c.stamps_close_at)} left`;
      break;
    case 'sealed':
      headline = 'Stamps sealed';
      detail = `Sunday Reveal at ${formatDayTime(c.reveal_at)} · in ${until(c.reveal_at)}`;
      break;
    case 'reveal':
      headline = 'Sunday Reveal';
      detail = `#1 Signal opens ${formatDayTime(c.signal_opens_at)} · in ${until(c.signal_opens_at)}`;
      break;
    case 'signal':
      headline = 'Sunday Signal open';
      detail = `Closes ${formatDayTime(c.signal_closes_at)} · ${until(c.signal_closes_at)} left`;
      break;
  }

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">Week of {new Date(`${batch.batch_week}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
        <h1 className="mt-1 text-4xl">{headline}</h1>
        <p className="mt-1 text-muted" aria-live="polite">
          {detail}
        </p>
      </div>
      {batch.phase === 'validation' && (
        <div className="flex items-center gap-3" aria-label={`${batch.stamps_remaining} of 3 stamps left`}>
          <span className="text-sm text-muted">Stamps</span>
          <span className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-3 w-3 rounded-full border ${i < batch.stamps_remaining ? 'border-brass bg-brass' : 'border-line'}`}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
