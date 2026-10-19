import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { AppContext } from './context.js';
import { HttpError, badRequest, forbidden, unauthorized } from './lib/errors.js';
import { safeEqual } from './lib/crypto.js';
import { registerRoutes } from './routes.js';

export const SESSION_COOKIE = 'td_session';
const SESSION_TTL_SECONDS = 30 * 24 * 3600;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; tv: number };
    user: { sub: string; tv: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: { userId: string; onboarded: boolean };
  }
  interface FastifyInstance {
    ctx: AppContext;
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireOnboarded: (req: FastifyRequest) => Promise<void>;
    requireCron: (req: FastifyRequest) => Promise<void>;
    startSession: (reply: FastifyReply, userId: string, tokenVersion: number, origin: string) => Promise<void>;
    /** The request's Origin when it is one of WEB_ORIGINS, otherwise the first configured origin. */
    siteOrigin: (req: FastifyRequest) => string;
  }
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('invalid_request', 'The request is invalid', result.error.flatten());
  }
  return result.data;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null as unknown as FastifyRequest['auth']);

  await app.register(cookie);
  await app.register(jwt, {
    secret: ctx.config.JWT_SECRET,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { expiresIn: SESSION_TTL_SECONDS },
  });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });

  const allowedOrigins = new Set(ctx.config.WEB_ORIGINS);

  // CSRF defence for cookie auth: state-changing browser requests must come from one of the site's own addresses.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw forbidden('bad_origin', 'Cross-origin request rejected');
  });

  app.decorate('siteOrigin', (req: FastifyRequest) => {
    const origin = req.headers.origin;
    return origin && allowedOrigins.has(origin) ? origin : ctx.config.WEB_ORIGINS[0]!;
  });

  app.decorate('startSession', async (reply: FastifyReply, userId: string, tokenVersion: number, origin: string) => {
    const token = await reply.jwtSign({ sub: userId, tv: tokenVersion });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      // Secure when this address is HTTPS; a plain-http LAN address would never send it back.
      secure: origin.startsWith('https://'),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
  });

  app.decorate('authenticate', async (req: FastifyRequest) => {
    let payload: { sub: string; tv: number };
    try {
      payload = await req.jwtVerify<{ sub: string; tv: number }>();
    } catch {
      throw unauthorized();
    }
    const { rows } = await ctx.db.query<{ token_version: number; is_active: boolean; onboarding_completed_at: Date | null }>(
      'SELECT token_version, is_active, onboarding_completed_at FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) throw unauthorized('Session expired');
    req.auth = { userId: payload.sub, onboarded: user.onboarding_completed_at !== null };
  });

  app.decorate('requireOnboarded', async (req: FastifyRequest) => {
    await app.authenticate(req);
    if (!req.auth.onboarded) throw forbidden('onboarding_required', 'Finish onboarding first');
  });

  app.decorate('requireCron', async (req: FastifyRequest) => {
    const provided = req.headers['x-cron-secret'];
    if (typeof provided !== 'string' || !safeEqual(provided, ctx.config.CRON_SECRET)) throw unauthorized('Invalid cron secret');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid_request', message: 'The request is invalid', details: err.flatten() });
    }
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === '23514' && pgErr.message?.includes('age_out_of_bounds')) {
      return reply.status(422).send({ error: 'age_out_of_bounds', message: 'This platform is for members aged 30 to 55.' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: (err as { code?: string }).code ?? 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  app.get('/healthz', async () => {
    await ctx.db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(registerRoutes, { prefix: '/api' });
  return app;
}
