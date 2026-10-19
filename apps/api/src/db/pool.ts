import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-time Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 });
}

async function inTransaction<T>(db: Db, setup: (tx: Tx) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await setup(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction scoped to an end user: row-level security sees only that user's own stakes. */
export function withUserTx<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(
    db,
    async (tx) => {
      await tx.query("SELECT set_config('app.current_user_id', $1, true), set_config('app.role', 'user', true)", [userId]);
    },
    fn,
  );
}

/** Transaction for the escrow state machine and scheduled jobs (bypasses user-scoped RLS). */
export function withSystemTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(
    db,
    async (tx) => {
      await tx.query("SELECT set_config('app.role', 'system', true), set_config('app.current_user_id', '', true)");
    },
    fn,
  );
}
