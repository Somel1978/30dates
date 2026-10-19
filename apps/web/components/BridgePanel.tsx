'use client';

import {
  AUDIO_LOUNGE_LOCAL_HOUR,
  BRIDGE_HORIZON_DAYS,
  BRIDGE_MODES,
  BRIDGE_MODE_META,
  addLocalDays,
  localParts,
  zonedTimeToUtc,
  type BridgeMode,
  type MatchDetail,
} from '@thirtydates/shared';
import { useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { haptic } from '@/lib/format';
import { Button, Notice, Panel, cx } from './primitives';

const COFFEE_TIMES: [number, number][] = [
  [9, 0],
  [12, 30],
  [16, 0],
  [18, 30],
];
const MAX_SLOTS = 21;

interface DaySlots {
  label: string;
  slots: { iso: string; label: string }[];
}

/** Candidate slots in the match's zone, mirroring the server-side slot rules. */
function candidateSlots(mode: BridgeMode, timeZone: string, now: Date): DaySlots[] {
  const leadMs = (mode === 'audio_lounge' ? 2 : 12) * 3_600_000;
  const today = localParts(now, timeZone);
  const days: DaySlots[] = [];
  for (let d = 0; d < BRIDGE_HORIZON_DAYS; d++) {
    const day = addLocalDays(today, d);
    const times: [number, number][] = mode === 'audio_lounge' ? [[AUDIO_LOUNGE_LOCAL_HOUR, 0]] : COFFEE_TIMES;
    const slots = times
      .map(([hour, minute]) => zonedTimeToUtc({ ...day, hour, minute }, timeZone))
      .filter((s) => s.getTime() > now.getTime() + leadMs)
      .filter((s) => mode !== 'audio_lounge' || localParts(s, timeZone).isoWeekday <= 5)
      .map((s) => ({
        iso: s.toISOString(),
        label: new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone }).format(s),
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
 * The First-Meet Bridge toggle. Each person privately picks a path and the windows they can do;
 * nobody "asks out" — the event locks itself the moment both choices are compatible.
 */
export function BridgePanel({ match, onUpdated }: { match: MatchDetail; onUpdated: (next: MatchDetail) => void }) {
  const mine = match.bridge.my_preference;
  const [mode, setMode] = useState<BridgeMode>(mine?.mode ?? 'audio_lounge');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(mine?.slots ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const days = useMemo(() => candidateSlots(mode, match.time_zone, new Date()), [mode, match.time_zone]);

  const switchMode = (next: BridgeMode) => {
    setMode(next);
    setSelected(new Set(mine?.mode === next ? mine.slots : []));
  };

  const toggle = (iso: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(iso)) next.delete(iso);
      else if (next.size < MAX_SLOTS) next.add(iso);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await api<MatchDetail>(`/matches/${match.id}/bridge`, { method: 'PUT', body: { mode, slots: [...selected] } });
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
      <h2 className="mt-1 text-2xl">How would you like to meet?</h2>
      <p className="mt-1 text-sm text-muted">Your choice is private. When you both pick the same path and a shared window, it locks automatically.</p>

      <div role="radiogroup" aria-label="Meeting path" className="mt-5 grid gap-3 sm:grid-cols-2">
        {BRIDGE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => switchMode(m)}
            className={cx(
              'min-h-touch rounded-2xl border p-4 text-left transition-colors',
              mode === m ? 'border-brass bg-brass/10' : 'border-line hover:border-muted',
            )}
          >
            <p className="font-serif text-xl">{BRIDGE_MODE_META[m].title}</p>
            <p className="text-sm text-muted">{BRIDGE_MODE_META[m].detail}</p>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        <p className="eyebrow">Windows you can do · {selected.size} selected</p>
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
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col items-start gap-3">
        <Button onClick={save} busy={busy} disabled={selected.size === 0}>
          {mine ? 'Update my preference' : 'Seal my preference'}
        </Button>
        {match.bridge.state === 'no_venue_nearby' && (
          <Notice tone="error">No partner venue covers your midpoint yet. The audio lounge is always available.</Notice>
        )}
        {mine && match.bridge.state === 'awaiting_alignment' && <Notice>Sealed. Waiting for a compatible choice — nothing is sent to them.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Panel>
  );
}
