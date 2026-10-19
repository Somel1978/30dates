'use client';

import type { ChatMessageDto } from '@thirtydates/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { Button, Notice, Panel, cx } from './primitives';

const POLL_MS = 5_000;

/** Text-only chat. Silent by design: no sounds, no read receipts, no typing indicators. */
export function ChatThread({ matchId, closed, partnerName }: { matchId: string; closed: boolean; partnerName: string }) {
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const last = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const since = last.current ? `?since=${encodeURIComponent(last.current)}` : '';
    try {
      const fresh = await api<ChatMessageDto[]>(`/matches/${matchId}/messages${since}`);
      if (fresh.length) {
        last.current = fresh[fresh.length - 1]!.created_at;
        setMessages((m) => {
          const seen = new Set(m.map((x) => x.id));
          return [...m, ...fresh.filter((x) => !seen.has(x.id))];
        });
      }
    } catch {
      // Transient; the next poll retries.
    }
  }, [matchId]);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(undefined);
    try {
      const sent = await api<ChatMessageDto>(`/matches/${matchId}/messages`, { method: 'POST', body: { body } });
      setDraft('');
      last.current = sent.created_at;
      setMessages((m) => (m.some((x) => x.id === sent.id) ? m : [...m, sent]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not sent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="flex flex-col p-0">
      <div className="max-h-[55dvh] min-h-48 space-y-3 overflow-y-auto p-5" aria-live="polite" aria-label={`Conversation with ${partnerName}`}>
        {messages.length === 0 && <p className="text-center text-sm text-muted">Say hello. No rush.</p>}
        {messages.map((m) => (
          <div key={m.id} className={cx('flex', m.sender_is_me ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[80%] rounded-2xl px-4 py-2', m.sender_is_me ? 'bg-accent/15' : 'bg-raised')}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-0.5 text-right text-[0.7rem] text-muted">{formatTime(m.created_at)}</p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      {closed ? (
        <p className="border-t border-line/70 p-5 text-sm text-muted">This conversation has closed.</p>
      ) : (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line/70 p-3">
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-touch flex-1 resize-none rounded-2xl border border-line bg-canvas px-4 py-3 text-base outline-none focus:border-brass"
          />
          <Button type="submit" busy={busy} disabled={!draft.trim()}>
            Send
          </Button>
        </form>
      )}
      {error && (
        <div className="px-5 pb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Panel>
  );
}
