'use client';

import type { BatchCard, CurrentBatchResponse } from '@thirtydates/shared';
import type { Ref } from 'react';
import { cx } from './primitives';

/**
 * The Freeze Vault, resting at the foot of the table all week: one place to keep a person you're
 * not ready to decide on, so they come back next Monday. Drop a card's "Keep for next week"
 * button here, or simply tap it.
 */
export function FreezeVault({
  freeze,
  frozenCard,
  dragging,
  over,
  vaultRef,
  onUnfreeze,
  busy,
}: {
  freeze: CurrentBatchResponse['freeze'];
  frozenCard: BatchCard | undefined;
  dragging: boolean;
  over: boolean;
  vaultRef: Ref<HTMLDivElement>;
  onUnfreeze: () => void;
  busy: boolean;
}) {
  let body: React.ReactNode;
  if (frozenCard) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink/80">
          Keeping <span className="font-serif text-lg italic">{frozenCard.interests[0]?.label.toLowerCase()}</span>, about{' '}
          {frozenCard.distance_km} km away, for next Monday.
        </p>
        <button type="button" onClick={onUnfreeze} disabled={busy} className="tap rounded-full px-4 text-sm text-muted hover:text-ink disabled:opacity-40">
          Put back on the table
        </button>
      </div>
    );
  } else if (freeze.used_for === 'raincheck') {
    body = <p className="text-muted">This week’s Freeze went on a raincheck for a first meeting.</p>;
  } else {
    body = (
      <p className={cx(dragging ? 'text-brass' : 'text-muted')}>
        {dragging ? 'Let go here to keep them for next week.' : 'Keep one person for next Monday.'}
      </p>
    );
  }

  return (
    <div className="sticky bottom-3 z-30 mx-auto mt-12 max-w-2xl">
      <div
        ref={vaultRef}
        role="region"
        aria-label="Freeze Vault"
        className={cx(
          'flex items-center gap-3 rounded-[1.5rem] border border-dashed px-4 py-2.5 backdrop-blur-md transition-colors duration-200 ease-calm',
          dragging && over ? 'border-brass bg-brass/20' : dragging ? 'border-brass/60 bg-raised/95' : 'border-line bg-raised/90',
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest/40 text-brass" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M12 2v20M4.9 6.5l14.2 11M4.9 17.5l14.2-11M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5" />
          </svg>
        </span>
        <div className="flex-1 text-sm leading-snug">
          <p className="font-serif text-base">Freeze Vault</p>
          {body}
        </div>
      </div>
    </div>
  );
}
