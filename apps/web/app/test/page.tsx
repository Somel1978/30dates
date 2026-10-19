'use client';

import type { DevStatus } from '@thirtydates/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Notice, Panel, Spinner } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMemberSession } from '@/lib/session';

const PHASE_LABEL: Record<DevStatus['phase'], string> = {
  awaiting_deal: 'Monday before 07:00: waiting for the deal',
  validation: 'Week open: stamps, passes, freeze',
  sealed: 'Sunday night: stamps sealed',
  reveal: 'Sunday reveal: names and photos unblurred',
  signal: 'Sunday evening: #1 Signal open',
};

function Step({
  n,
  title,
  detail,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium">
          <span className="mr-2 text-brass">{n}.</span>
          {title}
        </p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

/**
 * Development-only test tools: walk the whole weekly ritual alone in a few minutes.
 * The API exposes these endpoints only when NODE_ENV=development.
 */
export default function TestToolsPage() {
  const session = useMemberSession();
  const status = useResource<DevStatus>(session.ready ? '/dev/status' : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'muted' | 'error'; text: string } | null>(null);

  if (status.error?.status === 404) {
    return (
      <Panel className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl">Test tools are off</h1>
        <p className="mt-2 text-muted">They only exist when the API runs with NODE_ENV=development.</p>
      </Panel>
    );
  }
  if (!status.data) return status.error ? <Notice tone="error">{status.error.message}</Notice> : <Spinner />;
  const s = status.data;

  const run = async (key: string, path: string, body: unknown, done: string) => {
    setBusy(key);
    setMessage(null);
    try {
      await api<DevStatus>(path, { method: 'POST', body });
      await status.reload();
      setMessage({ tone: 'muted', text: done });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof ApiError ? err.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  };
  const clock = (to: string, label: string) => run(`clock-${to}`, '/dev/clock', { to }, `Clock moved: ${label}.`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow text-brass">Development only</p>
        <h1 className="mt-1 text-4xl">Test tools</h1>
        <p className="mt-2 text-muted">
          Walk the whole week on your own: seed members built to match you, deal, get stamped, move the clock, get a match.
        </p>
      </header>

      <Panel className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="eyebrow">App clock</p>
          <p className="font-serif text-xl">{formatDateTime(s.server_now)}</p>
          <p className="text-xs text-muted">{s.clock_shifted ? 'Shifted for testing' : 'Real time'}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="eyebrow">Phase · week of {s.batch_week}</p>
          <p className="font-serif text-xl">{PHASE_LABEL[s.phase]}</p>
        </div>
        <dl className="col-span-full grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ['Members', s.members],
            ['My cards', s.my_cards],
            ['Stamped me', s.stamped_me],
            ['Mutual', s.mutual],
            ['Matches', s.matches],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-raised/60 p-3">
              <dt className="text-muted">{k}</dt>
              <dd className="font-serif text-2xl">{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <Panel className="p-0">
        <ol className="divide-y divide-line/60">
          <Step n={1} title="Seed members" detail="Nearby, inside your age window, the genders you seek, the same life-architecture answers.">
            <Button busy={busy === 'seed'} onClick={() => run('seed', '/dev/seed', { count: 24 }, '24 members created.')}>
              Add 24
            </Button>
          </Step>
          <Step n={2} title="Open the week" detail="Moves the clock to Monday 09:00 of this week if stamps are closed.">
            <Button variant="quiet" busy={busy === 'clock-monday'} onClick={() => clock('monday', 'Monday 09:00')}>
              Monday
            </Button>
          </Step>
          <Step n={3} title="Deal my cards" detail="Runs the matcher now: tops everyone up to six cards.">
            <Button busy={busy === 'deal'} onClick={() => run('deal', '/dev/deal', {}, 'Dealt. Open “This week” to see your cards.')}>
              Deal now
            </Button>
          </Step>
          <Step n={4} title="Have my cards stamp me" detail="Three of your cards silently validate you. Stamp them back on “This week” to make a mutual pair.">
            <Button variant="quiet" busy={busy === 'stamp'} onClick={() => run('stamp', '/dev/stamp-me', { count: 3 }, 'Three cards have stamped you (you can’t see which: that’s the escrow).')}>
              Stamp me ×3
            </Button>
          </Step>
          <Step n={5} title="Mid-week" detail="Wednesday unlocks the scenario exchange for mutual pairs.">
            <Button variant="quiet" busy={busy === 'clock-wednesday'} onClick={() => clock('wednesday', 'Wednesday 09:00')}>
              Wednesday
            </Button>
          </Step>
          <Step n={6} title="Sunday reveal" detail="Runs the 06:00 reveal: names and photos unblur, unreciprocated stamps are wiped.">
            <Button variant="quiet" busy={busy === 'clock-reveal'} onClick={() => clock('reveal', 'Sunday 06:05, reveal ran')}>
              Sunday 06:05
            </Button>
          </Step>
          <Step n={7} title="Sunday signal" detail="Opens the #1 Signal. Send yours on “This week”, then have them signal you back.">
            <Button variant="quiet" busy={busy === 'clock-signal'} onClick={() => clock('signal', 'Sunday 18:05')}>
              Sunday 18:05
            </Button>
            <Button variant="quiet" busy={busy === 'signal'} onClick={() => run('signal', '/dev/signal-me', {}, 'Your mutual pairs have signalled you.')}>
              Signal me
            </Button>
          </Step>
          <Step n={8} title="Next week" detail="Closes signals and deals next Monday (cards never repeat, frozen cards carry over).">
            <Button variant="quiet" busy={busy === 'clock-next_monday'} onClick={() => clock('next_monday', 'next Monday 07:05, deal ran')}>
              Next Monday
            </Button>
          </Step>
          <Step n={9} title="Back to real time" detail="Returns the app clock to now. Restarting the API also resets it.">
            <Button variant="ghost" busy={busy === 'clock-real'} onClick={() => clock('real', 'real time')}>
              Real time
            </Button>
          </Step>
        </ol>
      </Panel>

      <p className="text-sm text-muted">
        After each step, check <Link href="/" className="text-brass underline-offset-4 hover:underline">This week</Link> and{' '}
        <Link href="/matches" className="text-brass underline-offset-4 hover:underline">Matches</Link>.
      </p>
    </div>
  );
}
