'use client';

import type { CurrentBatchResponse, ExchangeSummary, MatchSummary } from '@thirtydates/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Countdown } from '@/components/Countdown';
import { Snowflake } from '@/components/icons';
import { profileMeta, rhythmSentence } from '@/components/MondayCard';
import { Button, Notice, Spinner } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { useDevToolsAvailable } from '@/lib/devTools';
import { formatDateTime } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const MATCH_STATUS: Record<MatchSummary['status'], string> = {
  bridging: 'Propose a 45-min window',
  scheduled: 'Meeting confirmed',
  raincheck_pending: 'Raincheck proposed',
  met: 'You met',
  expired: 'Closed',
};

function exchangeLine(x: ExchangeSummary, serverNow: string): { label: string; detail: React.ReactNode } {
  switch (x.status) {
    case 'questions':
      return { label: 'Mutual match confirmed', detail: x.my_pick_count ? `${x.my_pick_count} of 3 questions chosen` : 'Choose 3 questions to ask them' };
    case 'answering':
      return {
        label: x.i_locked ? 'Your vault is locked' : 'Recording answers',
        detail: x.they_locked ? 'They have locked their answers' : <><Countdown to={x.answers_close_at} serverNow={serverNow} style="hm" /> left</>,
      };
    case 'released':
      return { label: 'Both vaults unlocked', detail: x.revealed ? `${x.revealed.first_name}, ${x.revealed.age} · propose a coffee` : '' };
    default:
      return { label: 'Closed quietly', detail: 'The clock ran out; nothing was shared' };
  }
}

/** A chapter in the week's index: index number, meta, the rhythm as a pull-quote. */
function Chapter({
  href,
  index,
  meta,
  quote,
  footnote,
  status,
  dim,
}: {
  href?: string;
  index: string;
  meta: string;
  quote: string;
  footnote?: React.ReactNode;
  status?: React.ReactNode;
  dim?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-baseline gap-2.5">
          <span className="label-mono">{index}</span>
          <span className="text-[12.5px] text-muted">{meta}</span>
        </p>
        {status && <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-brass">{status}</span>}
      </div>
      <p className="mt-2 font-serif text-[1.5rem] leading-[1.15]">“{quote}”</p>
      {footnote && <p className="mt-2 text-[13px] text-muted">{footnote}</p>}
    </>
  );
  return (
    <li className={dim ? 'opacity-50' : undefined}>
      {href ? (
        <Link href={href} className="group block border-b border-line py-6 transition-colors hover:border-brass/40">
          {body}
        </Link>
      ) : (
        <div className="border-b border-line py-6">{body}</div>
      )}
    </li>
  );
}

export default function MondayBatchPage() {
  const session = useMemberSession();
  const devTools = useDevToolsAvailable();
  const batch = useResource<CurrentBatchResponse>(session.ready ? '/batches/current' : null, 60_000);
  const matches = useResource<MatchSummary[]>(session.ready ? '/matches' : null, 120_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const data = batch.data;
  if (!session.ready || (batch.loading && !data)) return <Spinner />;
  if (!data) return <Notice tone="error">{batch.error?.message ?? session.error?.message ?? 'Could not load your week.'}</Notice>;

  const choosing = data.phase === 'selection';
  const midWeek = data.phase === 'exchange_questions' || data.phase === 'exchange_answers' || (data.phase === 'bridge' && data.exchanges.length > 0);
  const frozenCard = data.cards.find((c) => c.frozen);
  const weekLabel = new Date(`${data.batch_week}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  // This week's matches live on their exchange (the reveal screen).
  const olderMatches = (matches.data ?? []).filter((m) => m.status !== 'expired' && !data.exchanges.some((x) => x.match_id === m.id));

  const unfreeze = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/batches/current/freeze', { method: 'DELETE' });
      await batch.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="pt-4">
        <p className="eyebrow">
          Week of {weekLabel}
          {choosing && data.cards.length > 0 && ` · ${data.cards.length} profiles`}
        </p>
        <h1 className="mt-2 text-[2.5rem] leading-[1.02]">{midWeek ? 'The mid-week exchange' : 'Your Monday Batch'}</h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          {choosing
            ? 'Whole portraits: no photos, no names. Hold up to three in blind escrow; they only learn of it if they hold you too.'
            : midWeek
              ? 'You held each other. Ask three questions, answer theirs in your own voice, and both vaults open together.'
              : data.phase === 'awaiting_deal'
                ? 'Six new portraits arrive Monday at 07:00.'
                : 'A new batch of six arrives Monday morning.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {choosing && (
            <span className="pill">
              {data.selections_remaining} of 3 holds left
            </span>
          )}
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
            {choosing ? 'Closes in ' : data.phase === 'exchange_questions' ? 'Questions close in ' : data.phase === 'exchange_answers' ? 'Response clock ' : 'Next batch in '}
            <Countdown
              to={
                choosing
                  ? data.clock.selection_closes_at
                  : data.phase === 'exchange_questions'
                    ? data.clock.questions_close_at
                    : data.phase === 'exchange_answers'
                      ? data.clock.answers_close_at
                      : data.clock.next_deal_at
              }
              serverNow={data.server_now}
              style="hm"
              className="text-ink"
            />
          </span>
        </div>
      </header>

      {data.exchanges.length > 0 && (
        <section className="mt-8" aria-label="Your exchanges">
          <p className="label-rule">Mutual holds</p>
          <ol>
            {data.exchanges.map((x, i) => {
              const line = exchangeLine(x, data.server_now);
              return (
                <Chapter
                  key={x.id}
                  href={x.status === 'expired' ? undefined : `/exchanges/${x.id}`}
                  index={String(i + 1).padStart(2, '0')}
                  meta={line.label}
                  quote={rhythmSentence(x.counterpart.rhythm)}
                  footnote={line.detail}
                  status={x.status === 'released' ? 'Unlocked' : x.they_locked && x.status === 'answering' ? 'They locked' : undefined}
                  dim={x.status === 'expired'}
                />
              );
            })}
          </ol>
        </section>
      )}

      {midWeek && data.exchanges.length === 0 && (
        <p className="mt-10 font-serif text-[1.5rem] leading-snug text-ink/80">
          Nothing became mutual this week. That’s part of the rhythm, and nobody was turned away.
        </p>
      )}

      {!midWeek && data.cards.length > 0 && (
        <section className="mt-8" aria-label="This week's profiles">
          <p className="label-rule">This week’s profiles</p>
          <ol>
            {data.cards.map((card, i) => (
              <Chapter
                key={card.user_id}
                href={`/folio/${card.user_id}`}
                index={`Profile ${String(i + 1).padStart(2, '0')}`}
                meta={profileMeta(card)}
                quote={rhythmSentence(card.rhythm)}
                footnote={card.interests.map((x) => x.label).join(' · ')}
                status={card.selected ? 'Held ✓' : card.frozen ? 'Frozen' : card.carried_over ? 'Kept from last week' : undefined}
              />
            ))}
          </ol>
        </section>
      )}

      {choosing && data.cards.length > 0 && (
        <section className="mt-8 flex items-center gap-3.5 rounded-[14px] border border-line bg-panel px-4 py-3.5" aria-label="Freeze vault">
          <Snowflake size={18} className="shrink-0 text-brass" />
          <div className="flex-1 text-[13px] leading-snug">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">Freeze vault</p>
            <p className="mt-0.5 text-ink/85">
              {frozenCard
                ? `Holding “${rhythmSentence(frozenCard.rhythm)}” for next Monday.`
                : data.freeze.used_for === 'raincheck'
                  ? 'This week’s token went on a raincheck.'
                  : '1 token · keep one folio for next Monday.'}
            </p>
          </div>
          {frozenCard && (
            <Button variant="ghost" className="min-h-touch px-3 text-[13px]" busy={busy} onClick={unfreeze}>
              Return
            </Button>
          )}
        </section>
      )}

      {data.cards.length === 0 && data.exchanges.length === 0 && (
        <div className="mt-10">
          <p className="font-serif text-[1.5rem] leading-snug text-ink/80">
            {choosing
              ? 'Nobody new near you fits how you want to live just yet. We look again every hour until Tuesday night.'
              : 'Your table is being set.'}
          </p>
          {devTools && (
            <Link href="/test" className="tap btn-copper mt-6 rounded-2xl px-6 text-sm">
              Open test tools
            </Link>
          )}
        </div>
      )}

      {olderMatches.length > 0 && (
        <section className="mt-10" aria-label="Your matches">
          <p className="label-rule">Your matches</p>
          <ul>
            {olderMatches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} className="flex items-baseline justify-between border-b border-line py-5">
                  <span className="font-serif text-[1.5rem]">
                    {m.counterpart.first_name}, {m.counterpart.age}
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-brass">
                    {m.event && m.status === 'scheduled' ? formatDateTime(m.event.starts_at) : MATCH_STATUS[m.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
