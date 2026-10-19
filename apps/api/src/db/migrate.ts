import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../db/migrations');

/** Migration files not yet recorded in schema_migrations (all of them on an empty database). */
export async function pendingMigrations(db: Pick<pg.Pool, 'query'>): Promise<string[]> {
  const table = await db.query<{ t: string | null }>(`SELECT to_regclass('schema_migrations') AS t`);
  const done = new Set(
    table.rows[0]?.t ? (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name) : [],
  );
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql') && !done.has(f)).sort();
}

export async function migrate(connectionString: string, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['schema_migrations']);
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['schema_migrations']).catch(() => undefined);
    await client.end();
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  migrate(url)
    .then((applied) => {
      console.log(applied.length ? `${applied.length} migration(s) applied` : 'schema up to date');
    })
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
}
