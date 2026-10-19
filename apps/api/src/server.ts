import { buildApp } from './app.js';
import { createContext } from './runtime.js';

const ctx = createContext('api');
const app = await buildApp(ctx);

const shutdown = async () => {
  await app.close();
  await ctx.db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: ctx.config.API_PORT, host: ctx.config.API_HOST });
