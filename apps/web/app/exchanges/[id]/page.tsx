'use client';

import { MAX_PROMPTS_PER_PICK, MIN_PROMPTS_PER_PICK, type ExchangeDetail } from '@thirtydates/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Countdown } from '@/components/Countdown';
import { CardBody } from '@/components/MondayCard';
import { VoiceRecorder, recordingAvailable } from '@/components/VoiceRecorder';
import { BottomSheet, Button, Notice, Panel, Spinner, cx } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { deleteDraft } from '@/lib/drafts';
import { haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };

function QuestionPicker({ exchange, onSaved }: { exchange: ExchangeDetail; onSaved: (x: ExchangeDetail) => void }) {
  const [picked, setPicked] = useState<string[]>(exchange.my_picks);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string }>();
  const dirty = picked.join() !== exchange.my_picks.join();
  const valid = picked.length >= MIN_PROMPTS_PER_PICK && picked.length <= MAX_PROMPTS_PER_PICK;

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < MAX_PROMPTS_PER_PICK ? [...p, key] : p));

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      onSaved(await api<ExchangeDetail>(`/exchanges/${exchange.id}/questions`, { method: 'PUT', body: { prompt_keys: picked } }));
      haptic(10);
      setMessage({ tone: 'muted', text: 'Saved. They’ll see your questions when the Response Clock starts.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Not saved' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <h2 className="text-2xl">What would you love to hear them answer?</h2>
      <p className="mt-1 text-sm text-muted">
        They’ll answer by voice once the Response Clock starts. You can change your choice until{' '}
        <Countdown to={exchange.questions_close_at} serverNow={exchange.server_now} className="text-ink" /> from now.
      </p>
      <ul role="list" className="mt-5 space-y-2">
        {exchange.prompt_bank.map((p) => {
          const on = picked.includes(p.key);
          return (
            <li key={p.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.key)}
                disabled={!on && picked.length >= MAX_PROMPTS_PER_PICK}
                className={cx(
                  'min-h-touch w-full rounded-2xl border px-4 py-3 text-left transition-colors disabled:opacity-40',
                  on ? 'border-brass bg-brass/10' : 'border-line bg-raised/40 hover:border-muted',
                )}
              >
                {p.text}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={save} busy={busy} disabled={!valid || !dirty}>
          {exchange.my_picks.length ? 'Update my questions' : 'Send my questions'}
        </Button>
        <span className="text-sm text-muted">{picked.length} of 2–3 chosen</span>
      </div>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
    </Panel>
  );
}

function AnswerBooth({ exchange, onLocked }: { exchange: ExchangeDetail; onLocked: (x: ExchangeDetail) => void }) {
  const [drafts, setDrafts] = useState<Record<string, Blob | null>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const support = useMemo(() => recordingAvailable(), []);
  const onDraftChange = useCallback((key: string, blob: Blob | null) => setDrafts((d) => ({ ...d, [key]: blob })), []);
  const ready = exchange.questions_for_me.every((q) => drafts[q.key]);

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
      const res = await api<{ released: boolean; exchange: ExchangeDetail }>(`/exchanges/${exchange.id}/lock`, {
        method: 'POST',
        form,
      });
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
    <Panel className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl">Answer their questions</h2>
        <p className="text-sm text-muted">
          Response Clock <Countdown to={exchange.answers_close_at} serverNow={exchange.server_now} className="font-medium text-ink" />
        </p>
      </div>
      <p className="mt-1 text-sm text-muted">
        Take as many takes as you need; drafts stay on this device. Nothing is sent, and neither of you hears anything, until you’ve both sent your answers.
      </p>
      {!support.ok && (
        <div className="mt-4">
          <Notice tone="error">{support.reason}</Notice>
        </div>
      )}
      <div className="mt-5 space-y-4">
        {exchange.questions_for_me.map((q) => (
          <VoiceRecorder
            key={q.key}
            exchangeId={exchange.id}
            promptKey={q.key}
            question={q.text}
            disabled={!support.ok || busy}
            onDraftChange={onDraftChange}
          />
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => setConfirming(true)} disabled={!ready} busy={busy}>
          Send my answers
        </Button>
        {!ready && <span className="text-sm text-muted">Record an answer to each question first.</span>}
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <BottomSheet open={confirming} title="Send your answers?" onClose={() => setConfirming(false)}>
        <p className="text-muted">
          Once sent, they’re final. They stay sealed until they send theirs, and then you hear each other and see each other’s name and face at the same moment.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep recording
          </Button>
          <Button onClick={lock}>Send them</Button>
        </div>
      </BottomSheet>
    </Panel>
  );
}

function AnswerList({ title, answers }: { title: string; answers: ExchangeDetail['their_answers'] }) {
  return (
    <Panel className="p-6">
      <h2 className="text-2xl">{title}</h2>
      <ul role="list" className="mt-4 space-y-4">
        {answers.map((a) => (
          <li key={a.prompt_key} className="rounded-2xl border border-line/70 bg-raised/40 p-4">
            <p className="font-serif text-lg leading-snug">{a.text}</p>
            <audio src={a.audio_url} controls preload="none" className="mt-2 h-10 w-full" />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function ExchangePage() {
  const { id } = useParams<{ id: string }>();
  const session = useMemberSession();
  const resource = useResource<ExchangeDetail>(session.ready ? `/exchanges/${id}` : null, 30_000);
  const [exchange, setExchange] = useState<ExchangeDetail>();

  useEffect(() => {
    if (resource.data) setExchange(resource.data);
  }, [resource.data]);

  if (!exchange) return resource.error ? <Notice tone="error">{resource.error.message}</Notice> : <Spinner />;
  const revealed = exchange.revealed;
  const photo = revealed?.photo_ids[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-4">
        {revealed ? (
          photo ? (
            // Plain img: the authenticated, private photo endpoint.
            <img src={`/api/photos/${photo}`} alt={`Photo of ${revealed.first_name}`} className="h-20 w-20 animate-fade-in rounded-full object-cover ring-2 ring-brass/50" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-forest font-serif text-3xl ring-2 ring-brass/50" aria-hidden="true">
              {revealed.first_name.slice(0, 1)}
            </span>
          )
        ) : (
          <span className="h-20 w-20 rounded-full bg-gradient-to-br from-forest to-raised blur-[3px]" aria-hidden="true" />
        )}
        <div>
          <p className="eyebrow text-brass">Voice exchange</p>
          <h1 className="text-4xl">{revealed ? revealed.first_name : 'Name sealed'}</h1>
        </div>
      </header>

      {exchange.status === 'questions' && <QuestionPicker exchange={exchange} onSaved={setExchange} />}
      {exchange.status === 'answering' && !exchange.i_locked && <AnswerBooth exchange={exchange} onLocked={setExchange} />}
      {exchange.status === 'answering' && exchange.i_locked && (
        <>
          <Panel className="p-6">
            <h2 className="text-2xl">Your answers are sent</h2>
            <p className="mt-1 text-muted">
              Nothing is shared until they send theirs. If the Response Clock runs out first (
              <Countdown to={exchange.answers_close_at} serverNow={exchange.server_now} className="text-ink" />
              ), the exchange closes quietly and your voice notes are deleted.
            </p>
          </Panel>
          <AnswerList title="Your answers" answers={exchange.my_answers} />
        </>
      )}
      {exchange.status === 'released' && (
        <>
          <Panel className="border-brass/50 p-6">
            <h2 className="text-2xl">You’ve heard each other</h2>
            <p className="mt-1 text-muted">Names and photos are unblurred and your First-Meet Bridge is open for the next 72 hours.</p>
            {exchange.match_id && (
              <Link href={`/matches/${exchange.match_id}`} className="tap mt-4 rounded-full bg-accent px-6 text-sm font-medium text-canvas">
                Choose a time for coffee or wine
              </Link>
            )}
          </Panel>
          <AnswerList title={`${revealed?.first_name ?? 'Their'} answers`} answers={exchange.their_answers} />
          <AnswerList title="Your answers" answers={exchange.my_answers} />
        </>
      )}
      {exchange.status === 'expired' && (
        <Panel className="p-6">
          <h2 className="text-2xl">This exchange has closed</h2>
          <p className="mt-1 text-muted">The Response Clock ran out before you both answered. Nothing was shared, and the recordings were deleted.</p>
        </Panel>
      )}

      <section aria-label="Their card">
        <p className="eyebrow mb-3">Their card</p>
        <article className="rounded-card border border-line/70 bg-panel p-5 shadow-card">
          <CardBody profile={exchange.counterpart} />
        </article>
      </section>
    </div>
  );
}
