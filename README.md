# Thirty Dates

A zero-burnout, non-rotating relationship platform for adults aged 30–55. Every Monday at 07:00 UTC each member is dealt six faceless cards. Interest is held in a simultaneous blind escrow. Names and photos unblur only for mutual pairs on Sunday morning, and a match forms only when both send each other their Sunday #1 Signal.

```
packages/shared   Domain constants, deterministic vector builder, week clock, tz helpers, API contracts
apps/api          Fastify API, Monday matcher, escrow state machine, UTC cron worker
apps/web          Next.js (App Router) + Tailwind client
db/migrations     PostgreSQL + PostGIS + pgvector schema
```

## Running locally

You need Node 20+ and PostgreSQL 15+ with the PostGIS and pgvector extensions. No Docker.

### Database

Install natively, using whichever line matches your machine:

| OS | Command |
|---|---|
| macOS (Homebrew) | `brew install postgresql@16 postgis pgvector && brew services start postgresql@16` |
| Ubuntu / Debian | `sudo apt install postgresql-16 postgresql-16-postgis-3 postgresql-16-pgvector` |
| Windows | Install from postgresql.org, then add PostGIS through Stack Builder, and pgvector following its README. |

On macOS, Homebrew's superuser is your login name rather than `postgres`, so set `ADMIN_DATABASE_URL=postgres://$USER@localhost:5432/postgres`.

A hosted Postgres works too, such as Neon or Supabase; both offer PostGIS and pgvector. Point `DATABASE_URL` at it and enable the two extensions in its dashboard. Skip `db:setup` if the provider has already created your role and database.

### App

```bash
cp .env.example .env              # then set JWT_SECRET, ESCROW_PAIR_SALT, CRON_SECRET
npm install
npm run build -w @thirtydates/shared
set -a; . ./.env; set +a
npm run db:setup                  # creates the app role, database and extensions (idempotent)
npm run db:migrate
npm run dev:api                   # :4000
npm run dev:worker                # scheduled jobs
npm run dev:web                   # :3000 (proxies /api to the API)
```

With `SMTP_URL` empty (development only), magic-link emails aren't sent. The sign-in link is printed in the API log instead, so you can open it straight from the terminal. For real email, set `SMTP_URL` to any SMTP provider.

**Demo data.** Run `npm run seed:demo -w @thirtydates/api -- you@example.com`. It creates 30 members around central London, three partner venues and an onboarded account for your email. It also deals this week's batch, and three of your cards have already stamped you. To see a particular phase, set `CLOCK_OVERRIDE=2026-10-21T10:00:00Z` (any ISO instant) for the API and seed. It is refused outside `NODE_ENV=development`.

**Reference data**
- `npm run import:postal-codes -w @thirtydates/api -- allCountries.txt`: GeoNames postal export, used when a member shares no location.
- `npm run import:venues -w @thirtydates/api -- venues.json`: curated partner venues.

**Tests.** They run against a real database:

```bash
TEST_ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
```

The harness recreates `thirtydates_test` and runs as the non-superuser `thirtydates_app` role, so row-level security is really enforced.

## Weekly state machine (UTC)

| When | What happens |
|---|---|
| Mon 07:00 | `monday-deal`: three-stage matcher deals up to 6 symmetric cards |
| Mon 07:00 – Sat 24:00 | Up to 3 resonance stamps (long-press a card line), passes, one Freeze |
| Wed 00:00 | Scenario exchange unlocks for mutually stamped pairs |
| Sun 06:00 | `sunday-reveal`: unblur mutual pairs, carry frozen stakes, wipe the rest |
| Sun 18:00 – 24:00 | #1 Signal; aligned signals create the match and chat thread |
| Mon 00:00 | `signal-close`: unreciprocated signals deleted |
| every 5 min | `bridge-maintenance`: raincheck expiry, completed meetings, 7-day bridge timeout |
| daily 00:05 | `aged-out-sweep`: deactivate members who turned 56 |

The worker runs these on cron and catches up on start-up. Every job is idempotent, and each can also be triggered with `POST /api/cron/:job` and the header `x-cron-secret`. Phase 2's `POST /api/escrow/reveal` is the same reveal job.

## Matching engine (`apps/api/src/matching`)

1. **Stage 1, SQL hard filter.** Applies platform age bounds, the bilateral window `[max(30, age−7), min(55, age+7)]`, mutual orientation, and a bilateral radius check with `ST_DWithin` (each member's own radius must cover the other). It also enforces the life-architecture compatibility matrix (`gate_compatibility`) and never-repeat history across `weekly_batches`, `escrow_vault`, `matches` and blocks.
2. **Stage 2, pgvector.** Scores each pair as `1 − (a <=> b)` over the 32-d vectors and keeps a pair when it is in either side's top K.
3. **Stage 3, capacitated Gale–Shapley** (`galeShapley.ts`). Cards must be symmetric for escrow to ever be mutual, so this is stable b-matching on a general graph:
   - Deferred acceptance runs first.
   - A stabilisation pass then removes any remaining blocking pairs. It is guaranteed to finish because both sides rank by the same score.
   - A coverage-augmentation pass fills members left short of 6. It gives up strict stability only where someone would otherwise get fewer cards.
   - Thin pools still yield fewer than 6 cards rather than breaking a hard filter. The shortfall is logged in `batch_runs`.

The 32-d psychometric vector is built deterministically from onboarding answers (`packages/shared/src/vector.ts`): 12 one-hot gate dimensions plus 20 lifestyle trait axes projected from the interest catalog. No model is involved.

## Blind escrow guarantees

- `pair_hash = HMAC-SHA256(min(uuid) ‖ max(uuid), ESCROW_PAIR_SALT)`.
- `escrow_vault` and `sunday_signals` use `FORCE ROW LEVEL SECURITY`. In a user transaction, a member can read a stake only after acting on it themselves, so an unreciprocated validation is invisible to its target. The `escrow_my_stakes` view projects only the caller's own side.
- A pass never changes the validator's view mid-week. Wiping happens only at the Sunday reveal, which closes the side channel. Wiped rows are scrubbed of both user ids, actions, stamps and timestamps; a database constraint enforces this.
- Validation responses are identical whatever the counterpart did.
- **Freeze carry is one-sided.** Only the freezer sees the card again. The counterpart's sealed stake moves to next week instead of being wiped, so the frozen person never learns they were frozen.
- **One Freeze Token per UTC week** covers both uses (carrying a card, or a raincheck).

## Decisions taken where the specs were silent

- **Gate values.** `living_architecture` gains `flexible`. `mobility` is `rooted / open_to_relocate / location_independent`. `financial_rhythm` is `steady_saver / balanced / experience_first`. Compatibility is a seeded, editable table.
- **"21:00 local"** for audio lounges is computed in the match's time zone, which is the lower UUID's zone (both members live within each other's radius). All storage and state machines stay in UTC.
- **Venue choice.** The bridge locks the earliest common slot. Venues are ranked by suitable type (wine bar from 17:00), then distance to the midpoint, then curation score, within 3 km.
- **Bridge preferences stay private.** If two members never align, the match expires after 7 days.
- **Raincheck timing.** The meeting moves to the same local time 2 or 3 days later (48–72 h; audio lounges prefer a weekday), with DST tolerated.
- **Photo privacy.** Photos are stored privately, checked by their file signature (magic bytes), and served only to the owner, a revealed mutual pair, or a match.

## Not built yet

- **Audio lounge transport.** The lounge is scheduled and shown, but there is no in-app audio call yet. That needs a WebRTC/TURN provider decision.
- **Notifications.** There are no push or email notifications for reveal, signal or bridge events (silent by design today).
- **Safety and admin tooling.** There is no moderation, reporting queue or admin tooling beyond member blocking.
