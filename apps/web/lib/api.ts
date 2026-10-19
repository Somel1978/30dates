'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Same-origin JSON client; the httpOnly session cookie travels automatically. */
export async function api<T>(path: string, options: { method?: Method; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? 'GET', credentials: 'same-origin', headers: {} };
  if (options.form) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, init);
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? 'request_failed', payload?.message ?? 'Something went wrong');
  }
  return payload as T;
}

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Fetches a GET resource and optionally refreshes it on an interval while the tab is visible. */
export function useResource<T>(path: string | null, refreshMs?: number): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const next = await api<T>(path);
      if (current.current === path) {
        setData(next);
        setError(undefined);
      }
    } catch (err) {
      if (current.current === path) setError(err instanceof ApiError ? err : new ApiError(0, 'network', 'You appear to be offline'));
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void reload();
    if (!refreshMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [path, refreshMs, reload]);

  return { data, error, loading, reload };
}
