import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ESCROW_PAIR_SALT: z.string().min(32, 'ESCROW_PAIR_SALT must be at least 32 characters'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** The web app proxies /api to this address, so the API only needs to listen locally. */
  API_HOST: z.string().default('127.0.0.1'),
  /** Comma-separated list of every address the site is opened from, e.g. "http://192.168.1.50:3000,http://30plus:3000". */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SMTP_URL: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Thirty Dates <hello@thirtydates.local>'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MATCHING_TOP_K: z.coerce.number().int().min(6).max(200).default(24),
  /** Development only: start the service clock at this ISO instant (it keeps ticking). */
  CLOCK_OVERRIDE: z.string().datetime({ offset: true }).optional(),
});

export type AppConfig = z.infer<typeof schema> & {
  /** Normalised origins from WEB_ORIGIN; the first is the default for links sent without a request origin. */
  WEB_ORIGINS: string[];
};

/** Parses a comma-separated origin list into normalised `scheme://host[:port]` values. */
export function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      let url: URL;
      try {
        url = new URL(s);
      } catch {
        throw new Error(`Invalid configuration: WEB_ORIGIN entry "${s}" is not a URL`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Invalid configuration: WEB_ORIGIN entry "${s}" must start with http:// or https://`);
      }
      return url.origin;
    });
  if (origins.length === 0) throw new Error('Invalid configuration: WEB_ORIGIN must list at least one address');
  return [...new Set(origins)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV !== 'development' && parsed.data.CLOCK_OVERRIDE) {
    throw new Error('Invalid configuration: CLOCK_OVERRIDE is only allowed in development');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.SMTP_URL) {
    throw new Error('Invalid configuration: SMTP_URL is required in production');
  }
  return { ...parsed.data, WEB_ORIGINS: parseOrigins(parsed.data.WEB_ORIGIN) };
}
