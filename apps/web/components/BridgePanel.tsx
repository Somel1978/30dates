'use client';

import { addLocalDays, localParts, zonedTimeToUtc, type MatchDetail } from '@thirtydates/shared';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, haptic } from '@/lib/format';
import { Calendar, ChevronLeft, ChevronRight, Cup, Pin, Wine } from './icons';
import { Button, Notice, cx } from './primitives';

const LOCAL_TIMES: [number, number][] = [
  [9, 0],
  [12, 30],
  [16, 0],
  [18, 30],
  [20, 0],
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
    days.push({ label: new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(noon), slots });
  }
  return days;
}

/**
 * Propose a Meet-Up: a 45-minute coffee or wine at a curated venue near the midpoint, within 72
 * hours of the match. Each person privately marks every time they could do; nobody "asks out",
 * and the meeting confirms itself at the earliest time you share.
 */
export function BridgePanel({ match, onUpdated }: { match: MatchDetail; onUpdated: (next: MatchDetail) => void }) {
  const mine = match.bridge.my_preference;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mine?.slots ?? []));
  const [dayIndex, setDayIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const windowEnd = useMemo(() => new Date(match.bridge_window_closes_at), [match.bridge_window_closes_at]);
  // The server clock decides what's bookable; a wrong device clock must not offer past slots.
  const days = useMemo(() => candidateSlots(match.time_zone, new Date(match.server_now), windowEnd), [match.time_zone, match.server_now, windowEnd]);
  const day = days[Math.min(dayIndex, days.length - 1)];
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
      const next = await api<MatchDetail>(`/matches/${match.id}/bridge`, { method: 'PUT', body: { mode: 'coffee_audit', slots: [...selected] } });
      haptic(10);
      onUpdated(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-t-[1.75rem] rounded-b-2xl border border-line bg-panel px-4 pb-4 pt-3 shadow-sheet" aria-labelledby="meetup-heading">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
      <h2 id="meetup-heading" className="text-center text-lg">
        Propose a Meet-Up
      </h2>
      <p className="mt-0.5 text-center text-xs text-muted">45 minutes · before {formatDateTime(match.bridge_window_closes_at)}</p>

      {days.length === 0 ? (
        <div className="mt-4">
          <Notice>There are no bookable times left before the window closes.</Notice>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
            <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-raised px-3 py-2 text-center">
              <Calendar size={16} className="text-brass" />
              <span className="mt-0.5 text-[0.6875rem] text-muted">next 3 days</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-raised px-1">
              <button type="button" className="tap rounded-lg text-muted disabled:opacity-30" disabled={dayIndex === 0} onClick={() => setDayIndex((i) => i - 1)} aria-label="Previous day">
                <ChevronLeft size={18} />
              </button>
              <span className="text-sm font-medium">{day?.label}</span>
              <button
                type="button"
                className="tap rounded-lg text-muted disabled:opacity-30"
                disabled={dayIndex >= days.length - 1}
                onClick={() => setDayIndex((i) => i + 1)}
                aria-label="Next day"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {day?.slots.map((slot) => (
              <button
                key={slot.iso}
                type="button"
                aria-pressed={selected.has(slot.iso)}
                onClick={() => toggle(slot.iso)}
                className={cx(
                  'min-h-[2.75rem] flex-1 basis-[5.5rem] rounded-xl border text-sm font-medium transition-colors',
                  selected.has(slot.iso) ? 'border-brass bg-brass/15 text-ink' : 'border-line bg-raised text-muted',
                )}
              >
                {slot.label}
                <span className="block text-[0.6875rem] font-normal opacity-70">{slot.evening ? 'wine' : 'coffee'}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Mark every time you could do: {selected.size === 0 ? 'none yet' : `${selected.size} marked`}. It’s private, and confirms itself at the earliest time you share.
          </p>
        </>
      )}

      <ul role="list" className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
        <li className="flex min-h-[3rem] items-center gap-3 px-3">
          <Cup size={18} className="text-brass" />
          <span className="flex-1 text-sm">
            Coffee at <span className="font-medium">{venue?.venue_type === 'specialty_coffee' ? venue.name : 'a curated café'}</span>
          </span>
        </li>
        <li className="flex min-h-[3rem] items-center gap-3 px-3">
          <Wine size={18} className="text-brass" />
          <span className="flex-1 text-sm">
            Wine at <span className="font-medium">{venue?.venue_type === 'wine_bar' ? venue.name : 'a wine bar nearby'}</span>
            <span className="text-muted"> · evenings</span>
          </span>
        </li>
        {venue && (
          <li>
            <a
              className="flex min-h-[3rem] items-center gap-3 px-3 text-sm text-muted hover:text-ink"
              href={`https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lng}#map=17/${venue.lat}/${venue.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              <Pin size={18} className="text-brass" />
              Near your midpoint · {venue.address}
            </a>
          </li>
        )}
      </ul>

      <Button className="mt-4 w-full" onClick={save} busy={busy} disabled={selected.size === 0}>
        {mine ? 'Update Date Proposal' : 'Confirm Date Proposal'}
      </Button>
      <div className="mt-2 text-center">
        {match.bridge.state === 'no_venue_nearby' && <Notice tone="error">No partner venue covers your midpoint yet.</Notice>}
        {mine && match.bridge.state === 'awaiting_alignment' && <Notice>Proposed. Waiting for a time you both marked; nothing is sent to them.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </section>
  );
}
