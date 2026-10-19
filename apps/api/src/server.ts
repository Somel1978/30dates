import { buildApp } from './app.js';
import { createContext } from './runtime.js';
import { pendingMigrations } from './db/migrate.js';

const ctx = createContext('api');

// Code and schema ship together: refuse to run against a database that misses a migration,
// rather than answering every request that touches the new tables with a 500.
const pending = await pendingMigrations(ctx.db);
if (pending.length > 0) {
  ctx.log.error({ pending }, 'database schema is behind this build: run `npm run db:migrate`, then restart');
  await ctx.db.end();
  process.exit(1);
}

const app = await buildApp(ctx);

const shutdown = async () => {
  await app.close();
  await ctx.db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: ctx.config.API_PORT, host: ctx.config.API_HOST });
