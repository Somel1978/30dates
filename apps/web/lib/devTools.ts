'use client';

import { useEffect, useState } from 'react';

/** True when the API exposes the development-only test tools (and the viewer is a member). */
export function useDevToolsAvailable(recheckKey?: string): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/dev/status', { credentials: 'same-origin' })
      .then((res) => !cancelled && setAvailable(res.ok))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recheckKey]);
  return available;
}
