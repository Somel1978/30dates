'use client';

import type { MatchDetail } from '@thirtydates/shared';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BridgePanel } from '@/components/BridgePanel';
import { ChatThread } from '@/components/ChatThread';
import { EventPanel } from '@/components/EventPanel';
import { BottomSheet, Button, Notice, Spinner } from '@/components/primitives';
import { api, useResource } from '@/lib/api';
import { useMemberSession } from '@/lib/session';

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = useMemberSession();
  const resource = useResource<MatchDetail>(session.ready ? `/matches/${id}` : null, 60_000);
  const [match, setMatch] = useState<MatchDetail>();
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    if (resource.data) setMatch(resource.data);
  }, [resource.data]);

  if (!match) {
    if (resource.error) return <Notice tone="error">{resource.error.message}</Notice>;
    return <Spinner />;
  }

  const photo = match.counterpart.photo_ids[0];
  const closed = match.status === 'expired';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-4">
        {photo ? (
          // Plain img: the authenticated, private photo endpoint.
          <img src={`/api/photos/${photo}`} alt={`Photo of ${match.counterpart.first_name}`} className="h-20 w-20 rounded-full object-cover ring-2 ring-brass/50" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-forest font-serif text-3xl ring-2 ring-brass/50" aria-hidden="true">
            {match.counterpart.first_name.slice(0, 1)}
          </span>
        )}
        <div>
          <p className="eyebrow text-brass">It’s mutual</p>
          <h1 className="text-4xl">{match.counterpart.first_name}</h1>
        </div>
      </header>

      {closed && <Notice>This match has closed. No one was told why — and nothing was your fault.</Notice>}

      {match.status === 'bridging' && <BridgePanel match={match} onUpdated={setMatch} />}
      {match.event && match.event.status !== 'cancelled' && <EventPanel match={match} onUpdated={setMatch} />}

      <ChatThread matchId={match.id} closed={closed} partnerName={match.counterpart.first_name} />

      {!closed && (
        <div className="text-right">
          <Button variant="ghost" onClick={() => setBlocking(true)}>
            Block and close
          </Button>
        </div>
      )}

      <BottomSheet open={blocking} title={`Block ${match.counterpart.first_name}?`} onClose={() => setBlocking(false)}>
        <p className="text-muted">The match closes, any meeting is cancelled, and you will never be introduced again.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setBlocking(false)}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              await api('/blocks', { method: 'POST', body: { target_user_id: match.counterpart.user_id } });
              router.replace('/matches');
            }}
          >
            Block
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
