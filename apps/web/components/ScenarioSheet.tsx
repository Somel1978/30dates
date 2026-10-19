'use client';

import type { ScenarioExchangeResponse } from '@thirtydates/shared';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/format';
import { BottomSheet, Notice, Spinner, cx } from './primitives';

/**
 * Mid-week scenario exchange: two everyday dilemmas, three silent tap-to-select stances each.
 * Once both people have answered both, a micro-comparison appears.
 */
export function ScenarioSheet({ targetId, open, onClose, onAnswered }: { targetId: string; open: boolean; onClose: () => void; onAnswered: () => void }) {
  const [exchange, setExchange] = useState<ScenarioExchangeResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    api<ScenarioExchangeResponse>(`/scenarios/${targetId}`)
      .then(setExchange)
      .catch((err: ApiError) => setError(err.message));
  }, [open, targetId]);

  const answer = async (scenarioKey: string, stanceKey: string) => {
    setBusy(scenarioKey);
    setError(undefined);
    try {
      const next = await api<ScenarioExchangeResponse>(`/scenarios/${targetId}`, {
        method: 'POST',
        body: { scenario_key: scenarioKey, stance_key: stanceKey },
      });
      haptic(10);
      setExchange(next);
      onAnswered();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Try again');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <BottomSheet open={open} title="Scenario exchange" onClose={onClose}>
      {!exchange && !error && <Spinner />}
      {exchange && (
        <div className="max-h-[65dvh] space-y-6 overflow-y-auto pr-1">
          {exchange.scenarios.map((s) => (
            <fieldset key={s.key}>
              <legend className="mb-3 font-serif text-xl leading-snug">{s.prompt}</legend>
              <div className="space-y-2">
                {s.stances.map((st) => {
                  const mine = s.my_stance === st.key;
                  const theirs = s.their_stance === st.key;
                  return (
                    <button
                      key={st.key}
                      type="button"
                      disabled={s.my_stance !== null || busy === s.key}
                      onClick={() => answer(s.key, st.key)}
                      aria-pressed={mine}
                      className={cx(
                        'flex min-h-touch w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-colors',
                        mine ? 'border-brass bg-brass/10' : 'border-line bg-raised/40',
                        s.my_stance === null && 'hover:border-muted',
                      )}
                    >
                      <span>{st.label}</span>
                      <span className="flex shrink-0 gap-1 text-xs">
                        {mine && <span className="rounded-full bg-brass/20 px-2 py-0.5 text-brass">You</span>}
                        {theirs && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">Them</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <Notice>
            {exchange.comparison_ready
              ? exchange.scenarios.filter((s) => s.my_stance === s.their_stance).length === exchange.scenarios.length
                ? 'Same instincts on both.'
                : 'Different instincts — worth a conversation.'
              : 'Their stances appear once you have both answered.'}
          </Notice>
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </BottomSheet>
  );
}
