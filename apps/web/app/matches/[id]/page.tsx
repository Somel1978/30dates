'use client';

import type { MatchDetail } from '@thirtydates/shared';
import Link from 'next/link';
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
    <div className="space-y-5">
      <Link href="/matches" className="tap -ml-2 gap-1.5 px-2 text-[13.5px] text-ink/85 hover:text-ink">
        ‹ Matches
      </Link>
      <header>
        <h1 className="text-[2.5rem] leading-none">
          {match.counterpart.first_name}, {match.counterpart.age}
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-brass">
          {match.status === 'bridging' ? 'Your photos are unblurred' : match.status === 'scheduled' ? 'You’re meeting' : 'Your match'}
        </p>
      </header>

      <div className="relative -mx-5 h-72 overflow-hidden">
        {photo ? (
          // Plain img: the authenticated, private photo endpoint.
          <img src={`/api/photos/${photo}`} alt={`Photo of ${match.counterpart.first_name}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-b from-[#2A2622] to-canvas font-serif text-[6rem] text-brass/60" aria-hidden="true">
            {match.counterpart.first_name.slice(0, 1)}
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-canvas to-transparent" />
      </div>

      {closed && <Notice>This match has closed. No one was told why — and nothing was your fault.</Notice>}

      {match.status === 'bridging' && <BridgePanel match={match} onUpdated={setMatch} />}
      {match.event && match.event.status !== 'cancelled' && <EventPanel match={match} onUpdated={setMatch} />}

      <ChatThread matchId={match.id} closed={closed} partnerName={match.counterpart.first_name} />

      {!closed && (
        <div className="text-center">
          <Button variant="ghost" onClick={() => setBlocking(true)}>
            Block and close
          </Button>
        </div>
      )}

      <BottomSheet open={blocking} title={`Block ${match.counterpart.first_name}?`} onClose={() => setBlocking(false)}>
        <p className="text-sm text-ink/80">The match closes, any meeting is cancelled, and you will never be introduced again.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="ghost" className="order-2" onClick={() => setBlocking(false)}>
            Cancel
          </Button>
          <Button
            className="order-1"
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
