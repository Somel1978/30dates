import type { AppConfig } from './config.js';
import type { Db } from './db/pool.js';
import type { Mailer } from './services/mailer.js';

export interface Logger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/** Everything a service needs. `now` is injectable so the weekly state machine is testable. */
export interface AppContext {
  db: Db;
  config: AppConfig;
  mailer: Mailer;
  log: Logger;
  now: () => Date;
  /** Development only: move the service clock (null returns to real time). Absent in production. */
  setNow?: (instant: Date | null) => void;
}
