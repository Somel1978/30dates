'use client';

import type {
  BatchCard,
  CardLine,
  CurrentBatchResponse,
  MatchSummary,
  MutualCard as MutualCardData,
  ResonanceStamp,
  SignalResponse,
} from '@thirtydates/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { FreezeVault } from '@/components/FreezeVault';
import { MondayCard } from '@/components/MondayCard';
import { MutualCard } from '@/components/MutualCard';
import { ResonanceStampModal } from '@/components/ResonanceStampModal';
import { ScenarioSheet } from '@/components/ScenarioSheet';
import { WeekBanner } from '@/components/WeekBanner';
import { BottomSheet, Button, Notice, Panel, Spinner, WeeklyTable } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { formatDateTime, haptic } from '@/lib/format';
import { useDevToolsAvailable } from '@/lib/devTools';
import { useMemberSession } from '@/lib/session';

type Confirm =
  | { kind: 'pass'; card: BatchCard }
  | { kind: 'freeze'; card: BatchCard }
  | { kind: 'signal'; card: MutualCardData };

const BRIDGE_STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Choose your First-Meet Bridge',
  scheduled: 'First meeting scheduled',
  raincheck_pending: 'Raincheck pending',
  met: 'You have met',
  expired: 'Closed',
};

export default function WeeklyDashboard() {
  const session = useMemberSession();
  const devTools = useDevToolsAvailable();
  const batch = useResource<CurrentBatchResponse>(session.ready ? '/batches/current' : null, 60_000);
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null, 120_000);

  const [stampTarget, setStampTarget] = useState<{ card: BatchCard; line: CardLine } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [scenarioCard, setScenarioCard] = useState<MutualCardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string } | null>(null);

  // Pointer-driven drag to the Freeze Vault (HTML5 drag-and-drop does not work on touch).
  const vaultRef = useRef<HTMLDivElement>(null);
  const suppressTap = useRef(false);
  const [drag, setDrag] = useState<{ card: BatchCard; x: number; y: number } | null>(null);
  const [overVault, setOverVault] = useState(false);

  const data = batch.data;
  const interactive = data?.phase === 'validation';
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

  const stamp = async (resonance: ResonanceStamp) => {
    if (!stampTarget) return;
    await api('/escrow/validate', {
      method: 'POST',
      body: { target_user_id: stampTarget.card.user_id, resonance_stamp_type: resonance, card_line: stampTarget.line },
    });
    await batch.reload();
  };

  const confirmAction = async () => {
    if (!confirm) return;
    const current = confirm;
    setConfirm(null);
    if (current.kind === 'pass') {
      await run(() => api('/escrow/pass', { method: 'POST', body: { target_user_id: current.card.user_id } }));
    } else if (current.kind === 'freeze') {
      await freeze(current.card);
    } else {
      await run(async () => {
        const res = await api<SignalResponse>('/escrow/signal', { method: 'POST', body: { target_user_id: current.card.user_id } });
        haptic([8, 40, 14]);
        if (res.match_id) setMessage({ tone: 'muted', text: 'It’s mutual. Your chat is open.' });
      }, 'Signal sealed. If it’s mutual, your chat opens tonight.');
    }
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
          <p className="eyebrow mb-3">Your matches</p>
          <ul role="list" className="divide-y divide-line/60">
            {liveMatches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} className="flex min-h-touch items-center justify-between gap-4 py-3">
                  <span className="font-serif text-xl">{m.counterpart.first_name}</span>
                  <span className="text-right text-sm text-muted">
                    {m.event && m.status === 'scheduled' ? formatDateTime(m.event.starts_at) : BRIDGE_STATUS[m.status]}
                    <span aria-hidden="true"> →</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data.mutual.length > 0 && (
        <section className="mb-10" aria-labelledby="mutual-heading">
          <h2 id="mutual-heading" className="mb-1 text-2xl">
            {data.phase === 'reveal' || data.phase === 'signal' ? 'Sunday Reveal' : 'Mutual resonance'}
          </h2>
          <p className="mb-5 text-sm text-muted">
            {data.phase === 'signal'
              ? 'Choose your #1 Signal. If they choose you too, the chat opens.'
              : data.phase === 'reveal'
                ? 'Names and photos are unblurred. The #1 Signal opens this evening.'
                : 'You both stamped each other. Names and photos unblur on Sunday morning.'}
          </p>
          <ul role="list" className="grid gap-5 md:grid-cols-2">
            {data.mutual.map((card) => (
              <MutualCard
                key={card.user_id}
                card={card}
                phase={data.phase}
                signalTargetId={data.my_signal?.target_user_id ?? null}
                matchId={data.my_signal?.match_id ?? null}
                onOpenScenarios={setScenarioCard}
                onSignal={(c) => setConfirm({ kind: 'signal', card: c })}
              />
            ))}
          </ul>
        </section>
      )}

      {data.cards.length > 0 ? (
        <div className={interactive ? 'pb-24' : undefined}>
        <WeeklyTable
          title="This week’s table"
          caption={data.cards.length < 6 ? `${data.cards.length} introductions this week` : 'Six introductions'}
        >
          {data.cards.map((card) => (
            <MondayCard
              key={card.user_id}
              card={card}
              interactive={!!interactive}
              stampsRemaining={data.stamps_remaining}
              canFreeze={canFreeze && !card.carried_over}
              onStampRequest={(c, line) => setStampTarget({ card: c, line })}
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
                ? 'Nobody in your radius and age window is free to be dealt yet. We check every hour until Saturday night, and new cards appear here as members join.'
                : 'Stamps are closed for this week. Your next introductions arrive Monday at 07:00 UTC.'}
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

      <ResonanceStampModal
        open={stampTarget !== null}
        line={stampTarget?.line ?? 'badges'}
        stampsRemaining={data.stamps_remaining}
        onClose={() => setStampTarget(null)}
        onSelect={stamp}
      />

      {scenarioCard && (
        <ScenarioSheet
          open
          targetId={scenarioCard.user_id}
          onClose={() => setScenarioCard(null)}
          onAnswered={() => void batch.reload()}
        />
      )}

      <BottomSheet
        open={confirm !== null}
        title={confirm?.kind === 'pass' ? 'Pass on this card?' : confirm?.kind === 'freeze' ? 'Freeze this card?' : 'Send your #1 Signal?'}
        onClose={() => setConfirm(null)}
      >
        <p className="text-muted">
          {confirm?.kind === 'pass' && 'Passing is final for this week and completely silent.'}
          {confirm?.kind === 'freeze' && 'This spends your one Freeze Token for the week. The card comes back in next Monday’s deal.'}
          {confirm?.kind === 'signal' &&
            `Your #1 Signal for ${confirm.card.revealed?.first_name ?? 'them'} is sealed in escrow. It can’t be changed this week.`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button onClick={confirmAction} busy={busy}>
            {confirm?.kind === 'pass' ? 'Pass' : confirm?.kind === 'freeze' ? 'Freeze' : 'Send signal'}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
