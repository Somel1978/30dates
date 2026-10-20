'use client';

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft } from './icons';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export { cx };

type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'brass';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'btn-gold hover:brightness-105 disabled:opacity-40 disabled:shadow-none',
  brass: 'border border-brass/60 text-brass hover:bg-brass/10 disabled:opacity-40',
  quiet: 'border border-line bg-raised text-ink hover:border-muted disabled:opacity-40',
  ghost: 'text-muted hover:text-ink disabled:opacity-40',
};

export function Button({
  variant = 'primary',
  className,
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        'tap gap-2 whitespace-nowrap rounded-xl px-5 text-[0.9375rem] font-medium transition duration-200 ease-calm disabled:cursor-not-allowed',
        buttonStyles[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'brass' | 'accent' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs',
        tone === 'default' && 'border-line text-muted',
        tone === 'brass' && 'border-brass/50 text-brass',
        tone === 'accent' && 'border-accent/50 text-accent',
      )}
    >
      {children}
    </span>
  );
}

/** A raised surface; the building block for cards, sheets and panels. */
export function Panel({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cx('rounded-2xl border border-line bg-panel shadow-card', className)}>{children}</Tag>;
}

/** Screen title block: optional back chevron, a title and a quiet subtitle. */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  align = 'center',
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  align?: 'center' | 'left';
  children?: ReactNode;
}) {
  return (
    <header className={cx('mb-6 pt-2', align === 'center' && 'text-center')}>
      {onBack && (
        <button type="button" onClick={onBack} className="tap -ml-3 mb-1 rounded-full text-ink/80 hover:text-ink" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      )}
      <h1 className="text-[1.75rem] leading-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      {children}
    </header>
  );
}

/** Thin gold progress bar with an "n/total" counter, as on the onboarding steps. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gradient-to-r from-[#C49A42] to-[#E9CD82] transition-[width] duration-500 ease-calm" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="text-sm tabular-nums text-muted">
        {value}/{max}
      </span>
    </div>
  );
}

export function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-brass' : 'border-muted/50',
      )}
    >
      {checked && <span className="h-2.5 w-2.5 rounded-full bg-brass" />}
    </span>
  );
}

/** Tappable row: icon tile, title, subtitle and a trailing indicator (radio by default). */
export function OptionRow({
  icon,
  title,
  subtitle,
  selected = false,
  onClick,
  trailing,
  disabled,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        'flex min-h-[4.25rem] w-full items-center gap-3.5 rounded-2xl border px-4 py-3 text-left transition-colors duration-200 disabled:opacity-40',
        selected ? 'border-brass/70 bg-brass/[0.08]' : 'border-line bg-panel hover:border-muted/60',
      )}
    >
      {icon && (
        <span
          className={cx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            selected ? 'bg-brass/20 text-brass' : 'bg-raised text-brass/90',
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-medium leading-snug">{title}</span>
        {subtitle && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">{subtitle}</span>}
      </span>
      {trailing ?? <Radio checked={selected} />}
    </button>
  );
}

/** Bottom action area that stays under the thumb, above the tab bar. */
export function StickyActions({ children, aboveTabs = false }: { children: ReactNode; aboveTabs?: boolean }) {
  return (
    <div className={cx('sticky z-30 -mx-5 mt-6 bg-gradient-to-t from-canvas via-canvas/95 to-transparent px-5 pb-4 pt-6', aboveTabs ? 'bottom-16' : 'bottom-0')}>
      {children}
    </div>
  );
}

/** Accessible bottom sheet: focuses the sheet, closes on Escape or backdrop tap, restores focus. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
  tall = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  tall?: boolean;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && sheet.current) {
        const focusable = sheet.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, select');
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'relative w-full max-w-md animate-sheet-up overflow-y-auto rounded-t-[1.75rem] border border-b-0 border-line bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-sheet',
          tall ? 'max-h-[92dvh]' : 'max-h-[85dvh]',
        )}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        <h2 className="mb-3 text-xl">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'error'; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={cx('text-sm', tone === 'error' ? 'text-accent' : 'text-muted')}>
      {children}
    </p>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-[40vh] items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brass" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
