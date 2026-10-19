import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ESCROW_PAIR_SALT: z.string().min(32, 'ESCROW_PAIR_SALT must be at least 32 characters'),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  SMTP_URL: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Thirty Dates <hello@thirtydates.local>'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MATCHING_TOP_K: z.coerce.number().int().min(6).max(200).default(24),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.SMTP_URL) {
    throw new Error('Invalid configuration: SMTP_URL is required in production');
  }
  return parsed.data;
}
