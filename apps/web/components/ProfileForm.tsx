'use client';

import {
  FAMILY_GOALS,
  FINANCIAL_RHYTHMS,
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
import { useState, type ReactNode } from 'react';
import { ApiError, api } from '@/lib/api';
import { localTimeZone } from '@/lib/format';
import { Coins, Compass, Family, Home, Pin } from './icons';
import { BottomSheet, Button, Notice, OptionRow, ProgressBar, ScreenHeader, StickyActions, cx } from './primitives';

const inputClass = 'min-h-touch w-full rounded-xl border border-line bg-raised px-4 text-base outline-none placeholder:text-muted/60 focus:border-brass';

type GateKey = keyof LifeArchitectureGates;

/** The four structural gates, as asked on "Your Core Structure". Never shown on a card. */
const GATES: {
  key: GateKey;
  title: string;
  icon: ReactNode;
  options: readonly { value: string; label: string; detail: string }[];
}[] = [
  {
    key: 'family_goal',
    title: 'Family goal',
    icon: <Family />,
    options: [
      { value: FAMILY_GOALS[0], label: 'Open to having kids', detail: 'I’d like to build a family' },
      { value: FAMILY_GOALS[1], label: 'Have kids, or happy to blend', detail: 'Co-parenting and blended families welcome' },
      { value: FAMILY_GOALS[2], label: 'Not looking for more kids', detail: 'A partnership of two, by choice' },
    ],
  },
  {
    key: 'living_architecture',
    title: 'Living',
    icon: <Home />,
    options: [
      { value: LIVING_ARCHITECTURES[0], label: 'Co-habit', detail: 'Eventually share one home' },
      { value: LIVING_ARCHITECTURES[1], label: 'Living apart together', detail: 'Committed, with two homes' },
      { value: LIVING_ARCHITECTURES[2], label: 'Flexible', detail: 'Happy to work it out together' },
    ],
  },
  {
    key: 'mobility',
    title: 'Mobility',
    icon: <Compass />,
    options: [
      { value: MOBILITY_PROFILES[0], label: 'Rooted locally', detail: 'My life is here and staying here' },
      { value: MOBILITY_PROFILES[1], label: 'Open to relocate', detail: 'For the right person or chapter' },
      { value: MOBILITY_PROFILES[2], label: 'Location-independent', detail: 'I can live and work anywhere' },
    ],
  },
  {
    key: 'financial_rhythm',
    title: 'Financial rhythm',
    icon: <Coins />,
    options: [
      { value: FINANCIAL_RHYTHMS[0], label: 'Saver & investor', detail: 'Security first, then treats' },
      { value: FINANCIAL_RHYTHMS[1], label: 'Balanced', detail: 'Save steadily, spend with intent' },
      { value: FINANCIAL_RHYTHMS[2], label: 'Experiences first', detail: 'Money is for living now' },
    ],
  },
];

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-ink/90">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Chips<T extends string>({
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
      <legend className="mb-2 text-sm font-medium text-ink/90">{legend}</legend>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cx(
              'tap rounded-xl border px-2 text-sm transition-colors',
              value === o ? 'border-brass/70 bg-brass/10 text-ink' : 'border-line bg-panel text-muted hover:border-muted/60',
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

export type ProfileDraft = Partial<Omit<OnboardingPayload, 'gates' | 'interests'>> & {
  gates: Partial<LifeArchitectureGates>;
  interests: { key: string; receipt: string }[];
};

type Draft = ProfileDraft;

const STEPS = ['about', 'structure', 'where', 'interests', 'coin'] as const;

/**
 * The Day-1 profile (about 90 seconds), one short step at a time. Used for onboarding and,
 * prefilled, for editing. Submits to POST /api/onboarding, which upserts every answer and
 * recomputes the vector.
 */
export function ProfileForm({
  initial,
  submitLabel,
  onSaved,
  onExit,
}: {
  initial?: ProfileDraft;
  submitLabel: string;
  onSaved: () => void | Promise<void>;
  /** Back from the first step (editing only). */
  onExit?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial ?? { country_code: 'GB', search_radius_km: 25, gates: {}, interests: [] });
  const [step, setStep] = useState(0);
  const [openGate, setOpenGate] = useState<GateKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [locating, setLocating] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setGate = (key: GateKey, value: string) => setDraft((d) => ({ ...d, gates: { ...d.gates, [key]: value } }));

  const toggleInterest = (key: string) =>
    setDraft((d) => {
      const has = d.interests.some((i) => i.key === key);
      if (has) return { ...d, interests: d.interests.filter((i) => i.key !== key) };
      if (d.interests.length >= 3) return d;
      return { ...d, interests: [...d.interests, { key, receipt: '' }] };
    });

  const g = draft.gates;
  const valid: Record<(typeof STEPS)[number], boolean> = {
    about: !!draft.first_name?.trim() && !!draft.birth_date && !!draft.gender && !!draft.seeks,
    structure: !!g.family_goal && !!g.living_architecture && !!g.mobility && !!g.financial_rhythm,
    where: !!draft.postal_code?.trim() && (draft.country_code?.trim().length ?? 0) === 2,
    interests: draft.interests.length === 3 && draft.interests.every((i) => i.receipt.trim().length >= 3),
    coin: (draft.coin?.flaw.trim().length ?? 0) >= 3 && (draft.coin?.upside.trim().length ?? 0) >= 3,
  };
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

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

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/onboarding', { method: 'POST', body: { ...draft, time_zone: localTimeZone() } as OnboardingPayload });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (!valid[current]) return;
    if (last) void submit();
    else {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0 });
    }
  };
  const back = step > 0 ? () => setStep((s) => s - 1) : onExit;

  const gateDef = GATES.find((x) => x.key === openGate);

  return (
    <div>
      <ScreenHeader
        align="left"
        onBack={back}
        title={
          {
            about: 'About you',
            structure: 'Your Core Structure',
            where: 'Where you are',
            interests: 'Three things you do',
            coin: 'Your Flaw + Upside',
          }[current]
        }
      >
        <div className="mt-4">
          <ProgressBar value={step + 1} max={STEPS.length} />
        </div>
      </ScreenHeader>

      {current === 'about' && (
        <div className="space-y-5">
          <Field label="First name" htmlFor="first_name" hint="Only revealed once you’ve both answered by voice.">
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
          <Chips legend="I am" options={GENDERS} labels={GENDER_LABELS} value={draft.gender} onChange={(v) => set('gender', v)} />
          <Chips legend="I’d like to meet" options={SEEKS} labels={SEEKS_LABELS} value={draft.seeks} onChange={(v) => set('seeks', v)} />
        </div>
      )}

      {current === 'structure' && (
        <div>
          <p className="-mt-2 mb-5 text-sm text-muted">Never shown to anyone. It quietly makes sure everyone you meet wants the same kind of life.</p>
          <div className="space-y-3">
            {GATES.map((gate) => {
              const chosen = gate.options.find((o) => o.value === g[gate.key]);
              return (
                <OptionRow
                  key={gate.key}
                  icon={gate.icon}
                  title={gate.title}
                  subtitle={chosen ? `Selection: ${chosen.label}` : 'Tap to choose'}
                  selected={!!chosen}
                  onClick={() => setOpenGate(gate.key)}
                />
              );
            })}
          </div>
        </div>
      )}

      {current === 'where' && (
        <div className="space-y-5">
          <div className="grid grid-cols-[5.5rem_1fr] gap-3">
            <Field label="Country" htmlFor="country">
              <input id="country" className={inputClass} maxLength={2} autoComplete="country" value={draft.country_code ?? ''} onChange={(e) => set('country_code', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Postal code" htmlFor="postal">
              <input id="postal" className={inputClass} autoComplete="postal-code" value={draft.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
            </Field>
          </div>
          <OptionRow
            icon={<Pin />}
            title={draft.coordinates ? 'Approximate location set' : 'Use my approximate location'}
            subtitle={locating ? 'Locating…' : 'Rounded to about 100 m. Otherwise we use your postal code.'}
            selected={!!draft.coordinates}
            onClick={locate}
          />
          <Field label={`How far you’d travel for a first coffee · ${draft.search_radius_km} km`} htmlFor="radius">
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
        </div>
      )}

      {current === 'interests' && (
        <div>
          <p className="-mt-2 mb-4 text-sm text-muted">
            Not what you like in theory: what actually fills your weeks. {draft.interests.length < 3 ? `Choose ${3 - draft.interests.length} more.` : ''}
          </p>
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
                    'min-h-[2.5rem] rounded-full border px-3.5 text-sm transition-colors disabled:opacity-35',
                    selected ? 'border-brass/70 bg-brass/10 text-ink' : 'border-line bg-panel text-muted hover:border-muted/60',
                  )}
                >
                  {i.label}
                </button>
              );
            })}
          </div>
          <div className="mt-6 space-y-5">
            {draft.interests.map((sel, idx) => {
              const def = INTEREST_BY_KEY.get(sel.key)!;
              return (
                <Field key={sel.key} label={`${def.label}: what does that look like for you?`} htmlFor={`detail-${sel.key}`}>
                  <input
                    id={`detail-${sel.key}`}
                    className={inputClass}
                    maxLength={140}
                    placeholder={def.receiptHint}
                    value={sel.receipt}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, interests: d.interests.map((x, j) => (j === idx ? { ...x, receipt: e.target.value } : x)) }))
                    }
                  />
                </Field>
              );
            })}
          </div>
        </div>
      )}

      {current === 'coin' && (
        <div className="space-y-5">
          <p className="-mt-2 text-sm text-muted">One honest flaw, and the good side of it that someone close to you gets to enjoy.</p>
          <Field label="My flaw" htmlFor="flaw">
            <input id="flaw" className={inputClass} maxLength={120} placeholder="Over-prepares for travel" value={draft.coin?.flaw ?? ''} onChange={(e) => set('coin', { flaw: e.target.value, upside: draft.coin?.upside ?? '' })} />
          </Field>
          <Field label="Your upside" htmlFor="upside">
            <input id="upside" className={inputClass} maxLength={120} placeholder="Every trip is seamless" value={draft.coin?.upside ?? ''} onChange={(e) => set('coin', { flaw: draft.coin?.flaw ?? '', upside: e.target.value })} />
          </Field>
        </div>
      )}

      <StickyActions>
        <Button className="w-full" onClick={next} disabled={!valid[current]} busy={busy}>
          {last ? submitLabel : 'Continue'}
        </Button>
        {error && (
          <div className="mt-2 text-center">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </StickyActions>

      <BottomSheet open={!!gateDef} title={gateDef?.title ?? ''} onClose={() => setOpenGate(null)}>
        <div className="space-y-2.5">
          {gateDef?.options.map((o) => (
            <OptionRow
              key={o.value}
              title={o.label}
              subtitle={o.detail}
              selected={g[gateDef.key] === o.value}
              onClick={() => {
                setGate(gateDef.key, o.value);
                setOpenGate(null);
              }}
            />
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
