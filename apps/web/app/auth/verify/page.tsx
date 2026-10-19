'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Panel, Spinner } from '@/components/primitives';
import { ApiError, api } from '@/lib/api';

function Verify() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    // Links are single-use: guard against React strict-mode double effects.
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setError('This sign-in link is incomplete.');
      return;
    }
    api<{ onboarded: boolean }>('/auth/verify', { method: 'POST', body: { token } })
      .then(({ onboarded }) => router.replace(onboarded ? '/' : '/onboarding'))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'));
  }, [params, router]);

  if (!error) return <Spinner label="Signing you in" />;
  return (
    <Panel className="mx-auto mt-10 max-w-md p-6">
      <h1 className="text-2xl">That link didn’t work</h1>
      <p className="mt-2 text-muted" role="alert">
        {error}
      </p>
      <Link href="/signin" className="tap mt-4 rounded-full bg-accent px-6 text-sm font-medium text-canvas">
        Request a new link
      </Link>
    </Panel>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Verify />
    </Suspense>
  );
}
