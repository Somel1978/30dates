import { weekClock } from '@thirtydates/shared';
import type { AppContext } from './context.js';
import { runMondayBatch } from './matching/matching.js';
import { runBridgeMaintenance } from './services/bridge.js';
import { runExchangeTick } from './services/exchange.js';
import { conflict } from './lib/errors.js';

export const JOB_NAMES = ['monday-deal', 'late-deal', 'exchange-tick', 'bridge-maintenance', 'aged-out-sweep'] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** UTC cron schedule for each job (minute hour day-of-month month day-of-week). */
export const JOB_SCHEDULE: Record<JobName, string> = {
  'monday-deal': '0 7 * * 1',
  // Tops up late joiners and anyone short of six cards, hourly while selection is open.
  'late-deal': '20 * * * *',
  // Wednesday seal, Thursday Response Clock start and Friday expiry; each step is idempotent.
  'exchange-tick': '* * * * *',
  'bridge-maintenance': '*/5 * * * *',
  'aged-out-sweep': '5 0 * * *',
};

export function isJobName(name: string): name is JobName {
  return (JOB_NAMES as readonly string[]).includes(name);
}

/** Whether the job may run now (also used for start-up catch-up). */
export function jobIsDue(name: JobName, now: Date): boolean {
  switch (name) {
    case 'monday-deal':
    case 'late-deal':
      // Cards are only dealt while selection is open.
      return weekClock(now).phase === 'selection';
    default:
      return true;
  }
}

/**
 * Every job is idempotent, so the scheduler, start-up catch-up and the authenticated cron
 * endpoint can all trigger them safely.
 */
export async function runJob(ctx: AppContext, name: JobName): Promise<unknown> {
  const now = ctx.now();
  const clock = weekClock(now);
  const runKey = name === 'monday-deal' || name === 'aged-out-sweep' ? clock.batchWeek : now.toISOString().slice(0, 16);
  if (!jobIsDue(name, now)) throw conflict('job_not_due', `${name} is not due yet for week ${clock.batchWeek}`);

  await ctx.db.query(
    `INSERT INTO job_runs (job_name, run_key, started_at) VALUES ($1, $2, now())
     ON CONFLICT (job_name, run_key) DO UPDATE SET started_at = now(), completed_at = NULL`,
    [name, runKey],
  );

  let result: unknown;
  switch (name) {
    case 'monday-deal':
    case 'late-deal':
      result = await runMondayBatch(ctx.db, clock.batchWeek, ctx.config.MATCHING_TOP_K);
      break;
    case 'exchange-tick':
      result = await runExchangeTick(ctx);
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
