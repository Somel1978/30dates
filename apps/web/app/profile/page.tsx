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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="eyebrow">{session.me.email}</p>
        <h1 className="mt-1 text-4xl">{p.first_name}</h1>
        {p.paused && <p className="mt-2 text-brass">Introductions paused. You won’t be dealt new cards until you resume.</p>}
      </header>

      <section aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="text-2xl">
          Your card, as others see it
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">
          No name and no photo. Each person sees their own distance to you.
        </p>
        <article className="rounded-card border border-line/70 bg-panel p-5 shadow-card">
          <CardBody profile={p.preview} />
        </article>
      </section>

      <section aria-labelledby="photos-heading">
        <h2 id="photos-heading" className="text-2xl">
          Photos
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">Released only when you and a mutual selection have both locked your voice answers.</p>
        <Panel className="p-6">
          <PhotoUploader photos={session.me.photos} onChange={() => void session.reload()} />
        </Panel>
      </section>

      <section aria-labelledby="answers-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="answers-heading" className="text-2xl">
            Your answers
          </h2>
          <Button variant="quiet" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Close' : 'Edit'}
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

      <section aria-labelledby="account-heading" className="space-y-3">
        <h2 id="account-heading" className="text-2xl">
          Account
        </h2>
        <Panel className="divide-y divide-line/60 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p>{p.paused ? 'Resume introductions' : 'Pause introductions'}</p>
              <p className="text-sm text-muted">Matches and chats stay open while paused.</p>
            </div>
            <Button
              variant="quiet"
              busy={busy}
              onClick={() => run(async () => {
                await api('/me/pause', { method: 'POST', body: { paused: !p.paused } });
                await profile.reload();
              })}
            >
              {p.paused ? 'Resume' : 'Pause'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p>Sign out on every device</p>
            <Button
              variant="quiet"
              busy={busy}
              onClick={() => run(async () => {
                await api('/auth/logout', { method: 'POST' });
                router.replace('/signin');
              })}
            >
              Sign out
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p>Delete account</p>
              <p className="text-sm text-muted">Removes your profile, photos, voice notes and matches permanently.</p>
            </div>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete…
            </Button>
          </div>
        </Panel>
        {error && <Notice tone="error">{error}</Notice>}
      </section>

      <BottomSheet open={confirmDelete} title="Delete your account?" onClose={() => setConfirmDelete(false)}>
        <p className="text-muted">This can’t be undone. Your profile, photos, voice notes, matches and messages are erased.</p>
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
