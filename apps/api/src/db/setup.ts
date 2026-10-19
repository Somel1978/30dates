import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * One-time database bootstrap for a natively installed (or hosted) PostgreSQL.
 *
 * Connects with ADMIN_DATABASE_URL (a superuser, e.g. the default `postgres` role) and creates,
 * idempotently, the role and database named in DATABASE_URL plus the PostGIS and pgvector
 * extensions. The application role is deliberately not a superuser so row-level security on
 * the escrow tables applies to it.
 *
 * Usage: npm run db:setup   (then npm run db:migrate)
 */
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function setupDatabase(adminUrl: string, appUrl: string, log: (msg: string) => void = console.log): Promise<void> {
  const app = new URL(appUrl);
  const role = decodeURIComponent(app.username);
  const password = decodeURIComponent(app.password);
  const database = app.pathname.replace(/^\//, '');
  if (!role || !database) throw new Error('DATABASE_URL must include a username and a database name');

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (!roleExists.rowCount) {
      await admin.query(`CREATE ROLE ${ident(role)} LOGIN${password ? ` PASSWORD ${literal(password)}` : ''}`);
      log(`created role ${role}`);
    }
    const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!dbExists.rowCount) {
      await admin.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(role)}`);
      log(`created database ${database}`);
    }
  } finally {
    await admin.end();
  }

  const adminUrlForDb = new URL(adminUrl);
  adminUrlForDb.pathname = `/${database}`;
  const db = new pg.Client({ connectionString: adminUrlForDb.toString() });
  await db.connect();
  try {
    for (const ext of ['postgis', 'vector']) {
      try {
        await db.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
      } catch (err) {
        throw new Error(
          `Could not enable the "${ext}" extension: ${(err as Error).message}. ` +
            'Install it for your PostgreSQL version first (see README → Database).',
        );
      }
    }
    await db.query(`GRANT ALL ON SCHEMA public TO ${ident(role)}`);
    log(`extensions postgis and vector enabled in ${database}`);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) {
    console.error('ADMIN_DATABASE_URL and DATABASE_URL are required');
    process.exit(1);
  }
  setupDatabase(adminUrl, appUrl).catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
