'use client';

import type { BatchCard, CurrentBatchResponse } from '@thirtydates/shared';
import type { Ref } from 'react';
import { ChevronRight, Snowflake } from './icons';
import { cx } from './primitives';

/**
 * The Freeze Vault bar, resting above the tab bar all week. One token a week keeps one person
 * for next Monday. Tap it for details, or press and hold a tile and drop it here.
 */
export function FreezeVault({
  freeze,
  frozenCard,
  dragging,
  over,
  vaultRef,
  onOpen,
}: {
  freeze: CurrentBatchResponse['freeze'];
  frozenCard: BatchCard | undefined;
  dragging: boolean;
  over: boolean;
  vaultRef: Ref<HTMLButtonElement>;
  onOpen: () => void;
}) {
  const available = freeze.token_available && !freeze.frozen_user_id;
  let label: string;
  if (dragging) label = 'Drop here to keep for next week';
  else if (frozenCard) label = `Freeze Vault · ${frozenCard.interests[0]?.label ?? 'one card'} kept`;
  else if (freeze.used_for === 'raincheck') label = 'Freeze Vault (used on a raincheck)';
  else label = `Freeze Vault (${available ? 1 : 0} Available)`;

  return (
    <div className="sticky bottom-[4.75rem] z-30 mt-5">
      <button
        ref={vaultRef}
        type="button"
        onClick={onOpen}
        className={cx(
          'flex min-h-[3.5rem] w-full items-center gap-3 rounded-2xl border px-4 text-left shadow-card backdrop-blur-md transition-colors duration-200',
          dragging && over ? 'border-brass bg-brass/25' : dragging ? 'border-dashed border-brass/70 bg-raised/95' : 'border-line bg-raised/95',
        )}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine text-sky-200/90">
          <Snowflake size={18} />
        </span>
        <span className="flex-1 font-medium">{label}</span>
        {!dragging && <ChevronRight size={18} className="text-muted" />}
      </button>
    </div>
  );
}
