import { z } from 'zod';
import type { AppContext } from '../context.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { magicLinkEmail } from './mailer.js';

const MAGIC_LINK_TTL_MINUTES = 15;
const MAX_LINKS_PER_EMAIL_PER_HOUR = 5;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();

/**
 * Issues a single-use magic link. Always resolves the same way whether or not the address is
 * known, so the endpoint cannot be used to enumerate members.
 */
export async function requestMagicLink(ctx: AppContext, rawEmail: string): Promise<void> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw badRequest('invalid_email', 'Enter a valid email address');
  const email = parsed.data;

  const recent = await ctx.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM magic_link_tokens WHERE email = $1 AND created_at > now() - interval '1 hour'`,
    [email],
  );
  if (recent.rows[0]!.n >= MAX_LINKS_PER_EMAIL_PER_HOUR) {
    ctx.log.warn({ email }, 'magic link throttled');
    return;
  }

  const token = randomToken(32);
  await ctx.db.query(
    `INSERT INTO magic_link_tokens (email, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [email, sha256(token), MAGIC_LINK_TTL_MINUTES],
  );
  const link = `${ctx.config.WEB_ORIGIN}/auth/verify?token=${encodeURIComponent(token)}`;
  await ctx.mailer.send({ to: email, ...magicLinkEmail(link) });
}

export interface VerifiedSession {
  userId: string;
  tokenVersion: number;
  onboarded: boolean;
}

/** Consumes a magic link, creating the account on first use. Verifies the email address. */
export async function consumeMagicLink(ctx: AppContext, token: string): Promise<VerifiedSession> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) {
    throw badRequest('invalid_link', 'This sign-in link is invalid or has expired');
  }
  const consumed = await ctx.db.query<{ email: string }>(
    `UPDATE magic_link_tokens SET consumed_at = now()
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING email`,
    [sha256(token)],
  );
  const email = consumed.rows[0]?.email;
  if (!email) throw badRequest('invalid_link', 'This sign-in link is invalid or has expired');

  const { rows } = await ctx.db.query<{
    id: string;
    token_version: number;
    is_active: boolean;
    deactivated_reason: string | null;
    onboarding_completed_at: Date | null;
  }>(
    `INSERT INTO users (email, email_verified_at) VALUES ($1, now())
     ON CONFLICT (email) DO UPDATE SET email_verified_at = coalesce(users.email_verified_at, now())
     RETURNING id, token_version, is_active, deactivated_reason, onboarding_completed_at`,
    [email],
  );
  const user = rows[0]!;
  if (!user.is_active) {
    throw forbidden(
      'account_inactive',
      user.deactivated_reason === 'aged_out'
        ? 'This platform is for members aged 30 to 55.'
        : 'This account is no longer active.',
    );
  }
  return { userId: user.id, tokenVersion: user.token_version, onboarded: user.onboarding_completed_at !== null };
}

/** Invalidates every outstanding session for the user. */
export async function revokeSessions(ctx: AppContext, userId: string): Promise<void> {
  await ctx.db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
}
