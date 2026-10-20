'use client';

import type { BatchCard, CurrentBatchResponse, ExchangeSummary, MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Countdown } from '@/components/Countdown';
import { FreezeVault } from '@/components/FreezeVault';
import { ChevronRight, Snowflake } from '@/components/icons';
import { BlurredAvatar, CardBody, CardTile } from '@/components/MondayCard';
import { BottomSheet, Button, Notice, Panel, ScreenHeader, Spinner } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { useDevToolsAvailable } from '@/lib/devTools';
import { formatDateTime, haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const HOLD_MS = 350;

const MATCH_STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Propose a meet-up',
  scheduled: 'You’re meeting',
  raincheck_pending: 'A new time has been proposed',
  met: 'You’ve met',
  expired: 'Closed',
};

const EXCHANGE_STATUS: Record<ExchangeSummary['status'], string> = {
  questions: 'Choose your questions',
  answering: 'Answer in your voice',
  released: 'It’s a match',
  expired: 'Closed quietly',
};

function ExchangeRow({ x, serverNow }: { x: ExchangeSummary; serverNow: string }) {
  const photo = x.revealed?.photo_ids[0];
  let detail: React.ReactNode;
  if (x.status === 'questions') detail = x.my_pick_count ? `${x.my_pick_count} questions chosen` : 'Pick 2–3 questions for them';
  else if (x.status === 'answering')
    detail = x.i_locked ? 'Sent · waiting for theirs' : <><Countdown to={x.answers_close_at} serverNow={serverNow} /> left to answer</>;
  else if (x.status === 'released') detail = 'Your photos are unblurred';
  else detail = 'Time ran out; nothing was shared';
  const href = x.status === 'released' && x.match_id ? `/matches/${x.match_id}` : `/exchanges/${x.id}`;

  return (
    <li>
      <Link
        href={href}
        aria-disabled={x.status === 'expired'}
        className={`flex min-h-[4.5rem] items-center gap-3.5 rounded-2xl border bg-panel px-4 py-3 shadow-card ${
          x.status === 'expired' ? 'pointer-events-none border-line opacity-50' : x.status === 'released' ? 'border-brass/70' : 'border-line'
        }`}
      >
        {x.revealed ? (
          photo ? (
            // Plain img: the authenticated, private photo endpoint.
            <img src={`/api/photos/${photo}`} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-brass/60" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine text-lg font-semibold ring-2 ring-brass/60">
              {x.revealed.first_name.slice(0, 1)}
            </span>
          )
        ) : (
          <BlurredAvatar size={48} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-brass">{EXCHANGE_STATUS[x.status]}</span>
          <span className="block truncate font-medium">
            {x.revealed ? `${x.revealed.first_name}, ${x.revealed.age}` : x.counterpart.interests.map((i) => i.label).join(' · ')}
          </span>
          <span className="block text-[0.8125rem] text-muted">{detail}</span>
        </span>
        <ChevronRight size={18} className="text-muted" />
      </Link>
    </li>
  );
}

export default function MondayBatchPage() {
  const session = useMemberSession();
  const devTools = useDevToolsAvailable();
  const batch = useResource<CurrentBatchResponse>(session.ready ? '/batches/current' : null, 60_000);
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null, 120_000);

  const [detail, setDetail] = useState<BatchCard | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string } | null>(null);

  // Press-and-hold drag into the Freeze Vault. Holding still for HOLD_MS arms the drag; moving
  // earlier is treated as a scroll, so the grid still scrolls normally under a thumb.
  const vaultRef = useRef<HTMLButtonElement>(null);
  const suppressTap = useRef(false);
  const [drag, setDrag] = useState<{ card: BatchCard; x: number; y: number } | null>(null);
  const [overVault, setOverVault] = useState(false);

  const data = batch.data;
  const choosing = data?.phase === 'selection';
  const canFreeze = !!choosing && !!data?.freeze.token_available && !data.freeze.frozen_user_id;

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await action();
        if (success) setMessage({ tone: 'muted', text: success });
        await Promise.all([batch.reload(), matches.reload()]);
        return true;
      } catch (err) {
        setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'That did not go through. Try again.' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [batch, matches],
  );

  const freeze = useCallback(
    (card: BatchCard) =>
      run(async () => {
        await api('/batches/current/freeze', { method: 'POST', body: { target_user_id: card.user_id } });
        haptic(14);
      }, 'Kept in your Freeze Vault. They’ll be back next Monday.'),
    [run],
  );

  const insideVault = (x: number, y: number) => {
    const r = vaultRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const holdStart = (card: BatchCard, e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canFreeze || card.selected || card.frozen || card.carried_over) return;
    const start = { x: e.clientX, y: e.clientY };
    let armed = false;
    const preventScroll = (ev: TouchEvent) => ev.preventDefault();
    const timer = window.setTimeout(() => {
      armed = true;
      haptic(12);
      document.addEventListener('touchmove', preventScroll, { passive: false });
      setDrag({ card, x: start.x, y: start.y });
    }, HOLD_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.removeEventListener('touchmove', preventScroll);
    };
    const move = (ev: PointerEvent) => {
      if (!armed) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) cleanup();
        return;
      }
      ev.preventDefault();
      setDrag({ card, x: ev.clientX, y: ev.clientY });
      setOverVault(insideVault(ev.clientX, ev.clientY));
    };
    const end = (ev: PointerEvent) => {
      cleanup();
      if (armed) {
        // Swallow the click that follows the drop; reset if none arrives.
        suppressTap.current = true;
        window.setTimeout(() => (suppressTap.current = false), 80);
        if (ev.type === 'pointerup' && insideVault(ev.clientX, ev.clientY)) void freeze(card);
      }
      setDrag(null);
      setOverVault(false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  useEffect(() => {
    // Keep the open sheet in step with fresh data (e.g. after choosing).
    if (detail && data) setDetail(data.cards.find((c) => c.user_id === detail.user_id) ?? null);
  }, [data]);

  if (!session.ready || (batch.loading && !data)) return <Spinner />;
  if (!data) return <Notice tone="error">{batch.error?.message ?? session.error?.message ?? 'Could not load your week.'}</Notice>;

  const frozenCard = data.cards.find((c) => c.frozen);
  const liveMatches = (matches.data ?? []).filter((m) => m.status !== 'expired');
  const midWeek = data.phase === 'exchange_questions' || data.phase === 'exchange_answers';
  const left = data.selections_remaining;

  let header: { title: string; subtitle: string; deadline?: string };
  if (data.phase === 'awaiting_deal') header = { title: 'Your Monday Batch', subtitle: 'Six introductions arrive this morning', deadline: data.clock.deal_at };
  else if (choosing) header = { title: 'Your Monday Batch', subtitle: 'Batch closes Tuesday at midnight', deadline: data.clock.selection_closes_at };
  else if (data.phase === 'exchange_questions') header = { title: 'Mid-Week Drop', subtitle: 'Choose questions until midnight', deadline: data.clock.questions_close_at };
  else if (data.phase === 'exchange_answers') header = { title: 'Mid-Week Drop', subtitle: 'Answer by voice before Friday noon', deadline: data.clock.answers_close_at };
  else header = { title: 'This week', subtitle: 'A new batch arrives Monday', deadline: data.clock.next_deal_at };

  const tapOpen = (card: BatchCard) => {
    if (suppressTap.current) {
      suppressTap.current = false;
      return;
    }
    setDetail(card);
  };

  return (
    <div>
      <ScreenHeader title={header.title} subtitle={header.subtitle}>
        {header.deadline && (
          <p className="mt-2 text-[1.75rem] font-semibold text-brass">
            <Countdown to={header.deadline} serverNow={data.server_now} style="left" />
          </p>
        )}
        {choosing && data.cards.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            {left > 0 ? `Choose up to ${left} more · no photos, no names yet` : 'You’ve chosen your three. Nothing else to do until Wednesday.'}
          </p>
        )}
      </ScreenHeader>

      {message && (
        <div className="mb-4 text-center">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {liveMatches.length > 0 && (
        <section className="mb-6" aria-labelledby="matches-heading">
          <h2 id="matches-heading" className="mb-2 text-base">
            Your matches
          </h2>
          <ul role="list" className="space-y-2.5">
            {liveMatches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} className="flex min-h-[4.5rem] items-center gap-3.5 rounded-2xl border border-brass/60 bg-panel px-4 py-3 shadow-card">
                  {m.counterpart.photo_ids[0] ? (
                    // Plain img: the authenticated, private photo endpoint.
                    <img src={`/api/photos/${m.counterpart.photo_ids[0]}`} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pine text-lg font-semibold">{m.counterpart.first_name.slice(0, 1)}</span>
                  )}
                  <span className="flex-1">
                    <span className="block font-medium">
                      {m.counterpart.first_name}, {m.counterpart.age}
                    </span>
                    <span className="block text-[0.8125rem] text-muted">
                      {m.event && m.status === 'scheduled' ? `Meeting ${formatDateTime(m.event.starts_at)}` : MATCH_STATUS[m.status]}
                    </span>
                  </span>
                  <ChevronRight size={18} className="text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.exchanges.length > 0 && (
        <section className="mb-6" aria-labelledby="exchanges-heading">
          <h2 id="exchanges-heading" className="mb-2 text-base">
            You chose each other
          </h2>
          <ul role="list" className="space-y-2.5">
            {data.exchanges.map((x) => (
              <ExchangeRow key={x.id} x={x} serverNow={data.server_now} />
            ))}
          </ul>
        </section>
      )}

      {midWeek && data.exchanges.length === 0 && (
        <Panel className="p-6 text-center">
          <p className="font-medium">Nothing became mutual this week</p>
          <p className="mt-1 text-sm text-muted">That’s part of the rhythm, and nobody was turned away. A new batch arrives Monday.</p>
        </Panel>
      )}

      {data.cards.length > 0 && !midWeek && (
        <ul role="list" className="grid grid-cols-2 gap-3">
          {data.cards.map((card) => (
            <CardTile key={card.user_id} card={card} onOpen={tapOpen} onHoldStart={holdStart} />
          ))}
        </ul>
      )}

      {data.cards.length === 0 && !midWeek && data.exchanges.length === 0 && (
        <Panel className="p-6 text-center">
          <p className="font-medium">{choosing ? 'No introductions yet' : 'Your table is being set'}</p>
          <p className="mt-1 text-sm text-muted">
            {choosing
              ? 'There’s nobody new near you who fits how you want to live just yet. We look again every hour until Tuesday night.'
              : 'A new batch of six arrives Monday morning.'}
          </p>
          {devTools && (
            <Link href="/test" className="tap btn-gold mt-5 rounded-xl px-6 text-sm">
              Open test tools
            </Link>
          )}
        </Panel>
      )}

      {choosing && data.cards.length > 0 && (
        <FreezeVault
          freeze={data.freeze}
          frozenCard={frozenCard}
          dragging={drag !== null}
          over={overVault}
          vaultRef={vaultRef}
          onOpen={() => setVaultOpen(true)}
        />
      )}

      {drag && (
        <div
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl border border-brass/70 bg-panel px-4 py-3 shadow-sheet"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <BlurredAvatar size={44} />
          <p className="mt-1 text-sm font-medium">{drag.card.interests[0]?.label}</p>
        </div>
      )}

      <BottomSheet tall open={detail !== null} title="Their card" onClose={() => setDetail(null)}>
        {detail && (
          <>
            {detail.carried_over && <p className="mb-3 text-sm text-brass">You kept this one from last week.</p>}
            <CardBody profile={detail} />
            <div className="mt-6 space-y-2.5">
              {detail.selected ? (
                <p className="rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-sm" role="status">
                  You chose them. They’ll only ever know if they chose you too.
                </p>
              ) : detail.frozen ? (
                <p className="rounded-xl border border-line bg-raised px-4 py-3 text-sm" role="status">
                  In your Freeze Vault. They’ll be back in next Monday’s batch.
                </p>
              ) : choosing ? (
                <>
                  <Button
                    className="w-full"
                    busy={busy}
                    disabled={left === 0}
                    onClick={() =>
                      run(async () => {
                        await api('/escrow/select', { method: 'POST', body: { target_user_id: detail.user_id } });
                        haptic([8, 40, 14]);
                      })
                    }
                  >
                    {left > 0 ? 'I’d like to hear from them' : 'You’ve chosen three this week'}
                  </Button>
                  {canFreeze && !detail.carried_over && (
                    <Button variant="quiet" className="w-full" busy={busy} onClick={() => void freeze(detail)}>
                      <Snowflake size={18} className="text-sky-200/90" />
                      Keep for next week
                    </Button>
                  )}
                  <p className="pt-1 text-center text-xs text-muted">Sealed. They never know unless they choose you too.</p>
                </>
              ) : (
                <p className="text-center text-sm text-muted">Choosing has closed for this week.</p>
              )}
            </div>
          </>
        )}
      </BottomSheet>

      <BottomSheet open={vaultOpen} title="Freeze Vault" onClose={() => setVaultOpen(false)}>
        <p className="text-sm text-ink/80">
          Not ready to decide on someone? Keep one person a week here and they’ll be back in next Monday’s batch. Press and hold a card to drag it
          in, or use “Keep for next week” on their card.
        </p>
        {frozenCard ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3">
            <BlurredAvatar size={40} />
            <span className="flex-1 text-sm font-medium">{frozenCard.interests.map((i) => i.label).join(' · ')}</span>
            <Button
              variant="ghost"
              busy={busy}
              onClick={async () => {
                if (await run(() => api('/batches/current/freeze', { method: 'DELETE' }), 'Back in this week’s batch.')) setVaultOpen(false);
              }}
            >
              Put back
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            {data.freeze.used_for === 'raincheck' ? 'This week’s token went on a raincheck.' : '1 token available this week.'}
          </p>
        )}
      </BottomSheet>
    </div>
  );
}
