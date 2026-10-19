import { weekClock } from '@thirtydates/shared';
import type { AppContext } from './context.js';
import { runMondayBatch } from './matching/matching.js';
import { runBridgeMaintenance } from './services/bridge.js';
import { runSundayReveal } from './services/escrow.js';
import { purgeClosedSignals } from './services/signals.js';
import { conflict } from './lib/errors.js';

export const JOB_NAMES = ['monday-deal', 'sunday-reveal', 'signal-close', 'bridge-maintenance', 'aged-out-sweep'] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** UTC cron schedule for each job (minute hour day-of-month month day-of-week). */
export const JOB_SCHEDULE: Record<JobName, string> = {
  'monday-deal': '0 7 * * 1',
  'sunday-reveal': '0 6 * * 0',
  'signal-close': '0 0 * * 1',
  'bridge-maintenance': '*/5 * * * *',
  'aged-out-sweep': '5 0 * * *',
};

export function isJobName(name: string): name is JobName {
  return (JOB_NAMES as readonly string[]).includes(name);
}

/** Whether the job's boundary for the current week has passed (used for start-up catch-up). */
export function jobIsDue(name: JobName, now: Date): boolean {
  const clock = weekClock(now);
  switch (name) {
    case 'monday-deal':
      return clock.phase !== 'awaiting_deal';
    case 'sunday-reveal':
      return clock.phase === 'reveal' || clock.phase === 'signal';
    default:
      return true;
  }
}

/**
 * Every job is idempotent: re-running it for the same week changes nothing, so the scheduler,
 * start-up catch-up and the authenticated cron endpoint can all trigger them safely.
 */
export async function runJob(ctx: AppContext, name: JobName): Promise<unknown> {
  const now = ctx.now();
  const clock = weekClock(now);
  const runKey = name === 'bridge-maintenance' ? now.toISOString().slice(0, 16) : clock.batchWeek;
  if (!jobIsDue(name, now)) throw conflict('job_not_due', `${name} is not due yet for week ${clock.batchWeek}`);

  await ctx.db.query(
    `INSERT INTO job_runs (job_name, run_key, started_at) VALUES ($1, $2, now())
     ON CONFLICT (job_name, run_key) DO UPDATE SET started_at = now(), completed_at = NULL`,
    [name, runKey],
  );

  let result: unknown;
  switch (name) {
    case 'monday-deal':
      result = await runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K);
      break;
    case 'sunday-reveal':
      result = await runSundayReveal(ctx, clock.batchWeek);
      break;
    case 'signal-close':
      result = { purged: await purgeClosedSignals(ctx) };
      break;
    case 'bridge-maintenance':
      result = await runBridgeMaintenance(ctx);
      break;
    case 'aged-out-sweep': {
      const res = await ctx.db.query(
        `UPDATE users SET is_active = false, deactivated_reason = 'aged_out'
          WHERE is_active AND birth_date IS NOT NULL AND age_in_years(birth_date, utc_today()) > 55`,
      );
      result = { deactivated: res.rowCount ?? 0 };
      break;
    }
  }

  await ctx.db.query(
    'UPDATE job_runs SET completed_at = now(), result = $3::jsonb WHERE job_name = $1 AND run_key = $2',
    [name, runKey, JSON.stringify(result)],
  );
  ctx.log.info({ job: name, runKey, result }, 'job completed');
  return result;
}
