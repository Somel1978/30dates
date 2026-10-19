'use client';

import { addLocalDays, localParts, zonedTimeToUtc, type MatchDetail } from '@thirtydates/shared';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, haptic } from '@/lib/format';
import { Button, Notice, Panel, cx } from './primitives';

const LOCAL_TIMES: [number, number][] = [
  [9, 0],
  [12, 30],
  [16, 0],
  [18, 30],
];
const LEAD_MS = 3 * 3_600_000;

interface DaySlots {
  label: string;
  slots: { iso: string; label: string; evening: boolean }[];
}

/** Candidate slots in the match's zone between now (+3 h notice) and the end of the 72-hour window. */
function candidateSlots(timeZone: string, now: Date, windowEnd: Date): DaySlots[] {
  const today = localParts(now, timeZone);
  const days: DaySlots[] = [];
  for (let d = 0; d < 4; d++) {
    const day = addLocalDays(today, d);
    const slots = LOCAL_TIMES.map(([hour, minute]) => ({ at: zonedTimeToUtc({ ...day, hour, minute }, timeZone), hour }))
      .filter(({ at }) => at.getTime() >= now.getTime() + LEAD_MS && at.getTime() <= windowEnd.getTime())
      .map(({ at, hour }) => ({
        iso: at.toISOString(),
        label: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(at),
        evening: hour >= 17,
      }));
    if (slots.length === 0) continue;
    const noon = zonedTimeToUtc({ ...day, hour: 12, minute: 0 }, timeZone);
    days.push({
      label: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(noon),
      slots,
    });
  }
  return days;
}

/**
 * The First-Meet Bridge: a 45-minute coffee or wine audit at a curated venue near the midpoint,
 * within 72 hours of the release. Each person privately marks the windows they can do; nobody
 * "asks out", and the meeting locks itself at the earliest shared slot.
 */
export function BridgePanel({ match, onUpdated }: { match: MatchDetail; onUpdated: (next: MatchDetail) => void }) {
  const mine = match.bridge.my_preference;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mine?.slots ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const windowEnd = useMemo(() => new Date(match.bridge_window_closes_at), [match.bridge_window_closes_at]);
  // The server clock decides what's bookable; a wrong device clock must not offer past slots.
  const days = useMemo(
    () => candidateSlots(match.time_zone, new Date(match.server_now), windowEnd),
    [match.time_zone, match.server_now, windowEnd],
  );
  const venue = match.suggested_venue;

  const toggle = (iso: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await api<MatchDetail>(`/matches/${match.id}/bridge`, {
        method: 'PUT',
        body: { mode: 'coffee_audit', slots: [...selected] },
      });
      haptic(10);
      onUpdated(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="p-6">
      <p className="eyebrow">First-Meet Bridge</p>
      <h2 className="mt-1 text-2xl">45 minutes, coffee or wine</h2>
      {venue ? (
        <p className="mt-2 text-muted">
          <span className="text-ink">{venue.name}</span> · {venue.address}{' '}
          <a
            className="text-brass underline-offset-4 hover:underline"
            href={`https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Map
          </a>
          <br />
          <span className="text-sm">Chosen for you near your midpoint. Evening slots move to a wine bar when one is close.</span>
        </p>
      ) : (
        <p className="mt-2 text-muted">We’ll place you at a curated venue near your midpoint.</p>
      )}
      <p className="mt-2 text-sm text-muted">
        Mark every window you could do before {formatDateTime(match.bridge_window_closes_at)}. It’s private: when you share one, it locks automatically.
      </p>

      <div className="mt-5 space-y-4">
        {days.length === 0 && <Notice>There are no bookable windows left before the bridge closes.</Notice>}
        {days.map((day) => (
          <div key={day.label} className="flex flex-wrap items-center gap-2">
            <span className="w-28 text-sm text-muted">{day.label}</span>
            {day.slots.map((slot) => (
              <button
                key={slot.iso}
                type="button"
                aria-pressed={selected.has(slot.iso)}
                onClick={() => toggle(slot.iso)}
                className={cx(
                  'tap rounded-full border px-4 text-sm transition-colors',
                  selected.has(slot.iso) ? 'border-brass bg-brass/10' : 'border-line text-muted hover:border-muted',
                )}
              >
                {slot.label}
                {slot.evening && <span className="ml-1 text-xs text-muted">· wine</span>}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-start gap-3">
        <Button onClick={save} busy={busy} disabled={selected.size === 0}>
          {mine ? 'Update my windows' : 'Seal my windows'}
        </Button>
        {match.bridge.state === 'no_venue_nearby' && <Notice tone="error">No partner venue covers your midpoint yet.</Notice>}
        {mine && match.bridge.state === 'awaiting_alignment' && <Notice>Sealed. Waiting for a shared window; nothing is sent to them.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Panel>
  );
}
