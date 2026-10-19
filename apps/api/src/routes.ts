import { BRIDGE_MODES, CARD_LINES, RESONANCE_STAMPS } from '@thirtydates/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, parse } from './app.js';
import { isJobName, runJob } from './jobs.js';
import { badRequest, notFound } from './lib/errors.js';
import { blockUser, deleteAccount } from './services/account.js';
import { consumeMagicLink, requestMagicLink, revokeSessions } from './services/auth.js';
import { freezeCard, getCurrentBatch, unfreezeCard } from './services/batches.js';
import { acceptRaincheck, requestRaincheck, setBridgePreference } from './services/bridge.js';
import { recordEscrowAction } from './services/escrow.js';
import { getMatch, listMatches, listMessages, sendMessage } from './services/matches.js';
import { completeOnboarding, getMe, onboardingSchema } from './services/onboarding.js';
import { addPhoto, deletePhoto, readPhoto } from './services/photos.js';
import { answerScenario, getScenarioExchange } from './services/scenarios.js';
import { submitSignal } from './services/signals.js';

const uuid = z.string().uuid().transform((s) => s.toLowerCase());
const targetBody = z.object({ target_user_id: uuid });
const idParams = z.object({ id: uuid });

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const { ctx } = app;
  const authed = { preHandler: app.authenticate };
  const member = { preHandler: app.requireOnboarded };
  const cron = { preHandler: app.requireCron };

  // ------------------------------------------------------------------ auth
  app.post(
    '/auth/magic-link',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email } = parse(z.object({ email: z.string() }), req.body);
      await requestMagicLink(ctx, email);
      return reply.status(202).send({ sent: true });
    },
  );

  app.post(
    '/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = parse(z.object({ token: z.string() }), req.body);
      const session = await consumeMagicLink(ctx, token);
      await app.startSession(reply, session.userId, session.tokenVersion);
      return { onboarded: session.onboarded };
    },
  );

  app.post('/auth/logout', authed, async (req, reply) => {
    await revokeSessions(ctx, req.auth.userId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ profile
  app.get('/me', authed, async (req) => getMe(ctx, req.auth.userId));

  app.delete('/me', authed, async (req, reply) => {
    await deleteAccount(ctx, req.auth.userId);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.post('/onboarding', authed, async (req) => {
    await completeOnboarding(ctx, req.auth.userId, parse(onboardingSchema, req.body));
    return getMe(ctx, req.auth.userId);
  });

  app.post('/profile/photos', authed, async (req, reply) => {
    const file = await req.file();
    if (!file) throw badRequest('invalid_photo', 'Attach an image file');
    const data = await file.toBuffer();
    if (file.file.truncated) throw badRequest('invalid_photo', 'Photos must be under 5 MB');
    return reply.status(201).send(await addPhoto(ctx, req.auth.userId, data));
  });

  app.delete('/profile/photos/:id', authed, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    await deletePhoto(ctx, req.auth.userId, id);
    return reply.status(204).send();
  });

  app.get('/photos/:id', authed, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const photo = await readPhoto(ctx, req.auth.userId, id);
    return reply
      .header('content-type', photo.contentType)
      .header('cache-control', 'private, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .send(photo.data);
  });

  app.post('/blocks', member, async (req, reply) => {
    const { target_user_id } = parse(targetBody, req.body);
    await blockUser(ctx, req.auth.userId, target_user_id);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ weekly ritual
  app.get('/batches/current', member, async (req) => getCurrentBatch(ctx, req.auth.userId));

  app.post('/batches/current/freeze', member, async (req, reply) => {
    const { target_user_id } = parse(targetBody, req.body);
    await freezeCard(ctx, req.auth.userId, target_user_id);
    return reply.status(204).send();
  });

  app.delete('/batches/current/freeze', member, async (req, reply) => {
    await unfreezeCard(ctx, req.auth.userId);
    return reply.status(204).send();
  });

  // Silent validation. The response never varies with the counterpart's state.
  app.post('/escrow/validate', member, async (req, reply) => {
    const body = parse(
      z.object({
        target_user_id: uuid,
        resonance_stamp_type: z.enum(RESONANCE_STAMPS),
        card_line: z.enum(CARD_LINES),
      }),
      req.body,
    );
    await recordEscrowAction(ctx, req.auth.userId, body.target_user_id, {
      kind: 'validated',
      stamp: body.resonance_stamp_type,
      line: body.card_line,
    });
    return reply.status(202).send({ accepted: true });
  });

  app.post('/escrow/pass', member, async (req, reply) => {
    const { target_user_id } = parse(targetBody, req.body);
    await recordEscrowAction(ctx, req.auth.userId, target_user_id, { kind: 'passed' });
    return reply.status(202).send({ accepted: true });
  });

  // Sunday 06:00 reveal; also triggered by the worker. Protected by the cron secret.
  app.post('/escrow/reveal', cron, async () => runJob(ctx, 'sunday-reveal'));

  app.post('/escrow/signal', member, async (req) => {
    const { target_user_id } = parse(targetBody, req.body);
    const { matchId } = await submitSignal(ctx, req.auth.userId, target_user_id);
    return { accepted: true, match_id: matchId };
  });

  app.get('/scenarios/:id', member, async (req) => {
    const { id } = parse(idParams, req.params);
    return getScenarioExchange(ctx, req.auth.userId, id);
  });

  app.post('/scenarios/:id', member, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ scenario_key: z.string().max(48), stance_key: z.string().max(48) }), req.body);
    return answerScenario(ctx, req.auth.userId, id, body.scenario_key, body.stance_key);
  });

  // ------------------------------------------------------------------ matches & bridge
  app.get('/matches', member, async (req) => listMatches(ctx, req.auth.userId));

  app.get('/matches/:id', member, async (req) => {
    const { id } = parse(idParams, req.params);
    return getMatch(ctx, req.auth.userId, id);
  });

  app.put('/matches/:id/bridge', member, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ mode: z.enum(BRIDGE_MODES), slots: z.array(z.string().datetime({ offset: true })).min(1).max(21) }),
      req.body,
    );
    const outcome = await setBridgePreference(ctx, req.auth.userId, id, body.mode, body.slots);
    return { ...(await getMatch(ctx, req.auth.userId, id)), bridge_outcome: outcome.state };
  });

  app.post('/matches/:id/raincheck', member, async (req) => {
    const { id } = parse(idParams, req.params);
    await requestRaincheck(ctx, req.auth.userId, id);
    return getMatch(ctx, req.auth.userId, id);
  });

  app.post('/matches/:id/raincheck/accept', member, async (req) => {
    const { id } = parse(idParams, req.params);
    await acceptRaincheck(ctx, req.auth.userId, id);
    return getMatch(ctx, req.auth.userId, id);
  });

  app.get('/matches/:id/messages', member, async (req) => {
    const { id } = parse(idParams, req.params);
    const { since } = parse(z.object({ since: z.string().datetime({ offset: true }).optional() }), req.query);
    return listMessages(ctx, req.auth.userId, id, since ? new Date(since) : null);
  });

  app.post(
    '/matches/:id/messages',
    { ...member, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = parse(idParams, req.params);
      const { body } = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
      return reply.status(201).send(await sendMessage(ctx, req.auth.userId, id, body));
    },
  );

  // ------------------------------------------------------------------ cron
  app.post('/cron/:job', cron, async (req) => {
    const { job } = parse(z.object({ job: z.string() }), req.params);
    if (!isJobName(job)) throw notFound('unknown_job', `Unknown job ${job}`);
    return runJob(ctx, job);
  });
}
