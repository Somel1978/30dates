'use client';

import { MAX_ANSWER_SECONDS } from '@thirtydates/shared';
import { useEffect, useRef, useState } from 'react';
import { deleteDraft, loadDraft, saveDraft } from '@/lib/drafts';
import { haptic } from '@/lib/format';
import { cx } from './primitives';

const MIME_PREFERENCES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

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

/**
 * One answer. Record, listen back and re-record as often as you like: drafts stay on this
 * device (local draft buffer) and nothing uploads until you lock. There are deliberately no
 * editing tools; only the Response Clock limits how long you deliberate.
 */
export function VoiceRecorder({
  exchangeId,
  promptKey,
  question,
  disabled,
  onDraftChange,
}: {
  exchangeId: string;
  promptKey: string;
  question: string;
  disabled: boolean;
  onDraftChange: (promptKey: string, blob: Blob | null) => void;
}) {
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onChange = useRef(onDraftChange);
  onChange.current = onDraftChange;

  const showDraft = (blob: Blob | null) => {
    setDraftUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return blob ? URL.createObjectURL(blob) : null;
    });
    onChange.current(promptKey, blob);
  };

  // Restore a draft saved earlier on this device.
  useEffect(() => {
    let cancelled = false;
    void loadDraft(exchangeId, promptKey).then((blob) => {
      if (!cancelled && blob) showDraft(blob);
    });
    return () => {
      cancelled = true;
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(timer.current);
    };
    // Restore once per question.
  }, [exchangeId, promptKey]);

  const stop = () => {
    window.clearInterval(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const start = async () => {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        showDraft(blob);
        void saveDraft(exchangeId, promptKey, blob);
        haptic(10);
      };
      recorder.current = rec;
      rec.start(1000);
      setRecording(true);
      setElapsed(0);
      const startedAt = Date.now();
      timer.current = window.setInterval(() => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(secs);
        if (secs >= MAX_ANSWER_SECONDS) stop();
      }, 250);
    } catch {
      setError('Microphone access was blocked. Allow it in your browser settings to record.');
    }
  };

  const discard = () => {
    showDraft(null);
    void deleteDraft(exchangeId, promptKey);
  };

  return (
    <div className="rounded-2xl border border-line/70 bg-raised/40 p-4">
      <p className="font-serif text-xl leading-snug">{question}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="tap gap-2 rounded-full bg-accent px-5 text-sm font-medium text-canvas"
            aria-label="Stop recording"
          >
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-canvas" aria-hidden="true" />
            Stop · {elapsed}s / {MAX_ANSWER_SECONDS}s
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={disabled}
            className={cx(
              'tap rounded-full border px-5 text-sm',
              draftUrl ? 'border-line text-muted hover:text-ink' : 'border-brass/60 text-brass hover:bg-brass/10',
              'disabled:opacity-40',
            )}
          >
            {draftUrl ? 'Record again' : 'Record answer'}
          </button>
        )}
        {draftUrl && !recording && (
          <>
            {/* Local playback of the draft; nothing has been sent. */}
            <audio src={draftUrl} controls className="h-10 max-w-full" />
            <button type="button" onClick={discard} disabled={disabled} className="tap rounded-full px-3 text-sm text-muted hover:text-ink">
              Discard
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        {draftUrl ? 'Draft saved on this device only. Re-record as often as you like.' : `Up to ${MAX_ANSWER_SECONDS} seconds.`}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
