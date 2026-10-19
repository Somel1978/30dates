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

type Confirm = { kind: 'select' | 'freeze'; card: BatchCard };

const MATCH_STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Choose a time for coffee or wine',
  scheduled: 'You’re meeting',
  raincheck_pending: 'A new time has been proposed',
  met: 'You’ve met',
  expired: 'Closed',
};

const CONFIRM_COPY: Record<Confirm['kind'], { title: string; body: string; action: string }> = {
  select: {
    title: 'Hear from this person?',
    body: 'This stays sealed. They’ll never know unless they chose you too, and if they did, you’ll trade a few questions by voice on Wednesday.',
    action: 'Yes, I’d like that',
  },
  freeze: {
    title: 'Keep them for next week?',
    body: 'Not ready to decide? Use your one Freeze for the week and this person will be at your table again next Monday.',
    action: 'Keep for next week',
  },
};

export default function WeeklyTablePage() {
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
      }, 'Kept. They’ll be at your table again next Monday.'),
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
      await api('/escrow/select', { method: 'POST', body: { target_user_id: card.user_id } });
      haptic([8, 40, 14]);
    });
  };

  return (
    <div>
      <WeekBanner batch={data} firstName={session.me?.first_name ?? null} />

      {message && (
        <div className="mx-auto mb-8 max-w-2xl text-center">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {liveMatches.length > 0 && (
        <section className="mx-auto mb-14 max-w-2xl" aria-labelledby="meetings-heading">
          <h2 id="meetings-heading" className="mb-4 text-center text-3xl">
            Your first meetings
          </h2>
          <ul role="list" className="space-y-3">
            {liveMatches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/matches/${m.id}`}
                  className="flex min-h-touch items-center gap-4 rounded-[1.5rem] bg-panel px-5 py-4 shadow-card ring-1 ring-brass/30 transition-colors hover:ring-brass/60"
                >
                  {m.counterpart.photo_ids[0] ? (
                    // Plain img: the authenticated, private photo endpoint.
                    <img src={`/api/photos/${m.counterpart.photo_ids[0]}`} alt="" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-forest font-serif text-2xl" aria-hidden="true">
                      {m.counterpart.first_name.slice(0, 1)}
                    </span>
                  )}
                  <span className="flex-1">
                    <span className="block font-serif text-2xl">{m.counterpart.first_name}</span>
                    <span className="block text-sm text-muted">
                      {m.event && m.status === 'scheduled' ? `Meeting ${formatDateTime(m.event.starts_at)}` : MATCH_STATUS[m.status]}
                    </span>
                  </span>
                  <span className="text-brass" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.exchanges.length > 0 && (
        <section className="mb-14" aria-labelledby="exchanges-heading">
          <h2 id="exchanges-heading" className="mb-2 text-center text-3xl">
            You chose each other
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-center text-ink/70">
            Once you’ve both sent your spoken answers, you’ll see each other’s name and face at the same moment.
          </p>
          <ul role="list" className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
            {data.exchanges.map((x) => (
              <ExchangeCard key={x.id} exchange={x} serverNow={data.server_now} />
            ))}
          </ul>
        </section>
      )}

      {data.cards.length > 0 ? (
        <WeeklyTable title="This week’s table">
          {data.cards.map((card) => (
            <MondayCard
              key={card.user_id}
              card={card}
              interactive={!!interactive}
              choicesLeft={data.selections_remaining}
              canFreeze={canFreeze && !card.carried_over}
              onChoose={(c) => setConfirm({ kind: 'select', card: c })}
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
      ) : (
        data.exchanges.length === 0 && (
          <Panel className="mx-auto max-w-xl p-10 text-center">
            <h2 className="text-3xl">
              {data.phase === 'awaiting_deal' ? 'Your table is being set' : interactive ? 'No introductions yet' : 'The table is cleared'}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-ink/70">
              {data.phase === 'awaiting_deal'
                ? 'This week’s introductions arrive Monday morning.'
                : interactive
                  ? 'There’s nobody new near you who fits how you want to live just yet. We look again every hour until Tuesday night.'
                  : 'A fresh table is set on Monday morning.'}
            </p>
            {devTools && (
              <Link href="/test" className="tap mt-6 rounded-full bg-accent px-6 text-sm font-medium text-canvas">
                Open test tools
              </Link>
            )}
          </Panel>
        )
      )}

      {interactive && data.cards.length > 0 && (
        <FreezeVault
          freeze={data.freeze}
          frozenCard={frozenCard}
          dragging={drag !== null}
          over={overVault}
          vaultRef={vaultRef}
          busy={busy}
          onUnfreeze={() => run(() => api('/batches/current/freeze', { method: 'DELETE' }), 'Back on the table.')}
        />
      )}

      {drag && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-[1.25rem] bg-panel px-5 py-3 shadow-sheet ring-1 ring-brass/60"
          style={{ left: drag.x, top: drag.y }}
          aria-hidden="true"
        >
          <p className="font-serif text-lg">{drag.card.interests[0]?.label}</p>
          <p className="text-xs text-muted">About {drag.card.distance_km} km from you</p>
        </div>
      )}

      <BottomSheet open={confirm !== null} title={confirm ? CONFIRM_COPY[confirm.kind].title : ''} onClose={() => setConfirm(null)}>
        <p className="text-ink/75">{confirm && CONFIRM_COPY[confirm.kind].body}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Not yet
          </Button>
          <Button onClick={confirmAction} busy={busy}>
            {confirm && CONFIRM_COPY[confirm.kind].action}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
