'use client';

import { addLocalDays, localParts, zonedTimeToUtc, type MatchDetail } from '@thirtydates/shared';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { haptic } from '@/lib/format';
import { Check, Pin } from './icons';
import { Button, Notice, StickyActions, cx } from './primitives';

const LOCAL_TIMES: [number, number][] = [
  [9, 0],
  [11, 0],
  [12, 30],
  [16, 0],
  [18, 30],
  [19, 0],
];
const LEAD_MS = 3 * 3_600_000;

interface Slot {
  iso: string;
  label: string;
  long: string;
}

/** Bookable starts in the match's zone between now (+3 h notice) and the end of the 72-hour window. */
function candidateSlots(timeZone: string, now: Date, windowEnd: Date): Slot[] {
  const today = localParts(now, timeZone);
  const out: Slot[] = [];
  const short = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  const long = new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  for (let d = 0; d < 4; d++) {
    const day = addLocalDays(today, d);
    for (const [hour, minute] of LOCAL_TIMES) {
      const at = zonedTimeToUtc({ ...day, hour, minute }, timeZone);
      if (at.getTime() < now.getTime() + LEAD_MS || at.getTime() > windowEnd.getTime()) continue;
      out.push({ iso: at.toISOString(), label: short.format(at).replace(',', ''), long: long.format(at).replace(',', '') });
    }
  }
  return out;
}

const VENUE_KIND = { specialty_coffee: 'Specialty Coffee', wine_bar: 'Espresso & Wine' } as const;

/**
 * The First-Meet Bridge: an invitation to a 45-minute coffee or wine audit at the venue chosen
 * near your geographic midpoint, within 72 hours. Tap every time you could do; nobody "asks out",
 * and it confirms itself at the earliest time you both proposed.
 */
export function BridgePanel({
  match,
  onUpdated,
  sticky = false,
}: {
  match: MatchDetail;
  onUpdated: (next: MatchDetail) => void;
  /** Put the Propose button in the bottom action bar (the reveal screen). */
  sticky?: boolean;
}) {
  const mine = match.bridge.my_preference;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mine?.slots ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const windowEnd = useMemo(() => new Date(match.bridge_window_closes_at), [match.bridge_window_closes_at]);
  // The server clock decides what's bookable; a wrong device clock must not offer past slots.
  const slots = useMemo(() => candidateSlots(match.time_zone, new Date(match.server_now), windowEnd), [match.time_zone, match.server_now, windowEnd]);
  const venue = match.suggested_venue;
  const venueName = venue?.name ?? 'a curated venue';
  const chosen = slots.filter((s) => selected.has(s.iso));
  const dirty = [...selected].sort().join() !== [...(mine?.slots ?? [])].sort().join();

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
      haptic([8, 40, 14]);
      onUpdated(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  let label: string;
  if (chosen.length === 0) label = 'Tap a time to propose';
  else if (mine && !dirty) label = 'Proposed · waiting for a shared time';
  else if (chosen.length === 1) label = `Propose ${chosen[0]!.long} at ${venueName}`;
  else label = `Propose ${chosen.length} windows at ${venueName}`;
  const ready = chosen.length > 0 && (!mine || dirty);

  const action = (
    <Button className="w-full" onClick={save} busy={busy} disabled={!ready}>
      <span className="min-w-0 truncate">{label}</span>
      {ready && <Check size={16} className="shrink-0" />}
    </Button>
  );

  return (
    <section
      className="rounded-[18px] border border-brass/25 bg-gradient-to-b from-[#17181D] to-panel p-4 shadow-[inset_0_1px_0_rgb(255_236_210/0.08),inset_0_-1px_0_rgb(0_0_0/0.4),0_18px_40px_-24px_rgb(0_0_0/0.8)]"
      aria-labelledby="bridge-heading"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="bridge-heading" className="whitespace-nowrap font-mono text-[10.5px] uppercase tracking-[0.12em] text-brass">
          First-Meet Bridge · 45-min audit
        </h2>
        <span className="whitespace-nowrap font-mono text-[10.5px] text-muted">72h window</span>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-[12px] border border-line bg-canvas/50 p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-brass/40 text-brass">
          <Pin size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">
            {venueName}
            {venue && <span className="text-ink/80"> · {VENUE_KIND[venue.venue_type]}</span>}
          </p>
          <p className="truncate text-[12px] text-muted">
            {venue?.midpoint_km !== undefined ? `${venue.midpoint_km} km geographic midpoint` : 'Near your geographic midpoint'}
            {venue && ` · ${venue.address}`}
          </p>
        </div>
      </div>

      {slots.length === 0 ? (
        <div className="mt-3">
          <Notice>There are no bookable times left in the window.</Notice>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {slots.map((slot) => (
            <button
              key={slot.iso}
              type="button"
              aria-pressed={selected.has(slot.iso)}
              onClick={() => toggle(slot.iso)}
              className={cx(
                'min-h-[2.75rem] rounded-[12px] border text-[13px] transition-colors',
                selected.has(slot.iso) ? 'border-brass bg-brass/15 text-ink' : 'border-line bg-canvas/40 text-ink/75 hover:border-muted/40',
              )}
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Tap every time you could do. It stays private and confirms itself at the earliest time you both proposed.
      </p>
      {match.bridge.state === 'no_venue_nearby' && (
        <div className="mt-2">
          <Notice tone="error">No partner venue covers your midpoint yet.</Notice>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {sticky ? <StickyActions>{action}</StickyActions> : <div className="mt-4">{action}</div>}
    </section>
  );
}
