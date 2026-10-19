'use client';

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export { cx };

type ButtonVariant = 'primary' | 'quiet' | 'ghost' | 'brass';

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-canvas hover:bg-accent/90 disabled:bg-accent/40',
  brass: 'border border-brass/60 text-brass hover:bg-brass/10 disabled:opacity-40',
  quiet: 'border border-line bg-panel text-ink hover:border-muted disabled:opacity-40',
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
        'tap gap-2 whitespace-nowrap rounded-full px-6 text-sm font-medium transition-colors duration-200 ease-calm disabled:cursor-not-allowed',
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
        'inline-flex items-center rounded-full border px-3 py-1 text-xs',
        tone === 'default' && 'border-line text-muted',
        tone === 'brass' && 'border-brass/50 text-brass',
        tone === 'accent' && 'border-accent/50 text-accent',
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('eyebrow', className)}>{children}</p>;
}

/** A calm surface; the building block for cards, sheets and panels. */
export function Panel({ children, className, as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={cx('rounded-card border border-line/70 bg-panel shadow-card', className)}>{children}</Tag>;
}

/**
 * "The Weekly Table": the place where this week's cards are laid out. A felt-like surface with
 * a caption rail; children are laid out as a responsive grid (stack on phones).
 */
export function WeeklyTable({ title, caption, children }: { title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="relative rounded-sheet border border-line/60 bg-forest/10 p-4 sm:p-6 dark:bg-forest/20">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-2xl">{title}</h2>
        {caption && <div className="text-sm text-muted">{caption}</div>}
      </header>
      <ul role="list" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </ul>
    </section>
  );
}

/**
 * "The Card Vault": a recessed, slotted compartment for what is kept aside (the frozen card,
 * revealed pairs). `highlight` brightens the edge while something is dragged over it.
 */
export function CardVault({
  label,
  hint,
  highlight,
  children,
  className,
  vaultRef,
}: {
  label: string;
  hint?: ReactNode;
  highlight?: boolean;
  children?: ReactNode;
  className?: string;
  vaultRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={vaultRef}
      role="region"
      aria-label={label}
      className={cx(
        'rounded-sheet border border-dashed px-4 transition-colors duration-200 ease-calm',
        highlight ? 'border-brass bg-brass/15' : 'border-line bg-raised/90',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Accessible bottom sheet: focuses the sheet, closes on Escape or backdrop tap, restores focus. */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-lg animate-sheet-up rounded-t-sheet border border-line/70 bg-panel p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-sheet sm:rounded-sheet"
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
        <h2 className="mb-4 text-2xl">{title}</h2>
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
