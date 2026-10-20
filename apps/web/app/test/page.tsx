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
  selection: 'Monday–Tuesday: blind selection',
  exchange_questions: 'Wednesday: choosing questions',
  exchange_answers: 'Thursday–Friday noon: Response Clock running',
  bridge: 'Friday afternoon–Sunday: First-Meet Bridge',
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
        <h1 className="mt-1 text-[1.75rem]">Test tools</h1>
        <p className="mt-2 text-muted">
          Walk the whole week on your own: seed members built to match you, deal, get selected, move the clock, exchange voice notes, reach the First-Meet Bridge.
        </p>
      </header>

      <Panel className="grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <p className="eyebrow">App clock</p>
          <p className="text-lg font-semibold">{formatDateTime(s.server_now)}</p>
          <p className="text-xs text-muted">{s.clock_shifted ? 'Shifted for testing' : 'Real time'}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="eyebrow">Phase · week of {s.batch_week}</p>
          <p className="text-lg font-semibold">{PHASE_LABEL[s.phase]}</p>
        </div>
        <dl className="col-span-full grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {[
            ['Members', s.members],
            ['My cards', s.my_cards],
            ['Selected me', s.selected_me],
            ['Exchanges', s.exchanges],
            ['Matches', s.matches],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-raised/60 p-3">
              <dt className="text-muted">{k}</dt>
              <dd className="text-xl font-semibold">{v}</dd>
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
          <Step n={2} title="Open the week" detail="Moves the clock to Monday 09:00 of this week, when selection is open.">
            <Button variant="quiet" busy={busy === 'clock-monday'} onClick={() => clock('monday', 'Monday 09:00')}>
              Monday
            </Button>
          </Step>
          <Step n={3} title="Deal my cards" detail="Runs the matcher now: tops everyone up to six cards.">
            <Button busy={busy === 'deal'} onClick={() => run('deal', '/dev/deal', {}, 'Dealt. Open “This week” to see your cards.')}>
              Deal now
            </Button>
          </Step>
          <Step n={4} title="Have my cards select me" detail="Three of your cards silently select you. Select them back on “This week” to make mutual pairs.">
            <Button variant="quiet" busy={busy === 'select'} onClick={() => run('select', '/dev/select-me', { count: 3 }, 'Three cards have selected you (you can’t see which: that’s the escrow).')}>
              Select me ×3
            </Button>
          </Step>
          <Step n={5} title="Wednesday: questions" detail="Selection closes, unreciprocated selections are wiped, and each mutual pair gets a voice exchange. Drop your 2–3 questions.">
            <Button variant="quiet" busy={busy === 'clock-wednesday'} onClick={() => clock('wednesday', 'Wednesday 09:00')}>
              Wednesday
            </Button>
          </Step>
          <Step n={6} title="Thursday: Response Clock" detail="The 36-hour clock starts and you see their questions. Record and lock your answers on the exchange page.">
            <Button variant="quiet" busy={busy === 'clock-thursday'} onClick={() => clock('thursday', 'Thursday 09:00')}>
              Thursday
            </Button>
          </Step>
          <Step n={7} title="Play the other side" detail="Your mutual pairs pick questions (Wednesday) or lock generated voice answers (Thursday). When both sides lock, names, photos and the bridge release instantly.">
            <Button variant="quiet" busy={busy === 'act'} onClick={() => run('act', '/dev/counterparts-act', {}, 'Your mutual pairs have acted.')}>
              They act
            </Button>
          </Step>
          <Step n={8} title="Friday noon" detail="The Response Clock runs out: unfinished exchanges close silently and their audio is deleted.">
            <Button variant="quiet" busy={busy === 'clock-friday'} onClick={() => clock('friday', 'Friday 12:05')}>
              Friday 12:05
            </Button>
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
