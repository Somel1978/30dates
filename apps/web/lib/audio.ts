'use client';

import { useEffect, useState } from 'react';

export interface AudioShape {
  /** Seconds. MediaRecorder WebM often reports Infinity to <audio>, so it is decoded instead. */
  duration: number;
  /** Normalised peak per bucket (0..1), for the waveform. */
  peaks: number[];
}

/** Decodes a recording on the device to get its true length and a coarse waveform. */
export async function analyseAudio(blob: Blob, buckets = 30): Promise<AudioShape> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const peaks: number[] = [];
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      for (let i = b * size; i < Math.min(data.length, (b + 1) * size); i += 16) max = Math.max(max, Math.abs(data[i]!));
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.01);
    return { duration: buffer.duration, peaks: peaks.map((p) => p / top) };
  } finally {
    void ctx.close();
  }
}

/** Fetches (same-origin, with the session cookie) and analyses a stored answer. */
export function useAudioShape(url: string | null): AudioShape | null {
  const [shape, setShape] = useState<AudioShape | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('audio'))))
      .then((blob) => analyseAudio(blob))
      .then((s) => !cancelled && setShape(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  return shape;
}

/** "0:46" */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "00:46" for the mono recorder clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
