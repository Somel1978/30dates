import type { CardProfile } from '@thirtydates/shared';
import { cx } from './primitives';

/** Life Rhythm as one sentence: "Early riser; outdoors most weekends; cooks for pleasure." */
export function rhythmSentence(rhythm: readonly string[]): string {
  return rhythm.map((r, i) => (i === 0 ? r : r.charAt(0).toLowerCase() + r.slice(1))).join('; ') + '.';
}

/** "Early 40s · 4 km away" */
export function profileMeta(profile: Pick<CardProfile, 'age_band' | 'distance_km'>): string {
  return `${profile.age_band} · ${profile.distance_km} km away`;
}

/**
 * The folio body: a whole portrait read like a magazine page. Daily Rhythm as a pull-quote, how
 * they spend their time (three concrete habits), and the honest trade-off. No photo, no name,
 * and no structural gates.
 */
export function CardBody({ profile, compact = false }: { profile: CardProfile; compact?: boolean }) {
  return (
    <div>
      <p className="label-mono">Daily rhythm</p>
      <blockquote className={cx('mt-2 font-serif leading-[1.12] text-ink', compact ? 'text-[1.5rem]' : 'text-[2rem]')}>
        “{rhythmSentence(profile.rhythm)}”
      </blockquote>

      <p className="label-rule mt-10">How I spend my time</p>
      <ol className="mt-4 space-y-2.5">
        {profile.interests.map((interest, i) => (
          <li key={interest.position} className="flex gap-3.5 rounded-[14px] border border-line bg-panel px-4 py-3.5 shadow-card">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brass/50 font-mono text-[11px] text-brass">
              {i + 1}
            </span>
            <p className="text-[0.9rem] leading-relaxed text-ink/80">
              <span className="text-ink">{interest.label}.</span> {interest.receipt}
            </p>
          </li>
        ))}
      </ol>

      <p className="label-rule mt-10">The honest trade-off</p>
      <figure className="mt-4 grid grid-cols-2 overflow-hidden rounded-[16px] border border-line shadow-card">
        <div className="bg-panel px-4 py-4">
          <figcaption className="eyebrow">The friction</figcaption>
          <p className="mt-2 font-serif text-[1.25rem] italic leading-snug text-ink/85">“{profile.coin.flaw}”</p>
        </div>
        <div className="border-l border-brass/25 bg-gradient-to-br from-brass/[0.16] to-brass/[0.03] px-4 py-4">
          <p className="label-mono">Your upside</p>
          <p className="mt-2 font-serif text-[1.25rem] italic leading-snug text-ink">“{profile.coin.upside}”</p>
        </div>
      </figure>
    </div>
  );
}
