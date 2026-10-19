/**
 * Test database wiring. The admin URL (superuser) recreates the database and installs
 * extensions; the app URL is a non-superuser role so row-level security is really enforced.
 */
export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
export const APP_ROLE = process.env.TEST_APP_ROLE ?? 'thirtydates_app';
export const APP_PASSWORD = process.env.TEST_APP_PASSWORD ?? 'thirtydates_app';
export const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'thirtydates_test';

export function appUrl(): string {
  const url = new URL(ADMIN_URL);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

export function adminUrlFor(db: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${db}`;
  return url.toString();
}
