'use client';

import type { ProfileResponse } from '@thirtydates/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CardBody } from '@/components/MondayCard';
import { PhotoUploader } from '@/components/PhotoUploader';
import { ProfileForm } from '@/components/ProfileForm';
import { BottomSheet, Button, Notice, Panel, Spinner } from '@/components/primitives';
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

  return (
    <div className="mx-auto max-w-2xl space-y-14">
      <header className="pt-6 text-center sm:pt-10">
        <h1 className="text-4xl sm:text-5xl">{p.first_name}</h1>
        <p className="mt-2 text-muted">{session.me.email}</p>
      </header>

      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="text-center text-3xl">
          Your card, as others see it
        </h2>
        <p className="mb-6 mt-1 text-center text-ink/70">No name and no photo, just how you live.</p>
        <article className="rounded-[2rem] bg-panel px-6 pb-7 pt-7 shadow-card ring-1 ring-line/50 sm:px-8">
          <CardBody profile={p.preview} />
        </article>
      </section>

      <section aria-labelledby="photos-heading">
        <h2 id="photos-heading" className="text-center text-3xl">
          Your photos
        </h2>
        <p className="mb-6 mt-1 text-center text-ink/70">Kept sealed until you and someone who chose you have both sent your voice answers.</p>
        <Panel className="p-6">
          <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
        </Panel>
      </section>

      <section aria-labelledby="answers-heading">
        <div className="text-center">
          <h2 id="answers-heading" className="text-3xl">
            Your answers
          </h2>
          <Button variant="quiet" className="mt-4" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Close' : 'Change my answers'}
          </Button>
        </div>
        {editing && (
          <div className="mt-4">
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
              onSaved={async () => {
                await Promise.all([profile.reload(), session.reload()]);
              }}
            />
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line/60 pt-8 text-sm">
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
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Keep my account
          </Button>
          <Button
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
