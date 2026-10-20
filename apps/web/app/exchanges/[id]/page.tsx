'use client';

import {
  CUSTOM_QUESTION_MAX,
  CUSTOM_QUESTION_MIN,
  MAX_PROMPTS_PER_PICK,
  PROMPT_VECTORS,
  PROMPT_VECTOR_LABELS,
  type ExchangeDetail,
  type MatchDetail,
  type PromptVector,
} from '@thirtydates/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BridgePanel } from '@/components/BridgePanel';
import { Countdown } from '@/components/Countdown';
import { EventPanel } from '@/components/EventPanel';
import { Check, ChevronLeft, Lock } from '@/components/icons';
import { CardBody } from '@/components/MondayCard';
import { VoiceRecorder, recordingAvailable, type DraftInfo } from '@/components/VoiceRecorder';
import { BottomSheet, Button, Notice, Spinner, StickyActions, cx } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { formatSeconds, useAudioShape } from '@/lib/audio';
import { deleteDraft } from '@/lib/drafts';
import { haptic } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
const VISIBLE_PROMPTS = 3;

function BackLink() {
  return (
    <Link href="/" className="tap -ml-2 gap-1.5 px-2 text-[13.5px] text-ink/85 hover:text-ink">
      <ChevronLeft size={16} />
      This week
    </Link>
  );
}

/** Two overlapping rings: a mutual hold. */
function MutualMark() {
  return (
    <span className="relative inline-flex h-3.5 w-5" aria-hidden="true">
      <span className="absolute left-0 h-3.5 w-3.5 rounded-full bg-brass/80" />
      <span className="absolute left-1.5 h-3.5 w-3.5 rounded-full border border-brass bg-canvas/40" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wednesday: choose 3 questions to ask them
// ---------------------------------------------------------------------------
type Pick = { key: string | null; text: string; custom: boolean; vector: PromptVector | null };
const pickId = (p: Pick) => (p.custom ? `text:${p.text}` : `key:${p.key}`);

function QuestionPicker({ exchange, onSaved }: { exchange: ExchangeDetail; onSaved: (x: ExchangeDetail) => void }) {
  const vectorOf = useMemo(() => new Map(exchange.prompt_bank.map((p) => [p.key, p.vector])), [exchange.prompt_bank]);
  const initial = useMemo<Pick[]>(
    () => exchange.my_picks.map((p) => ({ key: p.custom ? null : p.key, text: p.text, custom: p.custom, vector: p.custom ? null : vectorOf.get(p.key) ?? null })),
    [exchange.my_picks, vectorOf],
  );
  const [picked, setPicked] = useState<Pick[]>(initial);
  const [tab, setTab] = useState<PromptVector>('rhythm');
  const [offset, setOffset] = useState<Record<PromptVector, number>>({ rhythm: 0, repair: 0, joy: 0 });
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string }>();
  const dirty = picked.map(pickId).join('|') !== initial.map(pickId).join('|');
  const full = picked.length >= MAX_PROMPTS_PER_PICK;

  const toggle = (p: Pick) =>
    setPicked((list) =>
      list.some((x) => pickId(x) === pickId(p)) ? list.filter((x) => pickId(x) !== pickId(p)) : list.length < MAX_PROMPTS_PER_PICK ? [...list, p] : list,
    );

  const bank = exchange.prompt_bank.filter((p) => p.vector === tab && !picked.some((x) => x.key === p.key));
  const start = bank.length ? offset[tab] % bank.length : 0;
  const visible = Array.from({ length: Math.min(VISIBLE_PROMPTS, bank.length) }, (_, i) => bank[(start + i) % bank.length]!);
  const selectedHere = picked.filter((p) => p.vector === tab || p.custom);

  const save = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const questions = picked.map((p) => (p.custom ? { text: p.text } : { key: p.key! }));
      onSaved(await api<ExchangeDetail>(`/exchanges/${exchange.id}/questions`, { method: 'PUT', body: { questions } }));
      haptic([8, 40, 14]);
      setMessage({ tone: 'muted', text: 'Sent to the vault. They’ll see your questions when the Response Clock starts.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Not sent' });
    } finally {
      setBusy(false);
    }
  };

  const addOwn = () => {
    const text = draft.trim().replace(/\s+/g, ' ');
    if (text.length < CUSTOM_QUESTION_MIN) return;
    toggle({ key: null, text, custom: true, vector: null });
    setDraft('');
    setWriting(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[13px] text-ink/85">
          <MutualMark /> Mutual Match Confirmed
        </p>
        <span className="pill">
          <span className="h-1.5 w-1.5 rounded-full bg-brass" />
          <Countdown to={exchange.questions_close_at} serverNow={exchange.server_now} style="hm" /> left
        </span>
      </div>
      <h1 className="mt-5 text-[2.125rem] leading-[1.05]">Choose 3 questions to ask them</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
        Photos unblur and voice notes become playable the moment both of you lock your responses.
      </p>

      <div role="tablist" className="mt-5 grid grid-cols-3 gap-1 rounded-[14px] border border-line bg-panel p-1">
        {PROMPT_VECTORS.map((v) => {
          const has = picked.some((p) => p.vector === v);
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={tab === v}
              onClick={() => setTab(v)}
              className={cx(
                'flex min-h-[2.75rem] items-center justify-center gap-1 rounded-[10px] text-[13px] transition-colors',
                tab === v ? 'btn-copper' : has ? 'border border-line bg-raised text-ink' : 'text-muted',
              )}
            >
              {PROMPT_VECTOR_LABELS[v].title}
              {has && tab !== v && <Check size={13} />}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="eyebrow">Selected prompts</p>
        <p className="eyebrow">
          {picked.length} of {MAX_PROMPTS_PER_PICK} chosen
        </p>
      </div>

      <ul className="mt-3 space-y-2.5">
        {selectedHere.map((p) => (
          <li key={pickId(p)}>
            <button
              type="button"
              aria-pressed="true"
              onClick={() => toggle(p)}
              className="w-full rounded-[16px] border border-brass/80 bg-gradient-to-b from-brass/[0.13] to-brass/[0.03] p-4 text-left"
            >
              <span className="flex items-center justify-between">
                <span className="label-mono">{p.custom ? 'Your own question' : 'Selected'}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brass text-[#1A130B]">
                  <Check size={12} strokeWidth={3} />
                </span>
              </span>
              <span className="mt-2 block font-serif text-[1.375rem] leading-[1.2]">“{p.text}”</span>
            </button>
          </li>
        ))}
        {visible.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              aria-pressed="false"
              disabled={full}
              onClick={() => toggle({ key: p.key, text: p.text, custom: false, vector: p.vector })}
              className="flex w-full items-center gap-3 rounded-[16px] border border-line bg-panel p-4 text-left transition-colors hover:border-muted/40 disabled:opacity-40"
            >
              <span className="flex-1 font-serif text-[1.125rem] leading-snug text-ink/75">“{p.text}”</span>
              <span className="h-5 w-5 shrink-0 rounded-full border border-muted/40" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-center gap-1">
        <button type="button" onClick={() => setOffset((o) => ({ ...o, [tab]: o[tab] + VISIBLE_PROMPTS }))} className="tap gap-2 text-[13px] text-brass">
          <span aria-hidden="true">↻</span> Shuffle more conversational prompts
        </button>
        {!full && (
          <button type="button" onClick={() => setWriting(true)} className="tap text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline">
            or write your own question
          </button>
        )}
      </div>
      {message && (
        <div className="mt-2 text-center">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <StickyActions>
        <Button className="w-full" onClick={save} busy={busy} disabled={!full || !dirty}>
          {exchange.my_picks.length && !dirty ? (
            'Questions sent to the vault'
          ) : (
            <>
              Lock {MAX_PROMPTS_PER_PICK} Questions &amp; Send to Vault <span aria-hidden="true">→</span>
            </>
          )}
        </Button>
      </StickyActions>

      <BottomSheet open={writing} title="Your own question" onClose={() => setWriting(false)}>
        <label htmlFor="own-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="own-question"
          rows={3}
          maxLength={CUSTOM_QUESTION_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What’s a small ritual you’d never give up?"
          className="w-full resize-none rounded-[14px] border border-line bg-canvas px-4 py-3 font-serif text-[1.25rem] leading-snug outline-none placeholder:text-muted/50 focus:border-brass"
        />
        <p className="mt-1 text-right font-mono text-[11px] text-muted">
          {draft.trim().length}/{CUSTOM_QUESTION_MAX}
        </p>
        <Button className="mt-3 w-full" onClick={addOwn} disabled={draft.trim().length < CUSTOM_QUESTION_MIN}>
          Add question
        </Button>
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thursday–Friday: answer their 3 questions by voice
// ---------------------------------------------------------------------------
function StatusTracker({ exchange, drafted }: { exchange: ExchangeDetail; drafted: number }) {
  const total = exchange.questions_for_me.length;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center justify-between rounded-full border border-line bg-panel px-4 py-2.5 text-[13px]">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brass" /> You
          </span>
          <span className="font-mono text-[11px] text-muted">{exchange.i_locked ? 'Locked ✓' : `${drafted}/${total} Drafted`}</span>
        </div>
        <div
          className={cx(
            'flex items-center justify-between rounded-full border px-4 py-2.5 text-[13px]',
            exchange.they_locked ? 'border-brass/60 bg-brass/10' : 'border-line bg-panel',
          )}
        >
          <span className="flex items-center gap-2">
            <span className={cx('h-1.5 w-1.5 rounded-full', exchange.they_locked ? 'bg-brass' : 'animate-pulse bg-muted')} /> Them
          </span>
          <span className={cx('font-mono text-[11px]', exchange.they_locked ? 'text-brass' : 'text-muted')}>
            {exchange.they_locked ? 'Locked ✓' : 'Recording…'}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[12px] text-muted">Purely human exchange (zero AI scoring)</p>
        <p className="font-mono text-[11px] text-ink/85">
          <Countdown to={exchange.answers_close_at} serverNow={exchange.server_now} style="hm" /> left
        </p>
      </div>
    </div>
  );
}

function AnswerStudio({ exchange, onLocked }: { exchange: ExchangeDetail; onLocked: (x: ExchangeDetail) => void }) {
  const [drafts, setDrafts] = useState<Record<string, DraftInfo | null>>({});
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const support = useMemo(() => recordingAvailable(), []);
  const onDraftChange = useCallback((key: string, d: DraftInfo | null) => setDrafts((all) => ({ ...all, [key]: d })), []);
  const questions = exchange.questions_for_me;
  const drafted = questions.filter((q) => drafts[q.key]).length;
  const ready = drafted === questions.length;
  const q = questions[active]!;

  const lock = async () => {
    setConfirming(false);
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      for (const item of questions) {
        const blob = drafts[item.key]!.blob;
        const type = blob.type.split(';')[0] ?? 'audio/webm';
        form.append(item.key, blob, `${item.key}.${EXTENSION[type] ?? 'webm'}`);
      }
      const res = await api<{ released: boolean; exchange: ExchangeDetail }>(`/exchanges/${exchange.id}/lock`, { method: 'POST', form });
      await Promise.all(questions.map((item) => deleteDraft(exchange.id, item.key)));
      haptic([8, 40, 14]);
      onLocked(res.exchange);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent. Your drafts are still here.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StatusTracker exchange={exchange} drafted={drafted} />

      <div role="tablist" className="mt-4 grid gap-1 rounded-[14px] border border-line bg-panel p-1" style={{ gridTemplateColumns: `repeat(${questions.length}, 1fr)` }}>
        {questions.map((item, i) => {
          const d = drafts[item.key];
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={cx(
                'min-h-[2.75rem] rounded-[10px] font-mono text-[11.5px] transition-colors',
                active === i ? 'border border-brass/70 text-ink' : 'text-ink/70',
              )}
            >
              Q{i + 1}
              {d ? ` · ${formatSeconds(d.duration)} ✓` : ''}
            </button>
          );
        })}
      </div>

      <section className="surface mt-5 p-5">
        <div className="flex items-center justify-between">
          <span className="pill">
            Question {String(active + 1).padStart(2, '0')} of {String(questions.length).padStart(2, '0')}
          </span>
          <span className="text-[12px] text-muted">Asked by your match</span>
        </div>
        <p className="mt-4 font-serif text-[1.75rem] leading-[1.12]">“{q.text}”</p>
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">Review locally with no take limits before locking your voice vault.</p>
      </section>

      {!support.ok && (
        <div className="mt-4">
          <Notice tone="error">{support.reason}</Notice>
        </div>
      )}
      <div className="mt-4">
        {/* One recorder per question, kept mounted so switching tabs never loses a take. */}
        {questions.map((item, i) => (
          <div key={item.key} hidden={i !== active}>
            <VoiceRecorder exchangeId={exchange.id} promptKey={item.key} disabled={!support.ok || busy} onDraftChange={onDraftChange} />
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <StickyActions>
        <Button className="w-full" onClick={() => setConfirming(true)} disabled={!ready} busy={busy}>
          <Lock size={16} />
          {ready ? `Lock All ${questions.length} Answers & Unseal Vaults` : `Record ${questions.length - drafted} more to lock`}
        </Button>
      </StickyActions>

      <BottomSheet open={confirming} title="Lock your voice vault?" onClose={() => setConfirming(false)}>
        <p className="text-sm leading-relaxed text-ink/80">
          Locking is final. The moment they lock theirs, both vaults open together: you hear each other, and photos and first names unblur.
        </p>
        <div className="mt-5 space-y-2">
          <Button className="w-full" onClick={lock}>
            Lock and seal
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setConfirming(false)}>
            Keep recording
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Both vaults unlocked: the modality switch and the First-Meet Bridge
// ---------------------------------------------------------------------------
function AnswerPlayer({ answers }: { answers: ExchangeDetail['their_answers'] }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const shapes = [useAudioShape(answers[0]?.audio_url ?? null), useAudioShape(answers[1]?.audio_url ?? null), useAudioShape(answers[2]?.audio_url ?? null)];
  const current = answers[active];
  const duration = shapes[active]?.duration ?? 0;

  const select = (i: number) => {
    audio.current?.pause();
    setActive(i);
    setPosition(0);
  };
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  if (!current) return null;

  return (
    <section className="surface p-3" aria-label="Their voice answers">
      <div role="tablist" className="grid gap-1 rounded-[12px] border border-line bg-canvas/50 p-1" style={{ gridTemplateColumns: `repeat(${answers.length}, 1fr)` }}>
        {answers.map((a, i) => (
          <button
            key={a.prompt_key}
            type="button"
            role="tab"
            aria-selected={active === i}
            onClick={() => select(i)}
            className={cx('min-h-[2.5rem] rounded-[9px] font-mono text-[11px] transition-colors', active === i ? 'border border-brass/70 bg-brass/10 text-ink' : 'text-ink/65')}
          >
            Ans {i + 1}
            {shapes[i] ? ` · ${formatSeconds(shapes[i]!.duration)}` : ''}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 px-1 pb-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause answer' : 'Play answer'}
          className="btn-copper flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px]"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[1.0625rem] italic text-ink/90">“{current.text}”</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brass transition-[width] duration-200" style={{ width: `${duration ? Math.min(100, (position / duration) * 100) : 0}%` }} />
            </div>
            <span className="shrink-0 font-mono text-[10.5px] text-muted">
              {formatSeconds(position)} / {formatSeconds(duration)}
            </span>
          </div>
        </div>
      </div>
      <audio
        key={current.audio_url}
        ref={audio}
        src={current.audio_url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        className="hidden"
      />
    </section>
  );
}

function RevealScreen({ exchange }: { exchange: ExchangeDetail }) {
  const revealed = exchange.revealed!;
  const [photoIndex, setPhotoIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const matchResource = useResource<MatchDetail>(exchange.match_id ? `/matches/${exchange.match_id}` : null, 60_000);
  const [match, setMatch] = useState<MatchDetail>();
  useEffect(() => {
    if (matchResource.data) setMatch(matchResource.data);
  }, [matchResource.data]);
  const tagline = [`${exchange.counterpart.distance_km} km away`, exchange.counterpart.interests.slice(0, 2).map((i) => i.label).join(' & ')].join(' · ');

  return (
    <div>
      {/* Photo carousel, full-bleed. */}
      <div className="relative -mx-5 -mt-4 h-[22rem] overflow-hidden">
        <div
          ref={strip}
          className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
          onScroll={(e) => setPhotoIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        >
          {revealed.photo_ids.length > 0 ? (
            revealed.photo_ids.map((id, i) => (
              // Plain img: the authenticated, private photo endpoint.
              <img key={id} src={`/api/photos/${id}`} alt={`${revealed.first_name}, photo ${i + 1}`} className="h-full w-full shrink-0 snap-center animate-fade-in object-cover" />
            ))
          ) : (
            <div className="flex h-full w-full shrink-0 items-center justify-center bg-gradient-to-b from-[#2A2622] to-canvas font-serif text-[7rem] text-brass/60">
              {revealed.first_name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas via-canvas/70 to-transparent" />
        <div className="absolute inset-x-5 top-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Link href="/" aria-label="Back to this week" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas/60 backdrop-blur">
              <ChevronLeft size={16} />
            </Link>
            <span className="pill bg-canvas/60 uppercase tracking-[0.16em] backdrop-blur">Both vaults unlocked</span>
          </span>
          {revealed.photo_ids.length > 1 && (
            <span className="flex gap-1 rounded-full bg-canvas/60 px-2 py-1.5 backdrop-blur" aria-hidden="true">
              {revealed.photo_ids.map((id, i) => (
                <span key={id} className={cx('h-1 rounded-full transition-all', i === photoIndex ? 'w-4 bg-brass' : 'w-1.5 bg-ink/40')} />
              ))}
            </span>
          )}
        </div>
        <div className="absolute inset-x-5 bottom-3">
          <h1 className="text-[2.75rem] leading-none">
            {revealed.first_name}, {revealed.age}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink/75">{tagline}</p>
        </div>
      </div>

      <div className="mt-4">
        <AnswerPlayer answers={exchange.their_answers} />
      </div>

      <div className="mt-5 space-y-3">
        {match?.status === 'bridging' && <BridgePanel match={match} onUpdated={setMatch} sticky />}
        {match?.event && match.event.status !== 'cancelled' && <EventPanel match={match} onUpdated={setMatch} />}
        {match && (
          <Link href={`/matches/${match.id}`} className="tap w-full rounded-2xl border border-line bg-panel text-[13.5px] text-ink/85">
            Messages &amp; details
          </Link>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function ExchangePage() {
  const { id } = useParams<{ id: string }>();
  const session = useMemberSession();
  const resource = useResource<ExchangeDetail>(session.ready ? `/exchanges/${id}` : null, 30_000);
  const [exchange, setExchange] = useState<ExchangeDetail>();
  const [showCard, setShowCard] = useState(false);

  useEffect(() => {
    if (resource.data) setExchange(resource.data);
  }, [resource.data]);

  if (!exchange) return resource.error ? <Notice tone="error">{resource.error.message}</Notice> : <Spinner />;

  if (exchange.status === 'released' && exchange.revealed) return <RevealScreen exchange={exchange} />;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <BackLink />
        <button type="button" onClick={() => setShowCard(true)} className="tap px-2 text-[13px] text-brass">
          Their folio
        </button>
      </div>

      {exchange.status === 'questions' && <QuestionPicker exchange={exchange} onSaved={setExchange} />}
      {exchange.status === 'answering' && !exchange.i_locked && <AnswerStudio exchange={exchange} onLocked={setExchange} />}

      {exchange.status === 'answering' && exchange.i_locked && (
        <div>
          <StatusTracker exchange={exchange} drafted={exchange.my_answers.length} />
          <h1 className="mt-6 text-[2.125rem] leading-[1.05]">Your vault is locked</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            It opens the moment they lock theirs. If the Response Clock runs out first, the exchange closes quietly and every recording is
            deleted.
          </p>
          <p className="label-rule mt-8">Your answers</p>
          <ol className="mt-3 space-y-2.5">
            {exchange.my_answers.map((a, i) => (
              <li key={a.prompt_key} className="surface p-4">
                <p className="label-mono">Answer {String(i + 1).padStart(2, '0')}</p>
                <p className="mt-1.5 font-serif text-[1.25rem] leading-snug">“{a.text}”</p>
                <audio src={a.audio_url} controls preload="none" className="mt-3 h-10 w-full" />
              </li>
            ))}
          </ol>
        </div>
      )}

      {exchange.status === 'expired' && (
        <div className="pt-6">
          <h1 className="text-[2.125rem] leading-[1.05]">This exchange has closed</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            The Response Clock ran out before you both locked. Nothing was shared, and the recordings were deleted.
          </p>
        </div>
      )}

      <BottomSheet tall open={showCard} title="Their folio" onClose={() => setShowCard(false)}>
        <CardBody profile={exchange.counterpart} compact />
      </BottomSheet>
    </div>
  );
}
