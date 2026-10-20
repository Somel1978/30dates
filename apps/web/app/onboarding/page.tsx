'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, ScreenHeader, Spinner, StickyActions } from '@/components/primitives';
import { useMemberSession } from '@/lib/session';

export default function OnboardingPage() {
  const router = useRouter();
  const session = useMemberSession({ requireOnboarded: false });
  const [done, setDone] = useState(false);

  if (!session.me) return <Spinner />;

  if (done || session.me.onboarding_completed) {
    return (
      <div>
        <ScreenHeader title="You’re on the list" subtitle="Add up to three photos. They stay blurred until you’ve both answered by voice." />
        <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
        <StickyActions>
          <Button className="w-full" onClick={() => router.replace('/')}>
            Go to my week
          </Button>
        </StickyActions>
      </div>
    );
  }

  return (
    <ProfileForm
      submitLabel="Finish and join"
      onSaved={async () => {
        await session.reload();
        setDone(true);
      }}
    />
  );
}
