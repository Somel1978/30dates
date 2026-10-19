import { loadConfig } from './config.js';
import type { AppContext, Logger } from './context.js';
import { createPool } from './db/pool.js';
import { createMailer } from './services/mailer.js';

export function consoleLogger(name: string): Logger {
  const write = (level: string) => (obj: object | string, msg?: string) => {
    const entry = typeof obj === 'string' ? { msg: obj } : { ...obj, msg };
    console.log(JSON.stringify({ level, name, time: new Date().toISOString(), ...entry }));
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

/** Real time, optionally shifted. The shift can be moved at runtime in development (test tools). */
function clock(override: string | undefined) {
  let offset = override ? Date.parse(override) - Date.now() : 0;
  return {
    now: () => new Date(Date.now() + offset),
    set: (instant: Date | null) => {
      offset = instant ? instant.getTime() - Date.now() : 0;
    },
  };
}

export function createContext(name: string): AppContext {
  const config = loadConfig();
  const log = consoleLogger(name);
  if (config.CLOCK_OVERRIDE) log.warn({ clock: config.CLOCK_OVERRIDE }, 'service clock overridden (development)');
  const serviceClock = clock(config.CLOCK_OVERRIDE);
  return {
    config,
    db: createPool(config.DATABASE_URL),
    mailer: createMailer(config.SMTP_URL, config.MAIL_FROM, log),
    log,
    now: serviceClock.now,
    ...(config.NODE_ENV === 'development' ? { setNow: serviceClock.set } : {}),
  };
}
