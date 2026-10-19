'use client';

import type { BatchCard, CardProfile } from '@thirtydates/shared';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Badge, cx } from './primitives';

/**
 * Faceless, nameless profile body: Life Rhythm, behavioral interests with their receipts, and
 * the split Flaw + Upside coin. Read as one whole portrait; structural gates are never shown.
 */
export function CardBody({ profile }: { profile: CardProfile }) {
  return (
    <>
      {/* Top: distance and Life Rhythm */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brass">{profile.distance_km} km away</Badge>
        <p className="text-sm text-muted">{profile.rhythm.join(' · ')}</p>
      </div>

      {/* Middle: three behavioral interests with receipts */}
      <ul role="list" className="mt-4 space-y-3 rounded-2xl border border-line/60 bg-raised/40 p-4">
        {profile.interests.map((interest) => (
          <li key={interest.position}>
            <p className="font-serif text-xl leading-snug">{interest.label}</p>
            <p className="text-sm text-muted">
              <span className="text-brass" aria-hidden="true">
                ✓{' '}
              </span>
              <span className="sr-only">Receipt: </span>
              {interest.receipt}
            </p>
          </li>
        ))}
      </ul>

      {/* Bottom: the split Flaw + Upside coin */}
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[2rem] border border-line/70">
        <div className="border-r border-line/70 bg-forest/15 px-4 py-3">
          <p className="eyebrow">My flaw</p>
          <p className="mt-1 font-serif text-lg italic leading-snug">{profile.coin.flaw}</p>
        </div>
        <div className="bg-brass/5 px-4 py-3">
          <p className="eyebrow">Your upside</p>
          <p className="mt-1 font-serif text-lg italic leading-snug">{profile.coin.upside}</p>
        </div>
      </div>
    </>
  );
}

export interface MondayCardProps {
  card: BatchCard;
  /** Selection is open (Monday 07:00 – Tuesday night). */
  interactive: boolean;
  selectionsRemaining: number;
  canFreeze: boolean;
  onSelect: (card: BatchCard) => void;
  onPass: (card: BatchCard) => void;
  onFreeze: (card: BatchCard) => void;
  onDragStart?: (card: BatchCard, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** The Monday faceless card: zero photos, zero names, one whole-profile choice. */
export function MondayCard({
  card,
  interactive,
  selectionsRemaining,
  canFreeze,
  onSelect,
  onPass,
  onFreeze,
  onDragStart,
}: MondayCardProps) {
  const decided = card.my_action !== null;
  const canAct = interactive && !decided && !card.frozen;

  return (
    <li>
      <article
        aria-label={`Card, ${card.distance_km} kilometres away`}
        className={cx(
          'relative flex h-full flex-col rounded-card border bg-panel p-5 shadow-card transition-opacity duration-300 ease-calm',
          card.my_action === 'validated' ? 'border-brass/60' : 'border-line/70',
          card.my_action === 'passed' && 'opacity-50',
        )}
      >
        {card.carried_over && <p className="eyebrow mb-3 text-brass">Carried over from last week</p>}

        <CardBody profile={card} />

        <div className="mt-5 flex flex-1 items-end justify-between gap-2">
          {decided ? (
            <p className={cx('text-sm', card.my_action === 'validated' ? 'text-brass' : 'text-muted')} role="status">
              {card.my_action === 'validated' ? 'Selected. Sealed in blind escrow.' : 'Passed quietly.'}
            </p>
          ) : card.frozen ? (
            <p className="text-sm text-brass" role="status">
              In the Freeze Vault. It returns next Monday.
            </p>
          ) : canAct ? (
            <>
              <button
                type="button"
                onClick={() => onSelect(card)}
                disabled={selectionsRemaining === 0}
                className="tap rounded-full border border-brass/60 px-6 text-sm font-medium text-brass hover:bg-brass/10 disabled:border-line disabled:text-muted"
              >
                {selectionsRemaining > 0 ? 'Select' : 'No selections left'}
              </button>
              <div className="flex items-center">
                {canFreeze && (
                  <button
                    type="button"
                    onPointerDown={(e) => onDragStart?.(card, e)}
                    onClick={() => onFreeze(card)}
                    className="tap touch-none rounded-full text-muted hover:text-brass"
                    aria-label="Move to the Freeze Vault (tap, or drag to the vault)"
                    title="Drag to the Freeze Vault"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="9" cy="6" r="1.5" />
                      <circle cx="15" cy="6" r="1.5" />
                      <circle cx="9" cy="12" r="1.5" />
                      <circle cx="15" cy="12" r="1.5" />
                      <circle cx="9" cy="18" r="1.5" />
                      <circle cx="15" cy="18" r="1.5" />
                    </svg>
                  </button>
                )}
                <button type="button" onClick={() => onPass(card)} className="tap rounded-full px-4 text-sm text-muted hover:text-ink">
                  Pass
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Selection is closed for this week.</p>
          )}
        </div>
      </article>
    </li>
  );
}
