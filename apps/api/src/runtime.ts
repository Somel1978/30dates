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

export function createContext(name: string): AppContext {
  const config = loadConfig();
  const log = consoleLogger(name);
  return {
    config,
    db: createPool(config.DATABASE_URL),
    mailer: createMailer(config.SMTP_URL, config.MAIL_FROM, log),
    log,
    now: () => new Date(),
  };
}
