'use client';

import { BRIDGE_MODE_META, RAINCHECK_MAX_SHIFT_HOURS, RAINCHECK_MIN_SHIFT_HOURS, type MatchDetail } from '@thirtydates/shared';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { BottomSheet, Button, Notice, Panel } from './primitives';

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function downloadIcs(match: MatchDetail) {
  const event = match.event!;
  const start = new Date(event.starts_at);
  const end = new Date(start.getTime() + event.duration_minutes * 60_000);
  const title = `${BRIDGE_MODE_META[event.mode].title} with ${match.counterpart.first_name}`;
  const location = event.venue ? `${event.venue.name}, ${event.venue.address}` : 'Partner venue';
  const escape = (s: string) => s.replace(/([,;\\])/g, '\\$1');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Thirty Dates//First-Meet Bridge//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@thirtydates`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escape(title)}`,
    `LOCATION:${escape(location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'first-meet.ics';
  a.click();
  URL.revokeObjectURL(url);
}

/** The locked meeting, plus the Freeze Raincheck protocol. */
export function EventPanel({ match, onUpdated }: { match: MatchDetail; onUpdated: (next: MatchDetail) => void }) {
  const event = match.event!;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const upcoming = Date.parse(event.starts_at) > Date.now();

  const act = async (path: string) => {
    setBusy(true);
    setError(undefined);
    setConfirming(false);
    try {
      onUpdated(await api<MatchDetail>(`/matches/${match.id}${path}`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <p className="eyebrow">{event.status === 'completed' ? 'You met' : 'Locked in'}</p>
      <h2 className="mt-1 text-xl">{BRIDGE_MODE_META[event.mode].title}</h2>
      <p className="mt-1 text-lg">{formatDateTime(event.starts_at)}</p>
      {event.venue && (
        <p className="mt-1 text-muted">
          {event.venue.name} · {event.venue.address}{' '}
          <a
            className="text-brass underline-offset-4 hover:underline"
            href={`https://www.openstreetmap.org/?mlat=${event.venue.lat}&mlon=${event.venue.lng}#map=17/${event.venue.lat}/${event.venue.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Map
          </a>
        </p>
      )}

      {event.raincheck && (
        <div className="mt-5 rounded-2xl border border-brass/40 bg-brass/5 p-4">
          <p className="font-medium">Raincheck proposed: {formatDateTime(event.raincheck.proposed_starts_at)}</p>
          <p className="text-sm text-muted">
            {event.raincheck.requested_by_me
              ? `Waiting for ${match.counterpart.first_name} to accept · ${formatDuration(Date.parse(event.raincheck.expires_at) - Date.now())} left`
              : `Accept within ${formatDuration(Date.parse(event.raincheck.expires_at) - Date.now())} or the match closes.`}
          </p>
          {!event.raincheck.requested_by_me && (
            <Button className="mt-3" onClick={() => act('/raincheck/accept')} busy={busy}>
              Accept new time
            </Button>
          )}
        </div>
      )}

      {event.status === 'scheduled' && upcoming && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="quiet" onClick={() => downloadIcs(match)}>
            Add to calendar
          </Button>
          <Button variant="brass" onClick={() => setConfirming(true)} disabled={!match.freeze_token_available}>
            {match.freeze_token_available ? 'Raincheck' : 'Freeze Token used this week'}
          </Button>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <BottomSheet open={confirming} title="Request a raincheck?" onClose={() => setConfirming(false)}>
        <p className="text-muted">
          Life happens. This spends your Freeze Token for the week and proposes the same time {RAINCHECK_MIN_SHIFT_HOURS}–
          {RAINCHECK_MAX_SHIFT_HOURS} hours later. {match.counterpart.first_name} has 24 hours to accept; otherwise the match closes kindly.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Keep the date
          </Button>
          <Button onClick={() => act('/raincheck')} busy={busy}>
            Spend token
          </Button>
        </div>
      </BottomSheet>
    </Panel>
  );
}
