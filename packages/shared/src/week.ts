/**
 * The weekly ritual clock. Every boundary is a UTC instant; clients only format them.
 *
 *   Mon 00:00 ─ awaiting_deal ─ Mon 07:00 ─ validation ─ Sun 00:00 ─ sealed ─ Sun 06:00
 *   ─ reveal ─ Sun 18:00 ─ signal ─ Mon 00:00 (next week)
 *
 * The mid-week scenario exchange unlocks Wed 00:00 for mutually validated pairs.
 */
export type WeekPhase = 'awaiting_deal' | 'validation' | 'sealed' | 'reveal' | 'signal';

export interface WeekClock {
  /** ISO date (YYYY-MM-DD) of the Monday that identifies the batch week. */
  batchWeek: string;
  phase: WeekPhase;
  weekStart: Date;
  dealAt: Date;
  scenarioUnlockAt: Date;
  stampsCloseAt: Date;
  revealAt: Date;
  signalOpensAt: Date;
  signalClosesAt: Date;
  nextDealAt: Date;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function mondayOf(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return new Date(d.getTime() - (isoDow - 1) * DAY);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(isoDay: string, days: number): string {
  return isoDate(new Date(parseIsoDate(isoDay).getTime() + days * DAY));
}

export function weekClockFor(batchWeek: string, now: Date): WeekClock {
  const weekStart = parseIsoDate(batchWeek);
  const t = weekStart.getTime();
  const clock = {
    batchWeek,
    weekStart,
    dealAt: new Date(t + 7 * HOUR),
    scenarioUnlockAt: new Date(t + 2 * DAY),
    stampsCloseAt: new Date(t + 6 * DAY),
    revealAt: new Date(t + 6 * DAY + 6 * HOUR),
    signalOpensAt: new Date(t + 6 * DAY + 18 * HOUR),
    signalClosesAt: new Date(t + 7 * DAY),
    nextDealAt: new Date(t + 7 * DAY + 7 * HOUR),
  };
  const n = now.getTime();
  let phase: WeekPhase;
  if (n < clock.dealAt.getTime()) phase = 'awaiting_deal';
  else if (n < clock.stampsCloseAt.getTime()) phase = 'validation';
  else if (n < clock.revealAt.getTime()) phase = 'sealed';
  else if (n < clock.signalOpensAt.getTime()) phase = 'reveal';
  else phase = 'signal';
  return { ...clock, phase };
}

export function weekClock(now: Date): WeekClock {
  return weekClockFor(isoDate(mondayOf(now)), now);
}
