'use client';

import type { MeResponse } from '@thirtydates/shared';
import { useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { Notice } from './primitives';

/** Up to three photos. They stay sealed until a mutual Sunday reveal or a match. */
export function PhotoUploader({ photos, onChange }: { photos: MeResponse['photos']; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const upload = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append('photo', file);
      await api('/profile/photos', { method: 'POST', form });
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api(`/profile/photos/${id}`, { method: 'DELETE' });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ul role="list" className="grid grid-cols-3 gap-3">
        {photos.map((p) => (
          <li key={p.id} className="relative">
            {/* Plain img: the authenticated, private photo endpoint. */}
            <img src={`/api/photos/${p.id}`} alt={`Your photo ${p.position}`} className="aspect-square w-full rounded-2xl object-cover" />
            <button
              type="button"
              onClick={() => remove(p.id)}
              disabled={busy}
              className="tap absolute right-1 top-1 rounded-full bg-canvas/80 text-sm"
              aria-label={`Remove photo ${p.position}`}
            >
              ✕
            </button>
          </li>
        ))}
        {photos.length < 3 && (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-line text-sm text-muted hover:border-brass hover:text-brass"
            >
              {busy ? 'Uploading…' : 'Add photo'}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </div>
  );
}
