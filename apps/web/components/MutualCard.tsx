'use client';

import type { MutualCard as MutualCardData, WeekPhase } from '@thirtydates/shared';
import Link from 'next/link';
import { CardBody } from './MondayCard';
import { Badge, Button, cx } from './primitives';

/**
 * A mutually validated card. Faceless until the Sunday reveal; from Wednesday it offers the
 * scenario exchange, from Sunday 06:00 the first name and photos, and from 18:00 the #1 Signal.
 */
export function MutualCard({
  card,
  phase,
  signalTargetId,
  matchId,
  onOpenScenarios,
  onSignal,
}: {
  card: MutualCardData;
  phase: WeekPhase;
  signalTargetId: string | null;
  matchId: string | null;
  onOpenScenarios: (card: MutualCardData) => void;
  onSignal: (card: MutualCardData) => void;
}) {
  const revealed = card.revealed;
  const signalledThis = signalTargetId === card.user_id;
  const photo = revealed?.photo_ids[0];

  return (
    <li>
      <article className={cx('rounded-card border bg-panel p-5 shadow-card', signalledThis ? 'border-accent/60' : 'border-brass/40')}>
        <header className="mb-4 flex items-center gap-4">
          {revealed ? (
            photo ? (
              // Plain img: photos come from the authenticated, private /api/photos endpoint.
              <img
                src={`/api/photos/${photo}`}
                alt={`Photo of ${revealed.first_name}`}
                className="h-16 w-16 animate-fade-in rounded-full object-cover ring-2 ring-brass/50"
              />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-forest font-serif text-2xl text-ink ring-2 ring-brass/50" aria-hidden="true">
                {revealed.first_name.slice(0, 1)}
              </span>
            )
          ) : (
            <span className="h-16 w-16 rounded-full bg-gradient-to-br from-forest to-raised blur-[2px]" aria-hidden="true" />
          )}
          <div>
            <p className="eyebrow text-brass">Mutual resonance</p>
            <p className="font-serif text-2xl">{revealed ? revealed.first_name : 'Name sealed until Sunday'}</p>
          </div>
        </header>

        <CardBody profile={card} />

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="quiet" onClick={() => onOpenScenarios(card)}>
            {card.scenario_exchange.comparison_ready
              ? 'See your comparison'
              : card.scenario_exchange.answered_by_me >= 2
                ? 'Waiting on their answers'
                : 'Scenario exchange'}
          </Button>
          {matchId && signalledThis ? (
            <Link href={`/matches/${matchId}`} className="tap rounded-full bg-accent px-6 text-sm font-medium text-canvas">
              Open your match
            </Link>
          ) : signalledThis ? (
            <Badge tone="accent">#1 Signal sealed</Badge>
          ) : phase === 'signal' && revealed && !signalTargetId ? (
            <Button onClick={() => onSignal(card)}>Send #1 Signal</Button>
          ) : null}
        </div>
      </article>
    </li>
  );
}
