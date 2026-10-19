'use client';

import { STAMP_META, type BatchCard, type CardLine, type CardProfile } from '@thirtydates/shared';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { haptic } from '@/lib/format';
import { Badge, cx } from './primitives';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

const LINE_LABEL: Record<CardLine, string> = {
  badges: 'their life architecture',
  interest_1: 'their first interest',
  interest_2: 'their second interest',
  interest_3: 'their third interest',
  flaw: 'their flaw',
  upside: 'your upside',
};

/**
 * A line of the card that can be long-pressed (thumb, silent) to open the stamp picker.
 * Keyboard and assistive-tech users activate it with Enter/Space instead.
 */
function StampableLine({
  line,
  enabled,
  onStamp,
  stamped,
  children,
  className,
}: {
  line: CardLine;
  enabled: boolean;
  onStamp: (line: CardLine) => void;
  stamped: boolean;
  children: ReactNode;
  className?: string;
}) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | undefined>(undefined);
  const [pressing, setPressing] = useState(false);

  const cancel = () => {
    window.clearTimeout(timer.current);
    setPressing(false);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    origin.current = { x: e.clientX, y: e.clientY };
    setPressing(true);
    timer.current = window.setTimeout(() => {
      setPressing(false);
      haptic(12);
      onStamp(line);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!origin.current || !pressing) return;
    if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_TOLERANCE_PX) cancel();
  };

  if (!enabled) return <div className={cx('relative rounded-xl', className, stamped && 'ring-1 ring-brass/60')}>{children}</div>;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Stamp ${LINE_LABEL[line]} (press and hold, or press Enter)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onStamp(line);
        }
      }}
      className={cx(
        'relative cursor-pointer select-none overflow-hidden rounded-xl transition-colors duration-200 ease-calm [-webkit-touch-callout:none]',
        pressing ? 'bg-brass/10' : 'hover:bg-raised/70',
        stamped && 'ring-1 ring-brass/60',
        className,
      )}
    >
      {children}
      {pressing && <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-press-ring bg-brass" aria-hidden="true" />}
    </div>
  );
}

/** Faceless profile body shared by the Monday card and the mutual (resonance) card. */
export function CardBody({
  profile,
  stampEnabled = false,
  stampedLine = null,
  onStamp = () => undefined,
}: {
  profile: CardProfile;
  stampEnabled?: boolean;
  stampedLine?: CardLine | null;
  onStamp?: (line: CardLine) => void;
}) {
  const lineProps = (line: CardLine) => ({ line, enabled: stampEnabled, onStamp, stamped: stampedLine === line });
  return (
    <>
      {/* Top bar: distance + life-architecture badges */}
      <StampableLine {...lineProps('badges')} className="-mx-2 px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brass">{profile.distance_km} km away</Badge>
          <p className="text-sm text-muted">{profile.badges.join(' • ')}</p>
        </div>
      </StampableLine>

      {/* Middle box: three behavioural interests with receipts */}
      <div className="mt-4 rounded-2xl border border-line/60 bg-raised/40 p-2">
        <ul role="list" className="space-y-1">
          {profile.interests.map((interest) => (
            <li key={interest.position}>
              <StampableLine {...lineProps(`interest_${interest.position}` as CardLine)} className="px-3 py-2">
                <p className="font-serif text-xl leading-snug">{interest.label}</p>
                <p className="text-sm text-muted">
                  <span className="text-brass" aria-hidden="true">
                    ✓{' '}
                  </span>
                  <span className="sr-only">Receipt: </span>
                  {interest.receipt}
                </p>
              </StampableLine>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom box: the split Flaw + Upside coin */}
      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[2rem] border border-line/70">
        <StampableLine {...lineProps('flaw')} className="rounded-none border-r border-line/70 bg-forest/15 px-4 py-3">
          <p className="eyebrow">My flaw</p>
          <p className="mt-1 font-serif text-lg italic leading-snug">{profile.coin.flaw}</p>
        </StampableLine>
        <StampableLine {...lineProps('upside')} className="rounded-none bg-brass/5 px-4 py-3">
          <p className="eyebrow">Your upside</p>
          <p className="mt-1 font-serif text-lg italic leading-snug">{profile.coin.upside}</p>
        </StampableLine>
      </div>
    </>
  );
}

export interface MondayCardProps {
  card: BatchCard;
  /** Stamps and passes are open (validation window). */
  interactive: boolean;
  stampsRemaining: number;
  canFreeze: boolean;
  onStampRequest: (card: BatchCard, line: CardLine) => void;
  onPass: (card: BatchCard) => void;
  onFreeze: (card: BatchCard) => void;
  onDragStart?: (card: BatchCard, e: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** The Monday faceless card: zero photos, zero names. */
export function MondayCard({
  card,
  interactive,
  stampsRemaining,
  canFreeze,
  onStampRequest,
  onPass,
  onFreeze,
  onDragStart,
}: MondayCardProps) {
  const decided = card.my_action !== null;
  const canAct = interactive && !decided && !card.frozen;
  const stampEnabled = canAct && stampsRemaining > 0;

  return (
    <li>
      <article
        aria-label={`Card, ${card.distance_km} kilometres away`}
        className={cx(
          'relative flex h-full flex-col rounded-card border bg-panel p-5 shadow-card transition-opacity duration-300 ease-calm',
          card.my_action === 'validated' ? 'border-brass/50' : 'border-line/70',
          card.my_action === 'passed' && 'opacity-50',
        )}
      >
        {card.carried_over && (
          <p className="eyebrow mb-3 text-brass">Carried over from last week</p>
        )}

        <CardBody profile={card} stampEnabled={stampEnabled} stampedLine={card.my_stamp_line} onStamp={(line) => onStampRequest(card, line)} />

        {card.my_action === 'validated' && card.my_stamp && (
          <div
            className="pointer-events-none absolute right-4 top-4 flex h-16 w-16 animate-stamp-press items-center justify-center rounded-full border-2 border-brass/70 text-3xl"
            aria-hidden="true"
          >
            {STAMP_META[card.my_stamp].glyph}
          </div>
        )}

        {/* Action area */}
        <div className="mt-5 flex flex-1 items-end justify-between gap-2">
          {decided ? (
            <p className="text-sm text-muted" role="status">
              {card.my_action === 'validated' && card.my_stamp
                ? `Stamped: “${STAMP_META[card.my_stamp].label}”. Sealed until Sunday.`
                : 'Passed quietly.'}
            </p>
          ) : card.frozen ? (
            <p className="text-sm text-brass" role="status">
              In the Freeze Vault. It returns next Monday.
            </p>
          ) : interactive ? (
            <>
              <button
                type="button"
                onClick={() => onStampRequest(card, 'badges')}
                disabled={!stampEnabled}
                className="tap rounded-full px-4 text-sm text-brass hover:bg-brass/10 disabled:text-muted"
              >
                {stampsRemaining > 0 ? 'Stamp' : 'No stamps left'}
              </button>
              <div className="flex items-center">
                {canFreeze && (
                  <>
                    <button
                      type="button"
                      onPointerDown={(e) => onDragStart?.(card, e)}
                      onClick={() => onFreeze(card)}
                      className="tap touch-none rounded-full text-muted hover:text-brass"
                      aria-label="Move to the Freeze Vault (tap, or drag to the vault)"
                      title="Drag to the Freeze Vault"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.5" />
                        <circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" />
                        <circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" />
                        <circle cx="15" cy="18" r="1.5" />
                      </svg>
                    </button>
                  </>
                )}
                <button type="button" onClick={() => onPass(card)} className="tap rounded-full px-4 text-sm text-muted hover:text-ink">
                  Pass
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Stamps are sealed for this week.</p>
          )}
        </div>
        {stampEnabled && <p className="mt-1 text-xs text-muted">Hold any line to stamp it.</p>}
      </article>
    </li>
  );
}
