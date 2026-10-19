import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../context.js';
import { withSystemTx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Identify the image by its magic bytes; the client-declared MIME type is not trusted. */
export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function storagePath(ctx: AppContext, key: string): string {
  return path.join(path.resolve(ctx.config.UPLOAD_DIR), key);
}

export async function addPhoto(ctx: AppContext, userId: string, data: Buffer): Promise<{ id: string; position: number }> {
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) throw badRequest('invalid_photo', 'Photos must be under 5 MB');
  const type = sniffImageType(data);
  if (!type) throw badRequest('invalid_photo', 'Upload a JPEG, PNG or WebP image');

  const key = `${randomUUID()}.${type.split('/')[1]}`;
  await mkdir(path.resolve(ctx.config.UPLOAD_DIR), { recursive: true });
  await writeFile(storagePath(ctx, key), data, { mode: 0o600 });
  try {
    return await withSystemTx(ctx.db, async (tx) => {
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const taken = await tx.query<{ position: number }>('SELECT position FROM user_photos WHERE user_id = $1', [userId]);
      const used = new Set(taken.rows.map((r) => r.position));
      const position = [1, 2, 3].find((p) => !used.has(p));
      if (!position) throw conflict('photo_limit', `You can keep up to ${MAX_PHOTOS} photos`);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO user_photos (user_id, position, storage_key, content_type, byte_size)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [userId, position, key, type, data.length],
      );
      return { id: rows[0]!.id, position };
    });
  } catch (err) {
    await unlink(storagePath(ctx, key)).catch(() => undefined);
    throw err;
  }
}

export async function deletePhoto(ctx: AppContext, userId: string, photoId: string): Promise<void> {
  const { rows } = await ctx.db.query<{ storage_key: string }>(
    'DELETE FROM user_photos WHERE id = $1 AND user_id = $2 RETURNING storage_key',
    [photoId, userId],
  );
  if (!rows[0]) throw notFound('photo_not_found', 'Photo not found');
  await unlink(storagePath(ctx, rows[0].storage_key)).catch(() => undefined);
}

/**
 * Photos stay blurred (unserved) until escrow unlocks them: only the owner, a revealed mutual
 * pair, or a confirmed match may fetch them.
 */
export async function readPhoto(
  ctx: AppContext,
  viewerId: string,
  photoId: string,
): Promise<{ data: Buffer; contentType: string }> {
  const row = await withSystemTx(ctx.db, async (tx) => {
    const { rows } = await tx.query<{ storage_key: string; content_type: string }>(
      `SELECT p.storage_key, p.content_type
         FROM user_photos p
        WHERE p.id = $1
          AND (
            p.user_id = $2
            OR EXISTS (
              SELECT 1 FROM escrow_vault e
               WHERE e.status = 'mutual_unlocked' AND e.revealed_at IS NOT NULL
                 AND e.user_a_id = LEAST(p.user_id, $2::uuid) AND e.user_b_id = GREATEST(p.user_id, $2::uuid)
            )
            OR EXISTS (
              SELECT 1 FROM matches m
               WHERE m.user_a_id = LEAST(p.user_id, $2::uuid) AND m.user_b_id = GREATEST(p.user_id, $2::uuid)
            )
          )`,
      [photoId, viewerId],
    );
    return rows[0];
  });
  if (!row) throw notFound('photo_not_found', 'Photo not found');
  return { data: await readFile(storagePath(ctx, row.storage_key)), contentType: row.content_type };
}
