'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Panel, Spinner } from '@/components/primitives';
import { useMemberSession } from '@/lib/session';

export default function OnboardingPage() {
  const router = useRouter();
  const session = useMemberSession({ requireOnboarded: false });
  const [done, setDone] = useState(false);

  if (!session.me) return <Spinner />;

  if (done || session.me.onboarding_completed) {
    return (
      <div className="mx-auto max-w-xl pt-6">
        <h1 className="text-4xl">You’re on the list</h1>
        <p className="mt-3 text-muted">
          Add up to three photos. They stay sealed until a mutual Sunday reveal. You can change everything later from your
          profile.
        </p>
        <Panel className="mt-6 p-6">
          <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
        </Panel>
        <Button className="mt-6" onClick={() => router.replace('/')}>
          Go to my week
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl pt-4">
      <ProfileForm
        submitLabel="Finish and join"
        onSaved={async () => {
          await session.reload();
          setDone(true);
        }}
        header={
          <header>
            <p className="eyebrow">About 90 seconds</p>
            <h1 className="mt-2 text-4xl">Set your table</h1>
            <p className="mt-2 text-muted">No photos on cards, no names until it’s mutual. Just how you live.</p>
          </header>
        }
      />
    </div>
  );
}
