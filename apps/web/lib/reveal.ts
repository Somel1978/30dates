'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The reveal moment is personal: the server releases name and photo the instant both lock, but
 * each person sees them only once they press Play on the other's voice. Remembered per device.
 */
const key = (exchangeId: string) => `td-revealed-${exchangeId}`;

function read(exchangeId: string): boolean {
  try {
    return localStorage.getItem(key(exchangeId)) === '1';
  } catch {
    return false;
  }
}

export function useRevealed(exchangeId: string | undefined): [boolean, () => void] {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (exchangeId) setRevealed(read(exchangeId));
  }, [exchangeId]);
  const reveal = useCallback(() => {
    if (!exchangeId) return;
    try {
      localStorage.setItem(key(exchangeId), '1');
    } catch {
      // Private mode: the reveal simply isn't remembered.
    }
    setRevealed(true);
  }, [exchangeId]);
  return [revealed, reveal];
}
