'use client';

import type { BatchCard, CurrentBatchResponse, MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ExchangeCard } from '@/components/ExchangeCard';
import { FreezeVault } from '@/components/FreezeVault';
import { MondayCard } from '@/components/MondayCard';
import { WeekBanner } from '@/components/WeekBanner';
import { BottomSheet, Button, Notice, Panel, Spinner, WeeklyTable } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { useDevToolsAvailable } from '@/lib/devTools';
import { formatDateTime, haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

type Confirm = { kind: 'select' | 'pass' | 'freeze'; card: BatchCard };

const MATCH_STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Choose a time for coffee or wine',
  scheduled: 'First meeting scheduled',
  raincheck_pending: 'Raincheck pending',
  met: 'You have met',
  expired: 'Closed',
};

const CONFIRM_COPY: Record<Confirm['kind'], { title: string; body: string; action: string }> = {
  select: {
    title: 'Select this profile?',
    body: 'Your selection goes into blind escrow. They never learn of it unless they select you too, and then a voice exchange opens on Wednesday.',
    action: 'Select',
  },
  pass: { title: 'Pass on this card?', body: 'Passing is final for this week and completely silent.', action: 'Pass' },
  freeze: {
    title: 'Freeze this card?',
    body: 'This spends your one Freeze Token for the week. The card comes back in next Monday’s deal.',
    action: 'Freeze',
  },
};

export default function WeeklyDashboard() {
  const session = useMemberSession();
  const devTools = useDevToolsAvailable();
  const batch = useResource<CurrentBatchResponse>(session.ready ? '/batches/current' : null, 60_000);
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null, 120_000);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string } | null>(null);

  // Pointer-driven drag to the Freeze Vault (HTML5 drag-and-drop does not work on touch).
  const vaultRef = useRef<HTMLDivElement>(null);
  const suppressTap = useRef(false);
  const [drag, setDrag] = useState<{ card: BatchCard; x: number; y: number } | null>(null);
  const [overVault, setOverVault] = useState(false);

  const data = batch.data;
  const interactive = data?.phase === 'selection';
  const canFreeze = !!interactive && !!data?.freeze.token_available && !data.freeze.frozen_user_id;

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await action();
        if (success) setMessage({ tone: 'muted', text: success });
        await Promise.all([batch.reload(), matches.reload()]);
      } catch (err) {
        setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'That did not go through. Try again.' });
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
      }, 'Frozen. It returns in next Monday’s deal.'),
    [run],
  );

  const insideVault = (x: number, y: number) => {
    const r = vaultRef.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  const startDrag = (card: BatchCard, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canFreeze) return;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
      moved = true;
      ev.preventDefault();
      setDrag({ card, x: ev.clientX, y: ev.clientY });
      setOverVault(insideVault(ev.clientX, ev.clientY));
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (moved) {
        // Swallow the click the browser fires after a drag; reset if none arrives.
        suppressTap.current = true;
        window.setTimeout(() => (suppressTap.current = false), 60);
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
    if (!drag) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    return () => document.removeEventListener('touchmove', prevent);
  }, [drag]);

  if (!session.ready || (batch.loading && !data)) return <Spinner />;
  if (!data) return <Notice tone="error">{batch.error?.message ?? session.error?.message ?? 'Could not load your week.'}</Notice>;

  const frozenCard = data.cards.find((c) => c.frozen);
  const liveMatches = (matches.data ?? []).filter((m) => m.status !== 'expired');

  const confirmAction = async () => {
    if (!confirm) return;
    const { kind, card } = confirm;
    setConfirm(null);
    if (kind === 'freeze') return freeze(card);
    await run(async () => {
      await api(kind === 'select' ? '/escrow/select' : '/escrow/pass', { method: 'POST', body: { target_user_id: card.user_id } });
      haptic(kind === 'select' ? [8, 40, 14] : 8);
    });
  };

  return (
    <div>
      <WeekBanner batch={data} />

      {message && (
        <div className="mb-6">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {liveMatches.length > 0 && (
        <Panel className="mb-8 p-5">
          <p className="eyebrow mb-3">Your First-Meet Bridges</p>
          <ul role="list" className="divide-y divide-line/60">
            {liveMatches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} className="flex min-h-touch items-center justify-between gap-4 py-3">
                  <span className="font-serif text-xl">{m.counterpart.first_name}</span>
                  <span className="text-right text-sm text-muted">
                    {m.event && m.status === 'scheduled' ? formatDateTime(m.event.starts_at) : MATCH_STATUS[m.status]}
                    <span aria-hidden="true"> →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.exchanges.length > 0 && (
        <section className="mb-10" aria-labelledby="exchanges-heading">
          <h2 id="exchanges-heading" className="mb-1 text-2xl">
            Voice exchanges
          </h2>
          <p className="mb-5 text-sm text-muted">
            You selected each other. Ask 2–3 questions, answer theirs by voice, and when you both lock, names and photos unblur together.
          </p>
          <ul role="list" className="grid gap-5 md:grid-cols-2">
            {data.exchanges.map((x) => (
              <ExchangeCard key={x.id} exchange={x} serverNow={data.server_now} />
            ))}
          </ul>
        </section>
      )}

      {data.cards.length > 0 ? (
        <div className={interactive ? 'pb-24' : undefined}>
          <WeeklyTable title="This week’s table" caption={data.cards.length < 6 ? `${data.cards.length} introductions this week` : 'Six introductions'}>
            {data.cards.map((card) => (
              <MondayCard
                key={card.user_id}
                card={card}
                interactive={!!interactive}
                selectionsRemaining={data.selections_remaining}
                canFreeze={canFreeze && !card.carried_over}
                onSelect={(c) => setConfirm({ kind: 'select', card: c })}
                onPass={(c) => setConfirm({ kind: 'pass', card: c })}
                onFreeze={(c) => {
                  if (suppressTap.current) {
                    suppressTap.current = false;
                    return;
                  }
                  setConfirm({ kind: 'freeze', card: c });
                }}
                onDragStart={startDrag}
              />
            ))}
          </WeeklyTable>
        </div>
      ) : (
        <Panel className="p-8 text-center">
          <h2 className="text-2xl">
            {data.phase === 'awaiting_deal' ? 'Your table is being set' : interactive ? 'No introductions yet' : 'This week’s table is closed'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-muted">
            {data.phase === 'awaiting_deal'
              ? 'Six faceless introductions arrive Monday at 07:00 UTC.'
              : interactive
                ? 'Nobody in your radius and age window is free to be dealt yet. We check every hour until Tuesday night, and new cards appear here as members join.'
                : 'Selection is closed for this week. Your next introductions arrive Monday at 07:00 UTC.'}
          </p>
          {devTools && (
            <Link href="/test" className="tap mt-5 rounded-full bg-accent px-6 text-sm font-medium text-canvas">
              Open test tools
            </Link>
          )}
        </Panel>
      )}

      {interactive && data.cards.length > 0 && (
        <FreezeVault
          freeze={data.freeze}
          frozenCard={frozenCard}
          dragging={drag !== null}
          over={overVault}
          vaultRef={vaultRef}
          busy={busy}
          onUnfreeze={() => run(() => api('/batches/current/freeze', { method: 'DELETE' }), 'Back on the table. Token refunded.')}
        />
      )}

      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-brass/60 bg-panel px-4 py-3 shadow-sheet"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <p className="font-serif text-lg">{drag.card.interests[0]?.label}</p>
          <p className="text-xs text-muted">{drag.card.distance_km} km away</p>
        </div>
      )}

      <BottomSheet open={confirm !== null} title={confirm ? CONFIRM_COPY[confirm.kind].title : ''} onClose={() => setConfirm(null)}>
        <p className="text-muted">{confirm && CONFIRM_COPY[confirm.kind].body}</p>
        {confirm?.kind === 'select' && (
          <p className="mt-2 text-sm text-muted">{data.selections_remaining} of 3 selections left this week.</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button onClick={confirmAction} busy={busy}>
            {confirm && CONFIRM_COPY[confirm.kind].action}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
