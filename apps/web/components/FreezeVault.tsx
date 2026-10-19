'use client';

import type { BatchCard, CurrentBatchResponse } from '@thirtydates/shared';
import type { Ref } from 'react';
import { CardVault } from './primitives';

/**
 * The Freeze Vault drop zone, pinned to the bottom of the table during the week. Drag a card's
 * grip here (or tap the grip) to carry it into next Monday's batch with this week's token.
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
  let hint: string;
  if (frozenCard) hint = 'Token spent on this card';
  else if (freeze.used_for === 'raincheck') hint = 'Token spent on a raincheck this week';
  else hint = dragging ? 'Release to freeze' : 'Drag a card’s grip here · 1 token';

  return (
    <div className="sticky bottom-3 z-30 mt-8">
      <CardVault
        vaultRef={vaultRef}
        label="Freeze Vault"
        hint={hint}
        highlight={dragging && over}
        className={`py-3 backdrop-blur-md ${dragging ? 'ring-1 ring-brass/40' : ''}`}
      >
        {!dragging && !frozenCard ? null : frozenCard ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-serif text-lg">{frozenCard.interests[0]?.label ?? 'Frozen card'}</p>
              <p className="text-sm text-muted">
                {frozenCard.distance_km} km away · returns next Monday
              </p>
            </div>
            <button
              type="button"
              onClick={onUnfreeze}
              disabled={busy}
              className="tap rounded-full px-4 text-sm text-muted hover:text-ink disabled:opacity-40"
            >
              Return to the table
            </button>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-brass">Drop here to see this card again next Monday.</p>
        )}
      </CardVault>
    </div>
  );
}
