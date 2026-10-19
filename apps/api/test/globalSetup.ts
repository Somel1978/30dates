import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { ADMIN_URL, APP_PASSWORD, APP_ROLE, TEST_DB, adminUrlFor, appUrl } from './env.js';

export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  if (!role.rowCount) {
    await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD.replace(/'/g, "''")}'`);
  }
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB} OWNER ${APP_ROLE}`);
  await admin.end();

  const db = new pg.Client({ connectionString: adminUrlFor(TEST_DB) });
  await db.connect();
  await db.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await db.query('CREATE EXTENSION IF NOT EXISTS vector');
  await db.query(`GRANT ALL ON SCHEMA public TO ${APP_ROLE}`);
  await db.end();

  await migrate(appUrl(), () => undefined);
}
