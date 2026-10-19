'use client';

import type { BatchCard, CardProfile } from '@thirtydates/shared';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cx } from './primitives';

/**
 * Faceless, nameless portrait: how this person lives, three things they actually do (in their
 * own words), and their Flaw + Upside coin. Written to be read like a short letter, not scanned
 * like a spec sheet. Structural gates are never shown.
 */
export function CardBody({ profile }: { profile: CardProfile }) {
  return (
    <>
      <p className="font-serif text-xl italic leading-snug text-ink/90">{profile.rhythm.join(', ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}.</p>
      <p className="mt-1 text-sm text-muted">About {profile.distance_km} km from you</p>

      <ul role="list" className="mt-6 space-y-5">
        {profile.interests.map((interest) => (
          <li key={interest.position}>
            <p className="font-serif text-2xl leading-tight">{interest.label}</p>
            <p className="mt-1 text-[1.0625rem] leading-relaxed text-ink/75">“{interest.receipt}”</p>
          </li>
        ))}
      </ul>

      {/* The Flaw + Upside coin: one honest trait, two faces. */}
      <figure className="mt-7 flex items-stretch overflow-hidden rounded-[1.75rem] border border-brass/30 bg-gradient-to-r from-forest/25 via-transparent to-brass/10">
        <div className="flex-1 py-4 pl-6 pr-4">
          <figcaption className="font-serif text-sm italic text-muted">My flaw</figcaption>
          <p className="font-serif text-lg leading-snug">{profile.coin.flaw}</p>
        </div>
        <span className="my-3 w-px bg-brass/30" aria-hidden="true" />
        <div className="flex-1 py-4 pl-4 pr-6 text-right">
          <p className="font-serif text-sm italic text-muted">Your upside</p>
          <p className="font-serif text-lg leading-snug">{profile.coin.upside}</p>
        </div>
      </figure>
    </>
  );
}

export interface MondayCardProps {
  card: BatchCard;
  /** Choosing is open (Monday 07:00 – Tuesday night). */
  interactive: boolean;
  choicesLeft: number;
  canFreeze: boolean;
  onChoose: (card: BatchCard) => void;
  onFreeze: (card: BatchCard) => void;
  onDragStart?: (card: BatchCard, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

function Snowflake() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5" />
    </svg>
  );
}

/**
 * The Monday faceless card. One gesture only: choose the whole person. There is no "pass":
 * anyone not chosen simply isn't, and is never shown again.
 */
export function MondayCard({ card, interactive, choicesLeft, canFreeze, onChoose, onFreeze, onDragStart }: MondayCardProps) {
  const canAct = interactive && !card.selected && !card.frozen;

  return (
    <li>
      <article
        aria-label={`Introduction, about ${card.distance_km} kilometres away`}
        className={cx(
          'relative flex h-full flex-col rounded-[2rem] bg-panel px-6 pb-6 pt-7 shadow-card ring-1 transition-shadow duration-300 ease-calm sm:px-8',
          card.selected ? 'ring-brass/60' : 'ring-line/50',
        )}
      >
        {card.carried_over && <p className="mb-3 font-serif text-sm italic text-brass">You kept this one from last week</p>}

        <CardBody profile={card} />

        <div className="mt-7 flex flex-1 flex-wrap items-end justify-between gap-3">
          {card.selected ? (
            <p className="font-serif text-lg italic text-brass" role="status">
              You’d like to hear from them. They’ll only know if they chose you too.
            </p>
          ) : card.frozen ? (
            <p className="font-serif text-lg italic text-brass" role="status">
              Kept in your Freeze Vault. They’ll be at your table again next Monday.
            </p>
          ) : canAct ? (
            <>
              <button
                type="button"
                onClick={() => onChoose(card)}
                disabled={choicesLeft === 0}
                className="tap rounded-full bg-accent px-6 font-medium text-canvas shadow-sm transition-colors hover:bg-accent/90 disabled:bg-line disabled:text-muted"
              >
                {choicesLeft > 0 ? 'I’d like to hear from them' : 'You’ve chosen three this week'}
              </button>
              {canFreeze && (
                <button
                  type="button"
                  onPointerDown={(e) => onDragStart?.(card, e)}
                  onClick={() => onFreeze(card)}
                  className="tap touch-none gap-2 rounded-full border border-line px-5 text-sm text-muted transition-colors hover:border-brass hover:text-brass"
                  title="Tap, or drag into the Freeze Vault below"
                >
                  <Snowflake />
                  Keep for next week
                </button>
              )}
            </>
          ) : (
            <p className="font-serif italic text-muted">Choosing has closed for this week.</p>
          )}
        </div>
      </article>
    </li>
  );
}
