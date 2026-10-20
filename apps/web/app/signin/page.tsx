'use client';

import { useState, type FormEvent } from 'react';
import { Button, Notice, Panel } from '@/components/primitives';
import { ApiError, api } from '@/lib/api';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/magic-link', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-8">
      <div className="text-center">
        <p className="text-sm font-medium text-brass">For members aged 30–55</p>
        <h1 className="mt-3 text-[2rem] leading-tight">Six introductions.<br />Every Monday.</h1>
        <p className="mx-auto mt-3 max-w-xs text-muted">No swiping, no feeds, no “likes you” lists. Character first; faces when it’s mutual.</p>
      </div>

      <Panel className="mt-8 p-5">
        {sent ? (
          <div role="status">
            <h2 className="text-xl">Check your inbox</h2>
            <p className="mt-2 text-muted">
              If <span className="text-ink">{email}</span> can sign in, a link is on its way. It works once and expires in 15 minutes.
            </p>
            <Button variant="ghost" className="-ml-4 mt-4" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 min-h-touch w-full rounded-xl border border-line bg-raised px-4 text-base outline-none focus:border-brass"
            />
            <Button type="submit" className="mt-5 w-full" busy={busy} disabled={!email.includes('@')}>
              Email me a sign-in link
            </Button>
            {error && (
              <div className="mt-3">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
          </form>
        )}
      </Panel>
    </div>
  );
}
