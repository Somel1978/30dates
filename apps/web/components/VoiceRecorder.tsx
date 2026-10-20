'use client';

import { MAX_ANSWER_SECONDS } from '@thirtydates/shared';
import { useEffect, useRef, useState } from 'react';
import { analyseAudio, formatClock } from '@/lib/audio';
import { deleteDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { haptic } from '@/lib/format';
import { Mic } from './icons';
import { cx } from './primitives';

const MIME_PREFERENCES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const BARS = 30;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_PREFERENCES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** Recording needs a secure context (HTTPS or localhost) and MediaRecorder support. */
export function recordingAvailable(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined') return { ok: false };
  if (!window.isSecureContext) return { ok: false, reason: 'Voice recording needs HTTPS (or localhost).' };
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { ok: false, reason: 'This browser cannot record audio.' };
  }
  return { ok: true };
}

/** Copper bar waveform; bars before `progress` (0..1) are lit. */
export function Waveform({ peaks, progress = 1, live = false }: { peaks: number[]; progress?: number; live?: boolean }) {
  const bars = peaks.length ? peaks : Array.from({ length: BARS }, (_, i) => 0.12 + 0.06 * Math.sin(i));
  return (
    <div className="flex h-12 items-center gap-[3px]" aria-hidden="true">
      {bars.map((p, i) => (
        <span
          key={i}
          className={cx(
            'w-[3px] flex-1 rounded-full transition-[height] duration-150',
            !peaks.length ? 'bg-line' : i / bars.length < progress ? 'bg-brass' : 'bg-brass/30',
            live && 'bg-accent',
          )}
          style={{ height: `${Math.max(10, Math.round(p * 100))}%` }}
        />
      ))}
    </div>
  );
}

export interface DraftInfo {
  blob: Blob;
  duration: number;
}

/**
 * One answer's recorder. Record, play back and re-record as often as you like: drafts stay on
 * this device (local draft buffer) and nothing uploads until you lock. No editing tools; only
 * the Response Clock limits how long you deliberate.
 */
export function VoiceRecorder({
  exchangeId,
  promptKey,
  disabled,
  onDraftChange,
}: {
  exchangeId: string;
  promptKey: string;
  disabled: boolean;
  onDraftChange: (promptKey: string, draft: DraftInfo | null) => void;
}) {
  const [draft, setDraft] = useState<{ url: string; duration: number; peaks: number[] } | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [livePeaks, setLivePeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const audio = useRef<HTMLAudioElement>(null);
  const onChange = useRef(onDraftChange);
  onChange.current = onDraftChange;

  const showDraft = async (blob: Blob | null) => {
    if (!blob) {
      setDraft((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
      onChange.current(promptKey, null);
      return;
    }
    let shape = { duration: 0, peaks: [] as number[] };
    try {
      shape = await analyseAudio(blob, BARS);
    } catch {
      // Undecodable here (rare codec): still playable and uploadable.
    }
    setDraft((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(blob), ...shape };
    });
    onChange.current(promptKey, { blob, duration: shape.duration });
  };

  // Restore a draft saved earlier on this device.
  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setPosition(0);
    void loadDraft(exchangeId, promptKey).then((blob) => {
      if (!cancelled && blob) void showDraft(blob);
    });
    return () => {
      cancelled = true;
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(timer.current);
    };
  }, [exchangeId, promptKey]);

  const stop = () => {
    window.clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const start = async () => {
    setError(undefined);
    audio.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      // Live level meter while recording.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        void showDraft(blob);
        void saveDraft(exchangeId, promptKey, blob);
        haptic(10);
      };
      recorder.current = rec;
      rec.start(1000);
      setRecording(true);
      setElapsed(0);
      setLivePeaks([]);
      const startedAt = Date.now();
      timer.current = window.setInterval(() => {
        const secs = (Date.now() - startedAt) / 1000;
        setElapsed(secs);
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const v of samples) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLivePeaks((p) => [...p, Math.min(1, peak * 2.5)].slice(-BARS));
        if (secs >= MAX_ANSWER_SECONDS) stop();
      }, 120);
    } catch {
      setError('Microphone access was blocked. Allow it in your browser settings to record.');
    }
  };

  const togglePlay = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const rerecord = async () => {
    await deleteDraft(exchangeId, promptKey);
    void showDraft(null);
    void start();
  };

  const total = recording ? elapsed : draft?.duration ?? 0;
  const status = recording ? 'Recording' : draft ? 'Draft ready' : 'No draft yet';

  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between">
        <p className={cx('flex items-center gap-2 text-[13px]', recording ? 'text-accent' : draft ? 'text-brass' : 'text-muted')}>
          <span className={cx('h-1.5 w-1.5 rounded-full', recording ? 'animate-pulse bg-accent' : draft ? 'bg-brass' : 'bg-muted/50')} />
          {status}
        </p>
        <p className="font-mono text-[11px] tracking-[0.1em] text-ink/85">
          {formatClock(playing ? position : total)} / {formatClock(MAX_ANSWER_SECONDS)}
        </p>
      </div>

      <div className="mt-3">
        <Waveform peaks={recording ? livePeaks : draft?.peaks ?? []} progress={playing && draft?.duration ? position / draft.duration : 1} live={recording} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!draft || recording}
          className="tap gap-2 rounded-xl border border-line bg-raised px-3.5 text-[13px] disabled:opacity-35"
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
          {playing ? 'Pause' : 'Play Draft'}
        </button>
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={disabled}
          aria-label={recording ? 'Stop recording' : 'Record answer'}
          className={cx(
            'flex h-14 w-14 items-center justify-center rounded-full transition disabled:opacity-35',
            recording ? 'bg-accent text-canvas' : 'btn-copper',
          )}
        >
          {recording ? <span className="h-4 w-4 rounded-[3px] bg-canvas" /> : <Mic size={22} />}
        </button>
        <button
          type="button"
          onClick={rerecord}
          disabled={!draft || recording || disabled}
          className="tap gap-2 rounded-xl border border-line bg-raised px-3.5 text-[13px] disabled:opacity-35"
        >
          <span aria-hidden="true">↻</span>
          Re-record
        </button>
      </div>
      {draft && (
        <audio
          ref={audio}
          src={draft.url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          className="hidden"
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
