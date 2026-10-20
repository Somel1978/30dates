'use client';

import {
  MAX_PROMPTS_PER_PICK,
  MIN_PROMPTS_PER_PICK,
  PROMPT_VECTORS,
  PROMPT_VECTOR_LABELS,
  type ExchangeDetail,
  type PromptVector,
} from '@thirtydates/shared';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Countdown } from '@/components/Countdown';
import { Lock } from '@/components/icons';
import { BlurredAvatar, CardBody } from '@/components/MondayCard';
import { VoiceRecorder, recordingAvailable } from '@/components/VoiceRecorder';
import { BottomSheet, Button, Notice, OptionRow, Panel, ScreenHeader, Spinner, StickyActions, cx } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { deleteDraft } from '@/lib/drafts';
import { haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

/** Gold progress ring: how many of the needed steps are done. */
function ProgressRing({ value, max }: { value: number; max: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="mx-auto" role="img" aria-label={`${value} of ${max}`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--color-line))" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="rgb(var(--color-brass))"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(value, max) / max)}
        transform="rotate(-90 32 32)"
        className="transition-[stroke-dashoffset] duration-500 ease-calm"
      />
    </svg>
  );
}

/** You, and the still-sealed other person. */
function UnlockPair({ caption }: { caption: string }) {
  const session = useMemberSession({ requireOnboarded: false });
  const mine = session.me?.photos[0];
  return (
    <div className="my-5 flex flex-col items-center">
      <div className="flex items-center">
        {mine ? (
          // Plain img: the authenticated, private photo endpoint.
          <img src={`/api/photos/${mine.id}`} alt="You" className="relative z-10 h-14 w-14 rounded-full object-cover ring-2 ring-canvas" />
        ) : (
          <BlurredAvatar size={56} className="relative z-10 ring-2 ring-canvas" />
        )}
        <span className="-ml-3 flex h-14 w-14 items-center justify-center rounded-full bg-raised text-2xl font-semibold text-brass ring-2 ring-canvas">?</span>
      </div>
      <p className="mt-2 text-sm text-muted">{caption}</p>
    </div>
  );
}

function QuestionPicker({ exchange, onSaved }: { exchange: ExchangeDetail; onSaved: (x: ExchangeDetail) => void }) {
  const [picked, setPicked] = useState<string[]>(exchange.my_picks);
  const [tab, setTab] = useState<PromptVector>('rhythm');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string }>();
  const dirty = picked.join() !== exchange.my_picks.join();
  const valid = picked.length >= MIN_PROMPTS_PER_PICK && picked.length <= MAX_PROMPTS_PER_PICK;
  const byKey = useMemo(() => new Map(exchange.prompt_bank.map((p) => [p.key, p])), [exchange.prompt_bank]);

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < MAX_PROMPTS_PER_PICK ? [...p, key] : p));

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      onSaved(await api<ExchangeDetail>(`/exchanges/${exchange.id}/questions`, { method: 'PUT', body: { prompt_keys: picked } }));
      haptic(10);
      setMessage({ tone: 'muted', text: 'Locked in. They’ll see your questions on Thursday.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Not saved' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="text-center">
        <ProgressRing value={picked.length} max={MAX_PROMPTS_PER_PICK} />
        <h1 className="mt-3 text-[1.75rem] leading-tight">Mid-Week Drop</h1>
        <p className="mt-1 text-sm text-muted">
          {picked.length < MAX_PROMPTS_PER_PICK ? `${MAX_PROMPTS_PER_PICK} questions to unlock` : 'Ready to lock'} · changes close in{' '}
          <Countdown to={exchange.questions_close_at} serverNow={exchange.server_now} className="text-ink" />
        </p>
      </div>
      <UnlockPair caption="Unlock" />

      {picked.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-sm font-medium">Your picks</p>
          {picked.map((k) => (
            <OptionRow key={k} title={byKey.get(k)?.text ?? k} selected onClick={() => toggle(k)} />
          ))}
        </div>
      )}

      <p className="mb-2 text-sm font-medium">Choose</p>
      <div role="tablist" className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1">
        {PROMPT_VECTORS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cx('min-h-[2.5rem] rounded-lg text-[0.8125rem] font-medium transition-colors', tab === v ? 'bg-raised text-brass' : 'text-muted')}
          >
            {PROMPT_VECTOR_LABELS[v].title}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-muted">{PROMPT_VECTOR_LABELS[tab].subtitle}</p>
      <ul role="list" className="space-y-2.5">
        {exchange.prompt_bank
          .filter((p) => p.vector === tab && !picked.includes(p.key))
          .map((p) => (
            <li key={p.key}>
              <OptionRow
                icon={<Lock size={16} />}
                title={<span className="text-[0.9375rem] font-normal">{p.text}</span>}
                onClick={() => toggle(p.key)}
                disabled={picked.length >= MAX_PROMPTS_PER_PICK}
              />
            </li>
          ))}
      </ul>

      <StickyActions aboveTabs>
        <Button className="w-full" onClick={save} busy={busy} disabled={!valid || !dirty}>
          {exchange.my_picks.length ? 'Update choices' : 'Lock choices'}
        </Button>
        {message && (
          <div className="mt-2 text-center">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </StickyActions>
    </div>
  );
}

function AnswerBooth({ exchange, onLocked }: { exchange: ExchangeDetail; onLocked: (x: ExchangeDetail) => void }) {
  const [drafts, setDrafts] = useState<Record<string, Blob | null>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const support = useMemo(() => recordingAvailable(), []);
  const onDraftChange = useCallback((key: string, blob: Blob | null) => setDrafts((d) => ({ ...d, [key]: blob })), []);
  const done = exchange.questions_for_me.filter((q) => drafts[q.key]).length;
  const ready = done === exchange.questions_for_me.length;

  const lock = async () => {
    setConfirming(false);
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      for (const q of exchange.questions_for_me) {
        const blob = drafts[q.key]!;
        const type = blob.type.split(';')[0] ?? 'audio/webm';
        form.append(q.key, blob, `${q.key}.${EXTENSION[type] ?? 'webm'}`);
      }
      const res = await api<{ released: boolean; exchange: ExchangeDetail }>(`/exchanges/${exchange.id}/lock`, { method: 'POST', form });
      await Promise.all(exchange.questions_for_me.map((q) => deleteDraft(exchange.id, q.key)));
      haptic([8, 40, 14]);
      onLocked(res.exchange);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Your drafts are still here.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="text-center">
        <ProgressRing value={done} max={exchange.questions_for_me.length || 1} />
        <h1 className="mt-3 text-[1.75rem] leading-tight">Answer by voice</h1>
        <p className="mt-1 text-sm text-muted">
          Response Clock · <Countdown to={exchange.answers_close_at} serverNow={exchange.server_now} className="text-ink" /> left
        </p>
      </div>
      <UnlockPair caption="Both answer to unlock" />
      <p className="mb-4 text-center text-sm text-muted">Take as many takes as you like. Drafts stay on this phone; nothing is shared until you’ve both sent.</p>
      {!support.ok && (
        <div className="mb-4">
          <Notice tone="error">{support.reason}</Notice>
        </div>
      )}
      <div className="space-y-3">
        {exchange.questions_for_me.map((q) => (
          <VoiceRecorder key={q.key} exchangeId={exchange.id} promptKey={q.key} question={q.text} disabled={!support.ok || busy} onDraftChange={onDraftChange} />
        ))}
      </div>
      <StickyActions aboveTabs>
        <Button className="w-full" onClick={() => setConfirming(true)} disabled={!ready} busy={busy}>
          {ready ? 'Send my answers' : `Record ${exchange.questions_for_me.length - done} more`}
        </Button>
        {error && (
          <div className="mt-2 text-center">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </StickyActions>
      <BottomSheet open={confirming} title="Send your answers?" onClose={() => setConfirming(false)}>
        <p className="text-sm text-ink/80">
          Once sent, they’re final. They stay sealed until they send theirs; then you hear each other and your photos unblur at the same moment.
        </p>
        <div className="mt-5 space-y-2">
          <Button className="w-full" onClick={lock}>
            Send them
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirming(false)}>
            Keep recording
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

function AnswerList({ title, answers }: { title: string; answers: ExchangeDetail['their_answers'] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base">{title}</h2>
      <ul role="list" className="space-y-2.5">
        {answers.map((a) => (
          <li key={a.prompt_key} className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-[0.9375rem] font-medium leading-snug">{a.text}</p>
            <audio src={a.audio_url} controls preload="none" className="mt-3 h-10 w-full" />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ExchangePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useMemberSession();
  const resource = useResource<ExchangeDetail>(session.ready ? `/exchanges/${id}` : null, 30_000);
  const [exchange, setExchange] = useState<ExchangeDetail>();
  const [showCard, setShowCard] = useState(false);

  useEffect(() => {
    if (resource.data) setExchange(resource.data);
  }, [resource.data]);

  if (!exchange) return resource.error ? <Notice tone="error">{resource.error.message}</Notice> : <Spinner />;
  const revealed = exchange.revealed;
  const photo = revealed?.photo_ids[0];

  return (
    <div>
      <button type="button" onClick={() => router.push('/')} className="tap -ml-3 rounded-full text-sm text-muted hover:text-ink">
        ‹ This week
      </button>

      {exchange.status === 'questions' && <QuestionPicker exchange={exchange} onSaved={setExchange} />}
      {exchange.status === 'answering' && !exchange.i_locked && <AnswerBooth exchange={exchange} onLocked={setExchange} />}

      {exchange.status === 'answering' && exchange.i_locked && (
        <>
          <ScreenHeader title="Your answers are sent" subtitle="Nothing is shared until they send theirs." />
          <UnlockPair caption="Waiting for theirs" />
          <Panel className="p-4 text-center text-sm text-muted">
            If the Response Clock runs out first (<Countdown to={exchange.answers_close_at} serverNow={exchange.server_now} className="text-ink" />
            ), it closes quietly and your voice notes are deleted.
          </Panel>
          <AnswerList title="Your answers" answers={exchange.my_answers} />
        </>
      )}

      {exchange.status === 'released' && revealed && (
        <>
          <div className="text-center">
            <h1 className="text-[1.75rem] leading-tight">It’s a Match!</h1>
            <p className="text-lg font-semibold text-brass">Your photos are unblurred</p>
          </div>
          <div className="relative mx-auto mt-4 aspect-[4/5] w-full max-w-[18rem] overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
            {photo ? (
              // Plain img: the authenticated, private photo endpoint.
              <img src={`/api/photos/${photo}`} alt={`Photo of ${revealed.first_name}`} className="h-full w-full animate-fade-in object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-6xl font-semibold text-brass/70">{revealed.first_name.slice(0, 1)}</span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-lg font-semibold">
              {revealed.first_name}, {revealed.age}
            </span>
          </div>
          {exchange.match_id && (
            <Link href={`/matches/${exchange.match_id}`} className="tap btn-gold mt-5 w-full rounded-xl text-[0.9375rem]">
              Propose a meet-up
            </Link>
          )}
          <AnswerList title={`${revealed.first_name}’s answers`} answers={exchange.their_answers} />
          <AnswerList title="Your answers" answers={exchange.my_answers} />
        </>
      )}

      {exchange.status === 'expired' && (
        <ScreenHeader title="This one has closed" subtitle="Time ran out before you both answered. Nothing was shared, and the recordings were deleted." />
      )}

      <Button variant="quiet" className="mt-6 w-full" onClick={() => setShowCard(true)}>
        View their card
      </Button>
      <BottomSheet tall open={showCard} title="Their card" onClose={() => setShowCard(false)}>
        <CardBody profile={exchange.counterpart} />
      </BottomSheet>
    </div>
  );
}
