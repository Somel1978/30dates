import { Cron } from 'croner';
import { JOB_NAMES, JOB_SCHEDULE, jobIsDue, runJob, type JobName } from './jobs.js';
import { createContext } from './runtime.js';

/**
 * Scheduler process. Runs every job on its UTC cron, guarded by a session-level advisory lock
 * so only one worker executes a given job at a time, and catches up on start-up for any
 * boundary that passed while no worker was running (all jobs are idempotent).
 */
const ctx = createContext('worker');

async function execute(name: JobName): Promise<void> {
  const client = await ctx.db.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [`job:${name}`]);
    if (!rows[0]!.ok) return;
    try {
      await runJob(ctx, name);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [`job:${name}`]);
    }
  } catch (err) {
    ctx.log.error({ job: name, err: (err as Error).message }, 'job failed');
  } finally {
    client.release();
  }
}

const crons = JOB_NAMES.map(
  (name) => new Cron(JOB_SCHEDULE[name], { timezone: 'UTC', protect: true, name }, () => execute(name)),
);

for (const name of JOB_NAMES) {
  if (jobIsDue(name, ctx.now())) await execute(name);
}
ctx.log.info({ jobs: crons.map((c) => ({ name: c.name, next: c.nextRun()?.toISOString() })) }, 'worker started');

const shutdown = async () => {
  crons.forEach((c) => c.stop());
  await ctx.db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
