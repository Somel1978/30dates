'use client';

import type { CurrentBatchResponse } from '@thirtydates/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Check, ChevronLeft, Snowflake } from '@/components/icons';
import { CardBody, profileMeta } from '@/components/MondayCard';
import { BottomSheet, Button, Notice, Spinner, StickyActions } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

/**
 * A single folio: one whole person, read top to bottom. The only actions are to hold them in
 * blind escrow or freeze them for next week; there is no pass, and no swiping between folios.
 */
export default function FolioPage() {
  const { id } = useParams<{ id: string }>();
  const session = useMemberSession();
  const batch = useResource<CurrentBatchResponse>(session.ready ? '/batches/current' : null);
  const [confirm, setConfirm] = useState<'hold' | 'freeze' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const data = batch.data;
  if (!data) return batch.error ? <Notice tone="error">{batch.error.message}</Notice> : <Spinner />;
  const index = data.cards.findIndex((c) => c.user_id === id);
  const card = data.cards[index];
  if (!card) return <Notice tone="error">This folio isn’t in your batch this week.</Notice>;

  const choosing = data.phase === 'selection';
  const left = data.selections_remaining;
  const canFreeze = choosing && data.freeze.token_available && !data.freeze.frozen_user_id && !card.carried_over && !card.selected;
  const freezeTokens = data.freeze.token_available && !data.freeze.frozen_user_id ? 1 : 0;

  const act = async (kind: 'hold' | 'freeze' | 'unfreeze') => {
    setConfirm(null);
    setBusy(true);
    setError(undefined);
    try {
      if (kind === 'hold') await api('/escrow/select', { method: 'POST', body: { target_user_id: card.user_id } });
      else if (kind === 'freeze') await api('/batches/current/freeze', { method: 'POST', body: { target_user_id: card.user_id } });
      else await api('/batches/current/freeze', { method: 'DELETE' });
      haptic(kind === 'hold' ? [8, 40, 14] : 12);
      await batch.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article>
      <div className="flex items-center justify-between">
        <Link href="/" className="tap -ml-2 gap-1.5 px-2 text-[13.5px] text-ink/85 hover:text-ink">
          <ChevronLeft size={16} />
          Back to {data.cards.length} Profiles
        </Link>
        {choosing && <span className="pill">{left} of 3 holds left</span>}
      </div>

      <p className="mt-4 text-[13px]">
        <span className="text-ink">
          Profile {String(index + 1).padStart(2, '0')} of {String(data.cards.length).padStart(2, '0')}
        </span>
        <span className="text-muted"> · {profileMeta(card)}</span>
      </p>
      {card.carried_over && <p className="mt-1 text-[13px] text-brass">You froze this folio last week.</p>}

      <div className="mt-4">
        <CardBody profile={card} />
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <StickyActions>
        {!choosing ? (
          <p className="py-3 text-center text-sm text-muted">Holding has closed for this week.</p>
        ) : card.selected ? (
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Link href="/" className="tap rounded-2xl border border-line bg-panel px-4 text-[13.5px]">
              Back
            </Link>
            <Button disabled className="w-full !opacity-100">
              Held in Blind Escrow <Check size={16} />
            </Button>
          </div>
        ) : card.frozen ? (
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="quiet" busy={busy} onClick={() => act('unfreeze')}>
              Unfreeze
            </Button>
            <Button disabled className="w-full">
              Frozen until next Monday
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="quiet" className="px-4 text-[13.5px]" disabled={!canFreeze || busy} onClick={() => setConfirm('freeze')}>
              <Snowflake size={15} />
              Freeze ({freezeTokens})
            </Button>
            <Button className="w-full" busy={busy} disabled={left === 0} onClick={() => setConfirm('hold')}>
              {left > 0 ? (
                <>
                  Hold Into Blind Escrow <Check size={16} />
                </>
              ) : (
                'All 3 holds used'
              )}
            </Button>
          </div>
        )}
      </StickyActions>

      <BottomSheet open={confirm !== null} title={confirm === 'hold' ? 'Hold this folio?' : 'Freeze for next week?'} onClose={() => setConfirm(null)}>
        <p className="text-sm leading-relaxed text-ink/80">
          {confirm === 'hold'
            ? 'Your hold is sealed. They only ever learn of it if they hold you too; then you’ll exchange voice questions on Wednesday. Holds are final for the week.'
            : 'Spends your one Freeze token this week. This folio comes back in next Monday’s batch.'}
        </p>
        <div className="mt-5 space-y-2">
          <Button className="w-full" onClick={() => act(confirm === 'hold' ? 'hold' : 'freeze')}>
            {confirm === 'hold' ? 'Hold into blind escrow' : 'Freeze this folio'}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirm(null)}>
            Not yet
          </Button>
        </div>
      </BottomSheet>
    </article>
  );
}
