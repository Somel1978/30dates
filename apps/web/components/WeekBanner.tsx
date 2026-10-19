'use client';

import type { CurrentBatchResponse } from '@thirtydates/shared';
import { formatDayTime } from '@/lib/format';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The week, told as a short note rather than a status panel: what's happening now and the one
 * thing (if any) worth doing. No ticking counters: deadlines are stated once, calmly.
 */
export function WeekBanner({ batch, firstName }: { batch: CurrentBatchResponse; firstName: string | null }) {
  const c = batch.clock;
  const open = batch.exchanges.filter((x) => x.status === 'questions' || x.status === 'answering');
  const left = batch.selections_remaining;
  let note: React.ReactNode;

  switch (batch.phase) {
    case 'awaiting_deal':
      note = <>Your table is being set. This week’s introductions arrive {formatDayTime(c.deal_at)}.</>;
      break;
    case 'selection':
      note =
        batch.cards.length === 0 ? null : (
          <>
            {batch.cards.length === 6 ? 'Six people' : `${batch.cards.length} ${batch.cards.length === 1 ? 'person' : 'people'}`} have been
            introduced to you this week. No photos and no names yet, just how they live. Take your time, and choose up to three you’d
            like to hear from by {formatDayTime(new Date(Date.parse(c.selection_closes_at) - 60_000).toISOString())}.{' '}
            <span className="text-ink">
              {left === 3 ? '' : left > 0 ? `You can choose ${left === 1 ? 'one more' : 'two more'}.` : 'You’ve chosen your three. There’s nothing else to do until Wednesday.'}
            </span>
          </>
        );
      break;
    case 'exchange_questions':
      note =
        open.length > 0 ? (
          <>
            Someone you chose chose you too. Today, pick two or three questions you’d love to hear them answer. Their answers, and yours,
            will be spoken, not typed.
          </>
        ) : (
          <>Nothing became mutual this week. That’s part of the rhythm, and nobody was turned away. A fresh table is set on Monday.</>
        );
      break;
    case 'exchange_answers':
      note =
        open.length > 0 ? (
          <>Their questions are waiting for you. Answer in your own voice, in your own time, before {formatDayTime(c.answers_close_at)}.</>
        ) : (
          <>A quiet week. A fresh table is set {formatDayTime(c.next_deal_at)}.</>
        );
      break;
    case 'bridge':
      note = <>The week is winding down. A fresh table is set {formatDayTime(c.next_deal_at)}.</>;
      break;
  }

  return (
    <header className="mx-auto mb-12 max-w-2xl pt-6 text-center sm:pt-10">
      <p className="font-serif text-lg italic text-brass">
        Week of {new Date(`${batch.batch_week}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}
      </p>
      <h1 className="mt-3 text-4xl sm:text-5xl">
        {greeting()}
        {firstName ? `, ${firstName}` : ''}.
      </h1>
      {note && <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink/75">{note}</p>}
    </header>
  );
}
