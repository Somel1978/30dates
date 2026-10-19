'use client';

import { RESONANCE_STAMPS, STAMP_META, type CardLine, type ResonanceStamp } from '@thirtydates/shared';
import { useEffect, useState } from 'react';
import { haptic } from '@/lib/format';
import { BottomSheet, Notice, cx } from './primitives';

const LINE_CONTEXT: Record<CardLine, string> = {
  badges: 'the whole card',
  interest_1: 'their first interest',
  interest_2: 'their second interest',
  interest_3: 'their third interest',
  flaw: 'their flaw',
  upside: 'the upside',
};

export interface ResonanceStampModalProps {
  open: boolean;
  line: CardLine;
  stampsRemaining: number;
  onClose: () => void;
  /** Performs the silent blind-escrow call; reject to show an error. */
  onSelect: (stamp: ResonanceStamp) => Promise<void>;
}

/**
 * Tactile bottom sheet with the four semantic stamps. Tapping one seals it into blind escrow
 * with a visual "press" and a short vibration — never a sound.
 */
export function ResonanceStampModal({ open, line, stampsRemaining, onClose, onSelect }: ResonanceStampModalProps) {
  const [pressed, setPressed] = useState<ResonanceStamp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPressed(null);
      setError(null);
    }
  }, [open]);

  const choose = async (stamp: ResonanceStamp) => {
    if (pressed) return;
    setPressed(stamp);
    setError(null);
    try {
      await onSelect(stamp);
      haptic([8, 40, 14]);
      window.setTimeout(onClose, 650);
    } catch (err) {
      setPressed(null);
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    }
  };

  return (
    <BottomSheet open={open} title="Leave a resonance stamp" onClose={onClose}>
      <p className="-mt-2 mb-5 text-sm text-muted">
        On {LINE_CONTEXT[line]}. They will never know unless they stamp you too.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {RESONANCE_STAMPS.map((stamp) => {
          const meta = STAMP_META[stamp];
          const isPressed = pressed === stamp;
          return (
            <button
              key={stamp}
              type="button"
              onClick={() => choose(stamp)}
              disabled={pressed !== null && !isPressed}
              aria-pressed={isPressed}
              className={cx(
                'flex min-h-[7.5rem] flex-col items-start justify-between rounded-2xl border p-4 text-left transition-all duration-200 ease-calm active:scale-[0.97]',
                isPressed ? 'border-brass bg-brass/10' : 'border-line bg-raised/50 hover:border-muted',
                pressed !== null && !isPressed && 'opacity-40',
              )}
            >
              <span className={cx('text-3xl', isPressed && 'animate-stamp-press')} aria-hidden="true">
                {meta.glyph}
              </span>
              <span className="text-sm leading-snug">{meta.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Notice>
          {pressed ? 'Sealed in escrow.' : `${stampsRemaining} of 3 stamps left this week`}
        </Notice>
        <button type="button" onClick={onClose} className="tap rounded-full px-4 text-sm text-muted hover:text-ink">
          Not now
        </button>
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </BottomSheet>
  );
}
