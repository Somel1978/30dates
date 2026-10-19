'use client';

import {
  FAMILY_GOALS,
  FINANCIAL_RHYTHMS,
  GATE_LABELS,
  GATE_QUESTIONS,
  GENDERS,
  GENDER_LABELS,
  INTEREST_CATALOG,
  INTEREST_BY_KEY,
  LIVING_ARCHITECTURES,
  MOBILITY_PROFILES,
  PLATFORM_MAX_AGE,
  PLATFORM_MIN_AGE,
  SEEKS,
  SEEKS_LABELS,
  type LifeArchitectureGates,
  type OnboardingPayload,
} from '@thirtydates/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { Button, Notice, Panel, Spinner, cx } from '@/components/primitives';
import { ApiError, api } from '@/lib/api';
import { localTimeZone } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const inputClass = 'min-h-touch w-full rounded-xl border border-line bg-canvas px-4 text-base outline-none focus:border-brass';

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="eyebrow mb-2 block">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  labels,
}: {
  legend: string;
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-base">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cx(
              'tap rounded-full border px-5 text-sm transition-colors',
              value === o ? 'border-brass bg-brass/10 text-ink' : 'border-line text-muted hover:border-muted',
            )}
          >
            {labels[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function isoYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toISOString().slice(0, 10);
}

type Draft = Partial<Omit<OnboardingPayload, 'gates' | 'interests'>> & {
  gates: Partial<LifeArchitectureGates>;
  interests: { key: string; receipt: string }[];
};

export default function OnboardingPage() {
  const router = useRouter();
  const session = useMemberSession({ requireOnboarded: false });
  const [draft, setDraft] = useState<Draft>({ country_code: 'GB', search_radius_km: 25, gates: {}, interests: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [locating, setLocating] = useState(false);
  const [done, setDone] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setGate = <K extends keyof LifeArchitectureGates>(key: K, value: LifeArchitectureGates[K]) =>
    setDraft((d) => ({ ...d, gates: { ...d.gates, [key]: value } }));

  const toggleInterest = (key: string) =>
    setDraft((d) => {
      const has = d.interests.some((i) => i.key === key);
      if (has) return { ...d, interests: d.interests.filter((i) => i.key !== key) };
      if (d.interests.length >= 3) return d;
      return { ...d, interests: [...d.interests, { key, receipt: '' }] };
    });

  const complete = useMemo(() => {
    const g = draft.gates;
    return (
      !!draft.first_name?.trim() &&
      !!draft.birth_date &&
      !!draft.gender &&
      !!draft.seeks &&
      !!draft.postal_code?.trim() &&
      !!g.family_goal &&
      !!g.living_architecture &&
      !!g.mobility &&
      !!g.financial_rhythm &&
      (draft.coin?.flaw.trim().length ?? 0) >= 3 &&
      (draft.coin?.upside.trim().length ?? 0) >= 3 &&
      draft.interests.length === 3 &&
      draft.interests.every((i) => i.receipt.trim().length >= 3)
    );
  }, [draft]);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Round on the device too: ~100 m precision is all we ever store.
        set('coordinates', { lat: Math.round(pos.coords.latitude * 1000) / 1000, lng: Math.round(pos.coords.longitude * 1000) / 1000 });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/onboarding', {
        method: 'POST',
        body: { ...draft, time_zone: localTimeZone() } as OnboardingPayload,
      });
      await session.reload();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (!session.me) return <Spinner />;

  if (done || session.me.onboarding_completed) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <h1 className="text-4xl">You’re on the list</h1>
        <p className="mt-3 text-muted">
          Your first six introductions arrive Monday at 07:00 UTC. Add up to three photos — they stay sealed until a mutual Sunday reveal.
        </p>
        <Panel className="mt-6 p-6">
          <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
        </Panel>
        <Button className="mt-6" onClick={() => router.replace('/')}>
          Go to my week
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-8 pt-4" noValidate>
      <header>
        <p className="eyebrow">About 90 seconds</p>
        <h1 className="mt-2 text-4xl">Set your table</h1>
        <p className="mt-2 text-muted">No photos on cards, no names until it’s mutual. Just how you live.</p>
      </header>

      <Panel className="space-y-5 p-6">
        <h2 className="text-2xl">You</h2>
        <Field label="First name" htmlFor="first_name" hint="Only shown after a mutual Sunday reveal.">
          <input id="first_name" className={inputClass} autoComplete="given-name" maxLength={40} value={draft.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} />
        </Field>
        <Field label="Birth date" htmlFor="birth_date" hint={`Members are ${PLATFORM_MIN_AGE} to ${PLATFORM_MAX_AGE}.`}>
          <input
            id="birth_date"
            type="date"
            className={inputClass}
            min={isoYearsAgo(PLATFORM_MAX_AGE + 1, 1)}
            max={isoYearsAgo(PLATFORM_MIN_AGE)}
            value={draft.birth_date ?? ''}
            onChange={(e) => set('birth_date', e.target.value)}
          />
        </Field>
        <Segmented legend="I am" options={GENDERS} labels={GENDER_LABELS} value={draft.gender} onChange={(v) => set('gender', v)} />
        <Segmented legend="I’d like to meet" options={SEEKS} labels={SEEKS_LABELS} value={draft.seeks} onChange={(v) => set('seeks', v)} />
      </Panel>

      <Panel className="space-y-5 p-6">
        <h2 className="text-2xl">Where</h2>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <Field label="Country" htmlFor="country">
            <input
              id="country"
              className={inputClass}
              maxLength={2}
              autoComplete="country"
              value={draft.country_code ?? ''}
              onChange={(e) => set('country_code', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Postal code" htmlFor="postal">
            <input id="postal" className={inputClass} autoComplete="postal-code" value={draft.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="quiet" onClick={locate} busy={locating}>
            {draft.coordinates ? 'Approximate location set' : 'Use my approximate location'}
          </Button>
          <p className="text-xs text-muted">Rounded to ~100 m. Otherwise we use your postal code’s centre.</p>
        </div>
        <Field label={`Search radius · ${draft.search_radius_km} km`} htmlFor="radius">
          <input
            id="radius"
            type="range"
            min={5}
            max={200}
            step={5}
            value={draft.search_radius_km}
            onChange={(e) => set('search_radius_km', Number(e.target.value))}
            className="h-12 w-full accent-[rgb(var(--color-brass))]"
          />
        </Field>
      </Panel>

      <Panel className="space-y-6 p-6">
        <h2 className="text-2xl">Life architecture</h2>
        <Segmented legend={GATE_QUESTIONS.family_goal} options={FAMILY_GOALS} labels={GATE_LABELS.family_goal} value={draft.gates.family_goal} onChange={(v) => setGate('family_goal', v)} />
        <Segmented legend={GATE_QUESTIONS.living_architecture} options={LIVING_ARCHITECTURES} labels={GATE_LABELS.living_architecture} value={draft.gates.living_architecture} onChange={(v) => setGate('living_architecture', v)} />
        <Segmented legend={GATE_QUESTIONS.mobility} options={MOBILITY_PROFILES} labels={GATE_LABELS.mobility} value={draft.gates.mobility} onChange={(v) => setGate('mobility', v)} />
        <Segmented legend={GATE_QUESTIONS.financial_rhythm} options={FINANCIAL_RHYTHMS} labels={GATE_LABELS.financial_rhythm} value={draft.gates.financial_rhythm} onChange={(v) => setGate('financial_rhythm', v)} />
      </Panel>

      <Panel className="space-y-5 p-6">
        <h2 className="text-2xl">Your Flaw + Upside coin</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="My flaw" htmlFor="flaw">
            <input
              id="flaw"
              className={inputClass}
              maxLength={120}
              placeholder="Over-prepares for travel"
              value={draft.coin?.flaw ?? ''}
              onChange={(e) => set('coin', { flaw: e.target.value, upside: draft.coin?.upside ?? '' })}
            />
          </Field>
          <Field label="Your upside" htmlFor="upside">
            <input
              id="upside"
              className={inputClass}
              maxLength={120}
              placeholder="Every trip is seamless"
              value={draft.coin?.upside ?? ''}
              onChange={(e) => set('coin', { flaw: draft.coin?.flaw ?? '', upside: e.target.value })}
            />
          </Field>
        </div>
      </Panel>

      <Panel className="space-y-5 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl">Three behavioral interests</h2>
          <span className="text-sm text-muted">{draft.interests.length}/3</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {INTEREST_CATALOG.map((i) => {
            const selected = draft.interests.some((s) => s.key === i.key);
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={selected}
                disabled={!selected && draft.interests.length >= 3}
                onClick={() => toggleInterest(i.key)}
                className={cx(
                  'tap rounded-full border px-4 text-sm transition-colors disabled:opacity-40',
                  selected ? 'border-brass bg-brass/10 text-ink' : 'border-line text-muted hover:border-muted',
                )}
              >
                {i.label}
              </button>
            );
          })}
        </div>
        {draft.interests.map((sel, idx) => {
          const def = INTEREST_BY_KEY.get(sel.key)!;
          return (
            <Field key={sel.key} label={`Receipt · ${def.label}`} htmlFor={`receipt-${sel.key}`} hint="A concrete thing you actually do.">
              <input
                id={`receipt-${sel.key}`}
                className={inputClass}
                maxLength={140}
                placeholder={def.receiptHint}
                value={sel.receipt}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    interests: d.interests.map((x, j) => (j === idx ? { ...x, receipt: e.target.value } : x)),
                  }))
                }
              />
            </Field>
          );
        })}
      </Panel>

      <div className="flex flex-col items-start gap-3">
        <Button type="submit" disabled={!complete} busy={busy}>
          Finish and join
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </form>
  );
}
