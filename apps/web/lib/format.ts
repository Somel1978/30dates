/** All instants arrive as UTC ISO strings; these helpers render them in the viewer's zone. */

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatDayTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

/** Silent tactile confirmation; a no-op where vibration is unsupported. */
export function haptic(pattern: number | number[] = 10): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is best-effort.
  }
}

/** "6 Days Left" style label for the big gold deadline on each screen. */
export function formatLeft(ms: number): string {
  if (ms <= 0) return 'Closed';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days} ${days === 1 ? 'Day' : 'Days'} Left`;
  if (hours >= 1) return `${hours} ${hours === 1 ? 'Hour' : 'Hours'} Left`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes} ${minutes === 1 ? 'Minute' : 'Minutes'} Left`;
}

/** "31h 40m" (total hours), for mono countdowns. */
export function formatHm(ms: number): string {
  if (ms <= 0) return '0h 00m';
  const minutes = Math.floor(ms / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
