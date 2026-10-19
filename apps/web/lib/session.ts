'use client';

import type { MeResponse } from '@thirtydates/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useResource } from './api';

/**
 * Member-area guard: unauthenticated visitors go to /signin, verified-but-new members to
 * /onboarding. Returns the session once it is known to be a fully onboarded member.
 */
export function useMemberSession(options: { requireOnboarded?: boolean } = {}) {
  const requireOnboarded = options.requireOnboarded ?? true;
  const router = useRouter();
  const me = useResource<MeResponse>('/me');

  useEffect(() => {
    if (me.error?.status === 401) router.replace('/signin');
    else if (requireOnboarded && me.data && !me.data.onboarding_completed) router.replace('/onboarding');
  }, [me.error, me.data, requireOnboarded, router]);

  const ready = !!me.data && (!requireOnboarded || me.data.onboarding_completed);
  return { me: me.data, ready, error: me.error && me.error.status !== 401 ? me.error : undefined, reload: me.reload };
}
