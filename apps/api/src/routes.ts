import { BRIDGE_MODES, MAX_ANSWER_BYTES, MAX_PROMPTS_PER_PICK } from '@thirtydates/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from './app.js';
import { isJobName, runJob } from './jobs.js';
import { badRequest, notFound } from './lib/errors.js';
import { blockUser, deleteAccount } from './services/account.js';
import { consumeMagicLink, requestMagicLink, revokeSessions } from './services/auth.js';
import { freezeCard, getCurrentBatch, unfreezeCard } from './services/batches.js';
import { acceptRaincheck, requestRaincheck, setBridgePreference } from './services/bridge.js';
import { recordEscrowAction } from './services/escrow.js';
import { getMatch, listMatches, listMessages, sendMessage } from './services/matches.js';
import { CLOCK_TARGETS, counterpartsAct, dealNow, devStatus, moveClock, requireDevTools, seedMembersAround, selectMe } from './services/devTools.js';
import { getExchange, lockAnswers, pickPrompts, readAnswerAudio } from './services/exchange.js';
import { completeOnboarding, getMe, getProfile, onboardingSchema, setPaused } from './services/onboarding.js';
import { addPhoto, deletePhoto, readPhoto } from './services/photos.js';

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
      await requestMagicLink(ctx, email, app.siteOrigin(req));
      return reply.status(202).send({ sent: true });
    },
  );

  app.post(
    '/auth/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { token } = parse(z.object({ token: z.string() }), req.body);
      const session = await consumeMagicLink(ctx, token);
      await app.startSession(reply, session.userId, session.tokenVersion, app.siteOrigin(req));
      return { onboarded: session.onboarded };
    },
  );

  app.post('/auth/logout', authed, async (req, reply) => {
    await revokeSessions(ctx, req.auth.userId);
    app.endSession(reply);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------------ profile
  app.get('/me', authed, async (req) => getMe(ctx, req.auth.userId));

  app.delete('/me', authed, async (req, reply) => {
    await deleteAccount(ctx, req.auth.userId);
    app.endSession(reply);
    return reply.status(204).send();
  });

  app.get('/me/profile', member, async (req) => getProfile(ctx, req.auth.userId));

  app.post('/me/pause', member, async (req) => {
    const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
    await setPaused(ctx, req.auth.userId, paused);
    return getProfile(ctx, req.auth.userId);
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

  // Stage 2: select a whole profile into blind escrow. The response never varies with the
  // counterpart's state.
  app.post('/escrow/select', member, async (req, reply) => {
    const { target_user_id } = parse(targetBody, req.body);
    await recordEscrowAction(ctx, req.auth.userId, target_user_id, { kind: 'validated' });
    return reply.status(202).send({ accepted: true });
  });

  app.post('/escrow/pass', member, async (req, reply) => {
    const { target_user_id } = parse(targetBody, req.body);
    await recordEscrowAction(ctx, req.auth.userId, target_user_id, { kind: 'passed' });
    return reply.status(202).send({ accepted: true });
  });

  // ------------------------------------------------------------------ Stage 3: voice Q&A
  app.get('/exchanges/:id', member, async (req) => {
    const { id } = parse(idParams, req.params);
    return getExchange(ctx, req.auth.userId, id);
  });

  app.put('/exchanges/:id/questions', member, async (req) => {
    const { id } = parse(idParams, req.params);
    const { prompt_keys } = parse(
      z.object({ prompt_keys: z.array(z.string().max(48)).min(1).max(MAX_PROMPTS_PER_PICK) }),
      req.body,
    );
    return pickPrompts(ctx, req.auth.userId, id, prompt_keys);
  });

  // Lock: one audio file per question, form field name = prompt key. Final.
  app.post('/exchanges/:id/lock', member, async (req) => {
    const { id } = parse(idParams, req.params);
    const files: { promptKey: string; data: Buffer }[] = [];
    for await (const part of req.files({ limits: { files: MAX_PROMPTS_PER_PICK, fileSize: MAX_ANSWER_BYTES } })) {
      const data = await part.toBuffer();
      if (part.file.truncated) throw badRequest('invalid_audio', 'Each answer must be under 4 MB');
      files.push({ promptKey: part.fieldname, data });
    }
    const { released } = await lockAnswers(ctx, req.auth.userId, id, files);
    return { released, exchange: await getExchange(ctx, req.auth.userId, id) };
  });

  app.get('/exchanges/:id/audio/:answerer/:prompt', member, async (req, reply) => {
    const params = parse(
      z.object({ id: uuid, answerer: uuid, prompt: z.string().regex(/^[a-z_]{1,48}$/) }),
      req.params,
    );
    const audio = await readAnswerAudio(ctx, req.auth.userId, params.id, params.answerer, params.prompt);
    return reply
      .header('content-type', audio.contentType)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(audio.data);
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

  // ------------------------------------------------------------------ test tools (development only)
  if (ctx.config.NODE_ENV === 'development' && ctx.setNow) {
    const dev = { preHandler: [app.requireOnboarded, async () => void requireDevTools(ctx)] };
    // Signed-in is enough for the status (the menu shows the link right after sign-in).
    app.get('/dev/status', { preHandler: [app.authenticate, async () => void requireDevTools(ctx)] }, async (req) =>
      devStatus(ctx, req.auth.userId),
    );
    app.post('/dev/seed', dev, async (req) => {
      const { count } = parse(z.object({ count: z.number().int().min(1).max(60).optional() }), req.body ?? {});
      await seedMembersAround(ctx, req.auth.userId, count ?? 24);
      return devStatus(ctx, req.auth.userId);
    });
    app.post('/dev/deal', dev, async (req) => {
      await dealNow(ctx);
      return devStatus(ctx, req.auth.userId);
    });
    app.post('/dev/select-me', dev, async (req) => {
      const { count } = parse(z.object({ count: z.number().int().min(1).max(6).optional() }), req.body ?? {});
      await selectMe(ctx, req.auth.userId, count ?? 3);
      return devStatus(ctx, req.auth.userId);
    });
    app.post('/dev/counterparts-act', dev, async (req) => {
      await counterpartsAct(ctx, req.auth.userId);
      return devStatus(ctx, req.auth.userId);
    });
    app.post('/dev/clock', dev, async (req) => {
      const { to } = parse(z.object({ to: z.enum(CLOCK_TARGETS) }), req.body);
      await moveClock(ctx, to);
      return devStatus(ctx, req.auth.userId);
    });
  }

  // ------------------------------------------------------------------ cron
  app.post('/cron/:job', cron, async (req) => {
    const { job } = parse(z.object({ job: z.string() }), req.params);
    if (!isJobName(job)) throw notFound('unknown_job', `Unknown job ${job}`);
    return runJob(ctx, job);
  });
}
