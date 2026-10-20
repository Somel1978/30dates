'use client';

import type { BatchCard, CardProfile } from '@thirtydates/shared';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Person, Seal, Snowflake } from './icons';
import { cx } from './primitives';

/** Faceless placeholder: a soft silhouette, blurred until the release. */
export function BlurredAvatar({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-b from-[#4A5B59] to-[#2B3A39] ring-1 ring-white/10', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Person size={size * 0.62} className="translate-y-[12%] text-[#8E9C99] blur-[1.5px]" strokeWidth={0} fill="currentColor" />
    </span>
  );
}

/**
 * The whole faceless card: how this person lives, three things they actually do (in their own
 * words) and their Flaw + Upside coin. Structural gates are never shown.
 */
export function CardBody({ profile }: { profile: CardProfile }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BlurredAvatar size={52} />
        <div>
          <p className="text-[0.8125rem] text-muted">About {profile.distance_km} km away</p>
          <p className="font-medium leading-snug">{profile.rhythm.join(' · ')}</p>
        </div>
      </div>

      <p className="mt-5 text-xs font-medium uppercase tracking-[0.12em] text-brass/90">What fills their weeks</p>
      <ul role="list" className="mt-2 space-y-2">
        {profile.interests.map((interest) => (
          <li key={interest.position} className="rounded-xl border border-line bg-raised/60 px-4 py-3">
            <p className="font-medium">{interest.label}</p>
            <p className="mt-0.5 text-sm leading-snug text-ink/70">“{interest.receipt}”</p>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs font-medium uppercase tracking-[0.12em] text-brass/90">Flaw + Upside</p>
      <div className="mt-2 grid grid-cols-2 overflow-hidden rounded-xl border border-brass/30">
        <div className="bg-pine/50 px-4 py-3">
          <p className="text-xs text-muted">My flaw</p>
          <p className="mt-0.5 text-sm font-medium leading-snug">{profile.coin.flaw}</p>
        </div>
        <div className="border-l border-brass/30 bg-brass/[0.07] px-4 py-3">
          <p className="text-xs text-muted">Your upside</p>
          <p className="mt-0.5 text-sm font-medium leading-snug">{profile.coin.upside}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * One of the six Monday tiles. Tap "View Details" to read the whole card; press and hold the
 * tile to drag it into the Freeze Vault.
 */
export function CardTile({
  card,
  onOpen,
  onHoldStart,
}: {
  card: BatchCard;
  onOpen: (card: BatchCard) => void;
  onHoldStart?: (card: BatchCard, e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const lead = card.interests[0]?.label ?? 'Introduction';
  return (
    <li>
      <div
        onPointerDown={(e) => onHoldStart?.(card, e)}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          'no-callout relative flex h-full flex-col items-center rounded-2xl border bg-panel px-3 pb-3 pt-4 text-center shadow-card transition-colors',
          card.selected ? 'border-brass/70' : card.frozen ? 'border-sky-200/30' : 'border-line',
        )}
      >
        <span
          className={cx('absolute right-2.5 top-2.5', card.selected ? 'text-brass' : card.frozen ? 'text-sky-200/80' : 'text-muted/40')}
          aria-hidden="true"
        >
          {card.frozen ? <Snowflake size={18} /> : <Seal size={18} />}
        </span>
        <BlurredAvatar size={64} />
        <p className="mt-3 line-clamp-1 font-medium">{lead}</p>
        <p className="mb-3 line-clamp-1 text-xs text-muted">
          {card.selected ? 'You chose them' : card.frozen ? 'Kept for next week' : `${card.distance_km} km · ${card.rhythm[0] ?? ''}`}
        </p>
        <button
          type="button"
          onClick={() => onOpen(card)}
          className={cx(
            'mt-auto min-h-[2.75rem] w-full rounded-lg text-sm',
            card.selected || card.frozen ? 'border border-line bg-raised text-ink' : 'btn-gold',
          )}
        >
          View Details
        </button>
      </div>
    </li>
  );
}
