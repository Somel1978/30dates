'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/format';

/**
 * Live countdown to a UTC deadline. `serverNow` corrects for a wrong device clock: the offset
 * observed at fetch time is applied to every tick.
 */
export function Countdown({ to, serverNow, className }: { to: string; serverNow: string; className?: string }) {
  const [skew] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + skew), 1_000);
    return () => window.clearInterval(id);
  }, [skew]);
  const left = Date.parse(to) - now;
  return (
    <span className={className} aria-live="off">
      {left > 0 ? formatDuration(left) : 'closed'}
    </span>
  );
}
