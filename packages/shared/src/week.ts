/**
 * The weekly ritual clock. Every boundary is a UTC instant; clients only format them.
 *
 *   Mon 00:00 ─ awaiting_deal ─ Mon 07:00 ─ selection ─ Wed 00:00 ─ exchange_questions ─ Thu 00:00
 *   ─ exchange_answers (36 h Response Clock) ─ Fri 12:00 ─ bridge ─ Mon 00:00 (next week)
 *
 * Stage 2 (blind selection): six faceless cards, up to three whole profiles into blind escrow.
 * Stage 3 (Wednesday): mutual pairs each pick 2–3 questions for the other from the prompt bank;
 *   answers are recorded during the 36-hour Response Clock, double-blind until both lock.
 * Stage 4: the instant both lock, names and photos unblur together and the First-Meet Bridge
 *   opens. Exchanges still open when the clock runs out close silently.
 */
export type WeekPhase = 'awaiting_deal' | 'selection' | 'exchange_questions' | 'exchange_answers' | 'bridge';

export interface WeekClock {
  /** ISO date (YYYY-MM-DD) of the Monday that identifies the batch week. */
  batchWeek: string;
  phase: WeekPhase;
  weekStart: Date;
  dealAt: Date;
  selectionClosesAt: Date;
  questionsCloseAt: Date;
  answersCloseAt: Date;
  nextDealAt: Date;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Length of the Response Clock for voice answers. */
export const RESPONSE_CLOCK_HOURS = 36;

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
  const questionsCloseAt = new Date(t + 3 * DAY);
  const clock = {
    batchWeek,
    weekStart,
    dealAt: new Date(t + 7 * HOUR),
    selectionClosesAt: new Date(t + 2 * DAY),
    questionsCloseAt,
    answersCloseAt: new Date(questionsCloseAt.getTime() + RESPONSE_CLOCK_HOURS * HOUR),
    nextDealAt: new Date(t + 7 * DAY + 7 * HOUR),
  };
  const n = now.getTime();
  let phase: WeekPhase;
  if (n < clock.dealAt.getTime()) phase = 'awaiting_deal';
  else if (n < clock.selectionClosesAt.getTime()) phase = 'selection';
  else if (n < clock.questionsCloseAt.getTime()) phase = 'exchange_questions';
  else if (n < clock.answersCloseAt.getTime()) phase = 'exchange_answers';
  else phase = 'bridge';
  return { ...clock, phase };
}

export function weekClock(now: Date): WeekClock {
  return weekClockFor(isoDate(mondayOf(now)), now);
}
