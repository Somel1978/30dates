import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { withSystemTx } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { orderedPair } from '../lib/crypto.js';
import { removeVoiceFiles, voiceKeysForUser } from './exchange.js';

/**
 * Block someone you have been dealt or matched with. Removes them from all future batches and
 * closes any match between you.
 */
export async function blockUser(ctx: AppContext, userId: string, targetId: string): Promise<void> {
  const now = ctx.now();
  await withSystemTx(ctx.db, async (tx) => {
    const [lo, hi] = orderedPair(userId, targetId);
    const related = await tx.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM weekly_batches WHERE user_id = $1 AND card_user_ids @> ARRAY[$2::uuid])
                   OR EXISTS (SELECT 1 FROM weekly_batches WHERE user_id = $2 AND card_user_ids @> ARRAY[$1::uuid])
                   OR EXISTS (SELECT 1 FROM matches WHERE user_a_id = $3 AND user_b_id = $4)`,
      [userId, targetId, lo, hi],
    );
    if (!related.rowCount) throw notFound('user_not_found', 'You can only block people you have been introduced to');

    await tx.query(
      'INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, targetId],
    );
    const closed = await tx.query<{ id: string }>(
      `UPDATE matches SET status = 'expired', expired_at = $3, expired_reason = 'blocked'
        WHERE user_a_id = $1 AND user_b_id = $2 AND status <> 'expired' RETURNING id`,
      [lo, hi, now],
    );
    if (closed.rowCount) {
      await tx.query(
        `UPDATE bridge_events SET status = 'cancelled', raincheck_proposed_starts_at = NULL, raincheck_expires_at = NULL
          WHERE match_id = $1 AND status IN ('scheduled', 'raincheck_pending')`,
        [closed.rows[0]!.id],
      );
    }
  });
}

/** Permanently delete the account: escrow stakes are wiped first, everything else cascades. */
export async function deleteAccount(ctx: AppContext, userId: string): Promise<void> {
  const now = ctx.now();
  const keys = await withSystemTx(ctx.db, async (tx) => {
    await tx.query(
      `UPDATE escrow_vault SET
         status = 'wiped', wiped_at = $2, mutual_at = NULL, revealed_at = NULL,
         user_a_id = NULL, user_b_id = NULL, user_a_action = NULL, user_b_action = NULL,
         user_a_acted_at = NULL, user_b_acted_at = NULL
       WHERE user_a_id = $1 OR user_b_id = $1`,
      [userId, now],
    );
    const photos = await tx.query<{ storage_key: string }>('SELECT storage_key FROM user_photos WHERE user_id = $1', [userId]);
    const voice = await voiceKeysForUser(tx, userId);
    await tx.query('DELETE FROM users WHERE id = $1', [userId]);
    return { photos: photos.rows.map((r) => r.storage_key), voice };
  });
  await Promise.all(keys.photos.map((k) => unlink(path.join(path.resolve(ctx.config.UPLOAD_DIR), k)).catch(() => undefined)));
  await removeVoiceFiles(ctx, keys.voice);
}
