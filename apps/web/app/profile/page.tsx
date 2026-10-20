'use client';

import type { ProfileResponse } from '@thirtydates/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CardBody } from '@/components/MondayCard';
import { PhotoUploader } from '@/components/PhotoUploader';
import { ProfileForm } from '@/components/ProfileForm';
import { BottomSheet, Button, Notice, Panel, ScreenHeader, Spinner } from '@/components/primitives';
import { ApiError, api, useResource } from '@/lib/api';
import { useMemberSession } from '@/lib/session';

export default function ProfilePage() {
  const router = useRouter();
  const session = useMemberSession();
  const profile = useResource<ProfileResponse>(session.ready ? '/me/profile' : null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!session.me || !profile.data) {
    return profile.error ? <Notice tone="error">{profile.error.message}</Notice> : <Spinner />;
  }
  const p = profile.data;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <ProfileForm
        initial={{
            first_name: p.first_name,
            birth_date: p.birth_date,
            gender: p.gender,
            seeks: p.seeks,
            country_code: p.country_code,
            postal_code: p.postal_code,
            search_radius_km: p.search_radius_km,
            gates: p.gates,
            coin: p.coin,
            interests: p.interests,
          }}
        submitLabel="Save changes"
        onExit={() => setEditing(false)}
        onSaved={async () => {
          await Promise.all([profile.reload(), session.reload()]);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-7">
      <ScreenHeader title={p.first_name} subtitle={session.me.email} />

      <section aria-labelledby="photos-heading">
        <h2 id="photos-heading" className="text-base">
          Your photos
        </h2>
        <p className="mb-3 text-[0.8125rem] text-muted">Blurred to everyone until you’ve both answered by voice.</p>
        <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
      </section>

      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="text-base">
          Your card, as others see it
        </h2>
        <p className="mb-3 text-[0.8125rem] text-muted">No name and no photo, just how you live.</p>
        <Panel className="p-4">
          <CardBody profile={p.preview} />
        </Panel>
      </section>

      <Button variant="quiet" className="w-full" onClick={() => setEditing(true)}>
        Change my answers
      </Button>

      <footer className="flex flex-col items-center gap-1 border-t border-line pt-5 text-sm">
        <button
          type="button"
          disabled={busy}
          className="tap text-muted hover:text-ink"
          onClick={() => run(async () => {
            await api('/auth/logout', { method: 'POST' });
            router.replace('/signin');
          })}
        >
          Sign out
        </button>
        <button type="button" className="tap text-muted hover:text-accent" onClick={() => setConfirmDelete(true)}>
          Delete my account
        </button>
        {error && <Notice tone="error">{error}</Notice>}
      </footer>

      <BottomSheet open={confirmDelete} title="Delete your account?" onClose={() => setConfirmDelete(false)}>
        <p className="text-ink/75">This can’t be undone. Your profile, photos, voice notes and matches are erased.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="ghost" className="order-2" onClick={() => setConfirmDelete(false)}>
            Keep my account
          </Button>
          <Button
            className="order-1"
            busy={busy}
            onClick={() => run(async () => {
              await api('/me', { method: 'DELETE' });
              router.replace('/signin');
            })}
          >
            Delete permanently
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
