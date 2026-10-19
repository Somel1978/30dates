'use client';

import type { ExchangeSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { Countdown } from './Countdown';
import { CardBody } from './MondayCard';
import { cx } from './primitives';

const STATUS: Record<ExchangeSummary['status'], string> = {
  questions: 'Choose 2–3 questions for them',
  answering: 'Record your answers',
  released: 'Released',
  expired: 'Closed',
};

/** A mutual pair's voice exchange on the weekly dashboard. Faceless until both lock. */
export function ExchangeCard({ exchange, serverNow }: { exchange: ExchangeSummary; serverNow: string }) {
  const revealed = exchange.revealed;
  const photo = revealed?.photo_ids[0];
  let detail: React.ReactNode;
  if (exchange.status === 'questions') {
    detail = exchange.my_pick_count ? `${exchange.my_pick_count} questions chosen. Change them until Thursday.` : 'Pick what you’d like to hear them answer.';
  } else if (exchange.status === 'answering') {
    detail = exchange.i_locked ? (
      'Locked. Nothing is shared until you have both locked.'
    ) : (
      <>
        Response Clock: <Countdown to={exchange.answers_close_at} serverNow={serverNow} className="text-ink" /> left
      </>
    );
  } else if (exchange.status === 'released') {
    detail = 'Voice notes, name and photos are unlocked. Your First-Meet Bridge is open.';
  } else {
    detail = 'The Response Clock ran out. Nothing was shared.';
  }

  return (
    <li>
      <article
        className={cx(
          'rounded-card border bg-panel p-5 shadow-card',
          exchange.status === 'expired' ? 'border-line/60 opacity-60' : 'border-brass/40',
        )}
      >
        <header className="mb-4 flex items-center gap-4">
          {revealed ? (
            photo ? (
              // Plain img: the authenticated, private photo endpoint.
              <img src={`/api/photos/${photo}`} alt={`Photo of ${revealed.first_name}`} className="h-16 w-16 animate-fade-in rounded-full object-cover ring-2 ring-brass/50" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-forest font-serif text-2xl ring-2 ring-brass/50" aria-hidden="true">
                {revealed.first_name.slice(0, 1)}
              </span>
            )
          ) : (
            <span className="h-16 w-16 rounded-full bg-gradient-to-br from-forest to-raised blur-[2px]" aria-hidden="true" />
          )}
          <div>
            <p className="eyebrow text-brass">{STATUS[exchange.status]}</p>
            <p className="font-serif text-2xl">{revealed ? revealed.first_name : 'Mutual selection'}</p>
          </div>
        </header>

        <CardBody profile={exchange.counterpart} />

        <p className="mt-4 text-sm text-muted">{detail}</p>
        {exchange.status !== 'expired' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/exchanges/${exchange.id}`} className="tap rounded-full bg-accent px-6 text-sm font-medium text-canvas">
              {exchange.status === 'released' ? 'Hear their answers' : 'Open the exchange'}
            </Link>
            {exchange.match_id && (
              <Link href={`/matches/${exchange.match_id}`} className="tap rounded-full border border-brass/60 px-6 text-sm text-brass">
                First-Meet Bridge
              </Link>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
