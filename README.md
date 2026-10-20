# Thirty Dates

A zero-burnout, non-rotating, character-first relationship platform for adults aged 30–55. The week follows four stages:

1. **Invisible structural filtering.** Age bounds, mutual orientation, radius and life-architecture gates are applied silently before the deal. Members never see gate badges.
2. **Monday: blind whole-card selection.** Six faceless, nameless cards (Life Rhythm, behavioral interests, the Flaw + Upside coin). Up to three whole profiles go into simultaneous blind escrow, plus one optional Freeze Token.
3. **Mid-week: asynchronous voice Q&A.** Mutual selections unlock a voice exchange. Each drops 2–3 questions from a 90-question bank in three vectors (daily rhythm, after Murstein's SVR model; inner world, after the Pratfall Effect; joy & curiosity, after Aron's closeness paradigm); a 36-hour Response Clock governs the answers. Drafts stay on the device, and both vaults stay double-blind until both lock.
4. **The modality switch.** The instant both lock, first names and photos unblur together, both voice notes become playable, and the First-Meet Bridge opens: a 45-minute coffee or wine audit at a curated venue near the midpoint, within 72 hours.

There are no swipes, feeds or "likes you" queues, and no generative AI anywhere in the discovery path.

```
packages/shared   Domain constants, deterministic vector builder, week clock, tz helpers, API contracts
apps/api          Fastify API, Monday matcher, escrow state machine, UTC cron worker
apps/web          Next.js (App Router) + Tailwind client
db/migrations     PostgreSQL + PostGIS + pgvector schema
```

## Running locally

You need Node 20+ and PostgreSQL 15+ with the PostGIS and pgvector extensions. No Docker.

**Deploying to a server?** [docs/deploy-debian-lxc.md](docs/deploy-debian-lxc.md) goes step by step from a bare Debian LXC container to the app running under systemd, either on your LAN or behind HTTPS.

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

**Testing alone.** With `NODE_ENV=development`, sign up, finish your profile and open **Test tools** in the menu. It seeds members built to match you, deals, has cards select you, moves the clock through the week, and plays the other side of each voice exchange. `npm run seed:demo -w @thirtydates/api -- you@example.com` does the seeding from the command line. None of this exists when `NODE_ENV=production`.

**Voice recording needs HTTPS** (or `localhost`): browsers block the microphone on plain-http pages. See the deployment guide for a LAN setup with Caddy.

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
| Mon 07:00 | `monday-deal`: the three-stage matcher deals up to 6 symmetric cards |
| Mon 07:00 – Wed 00:00 | Blind selection: up to 3 whole profiles, passes, one Freeze (`late-deal` tops up late joiners hourly) |
| Wed 00:00 | Selection seals: frozen undecided stakes carry to next week, the rest are wiped; each mutual pair gets a voice exchange |
| Wed | Each member drops 2–3 questions for the other (anyone who doesn't gets two assigned) |
| Thu 00:00 – Fri 12:00 | 36-hour Response Clock: record locally, lock once; release happens the instant both lock |
| Fri 12:00 | Exchanges without both locks close silently; their audio is deleted |
| Release + 72 h | First-Meet Bridge window: shared coffee or wine slot locks automatically; otherwise the match closes kindly |

`exchange-tick` runs every minute and performs the Wednesday, Thursday and Friday transitions; each step is idempotent and catches up after downtime. Any job can also be triggered with `POST /api/cron/:job` and the header `x-cron-secret`.

## Matching engine (`apps/api/src/matching`)

1. **Stage 1, SQL hard filter.** Applies platform age bounds, the bilateral window `[max(30, age−7), min(55, age+7)]`, mutual orientation, and a bilateral radius check with `ST_DWithin` (each member's own radius must cover the other). It also enforces the life-architecture compatibility matrix (`gate_compatibility`) and never-repeat history across `weekly_batches`, `escrow_vault`, `matches` and blocks.
2. **Stage 2, pgvector.** Scores each pair as `1 − (a <=> b)` over the 32-d vectors and keeps a pair when it is in either side's top K.
3. **Stage 3, capacitated Gale–Shapley** (`galeShapley.ts`). Cards must be symmetric for escrow to ever be mutual, so this is stable b-matching on a general graph:
   - Deferred acceptance runs first.
   - A stabilisation pass then removes any remaining blocking pairs. It is guaranteed to finish because both sides rank by the same score.
   - A coverage-augmentation pass fills members left short of 6. It gives up strict stability only where someone would otherwise get fewer cards.
   - Thin pools still yield fewer than 6 cards rather than breaking a hard filter. The shortfall is logged in `batch_runs`.

The 32-d psychometric vector is built deterministically from onboarding answers (`packages/shared/src/vector.ts`): 12 one-hot gate dimensions plus 20 lifestyle trait axes projected from the interest catalog. No model is involved.

## Blind escrow and double-blind voice guarantees

- `pair_hash = HMAC-SHA256(min(uuid) ‖ max(uuid), ESCROW_PAIR_SALT)`.
- `escrow_vault` uses `FORCE ROW LEVEL SECURITY`. In a user transaction, a member can read a stake only after acting on it themselves, so an unreciprocated selection is invisible to its target. The `escrow_my_stakes` view projects only the caller's own side.
- **No pass, no rejection.** There is no pass or swipe-left: a member only ever chooses, and anyone not chosen simply lapses (passing trains a rejection mindset; see Pronk & Denissen, 2020). Unreciprocated choices are wiped when selection seals on Wednesday, and wiped rows are scrubbed of both user ids, actions and timestamps (a database constraint enforces this).
- **Selection is a whole-profile choice.** There are no stamps and no line tags.
- **Freeze carry is one-sided.** Only the freezer sees the card again; the counterpart's sealed stake moves to next week, so they never learn they were frozen.
- **Double-blind voice exchange:**
  - Drafts live in the browser (IndexedDB) and upload only on lock, which is final.
  - Neither member can see whether the other has locked.
  - Audio, names and photos are released in the same transaction as the second lock.
  - Expired exchanges delete their recordings.
- **Audio and photos are checked by magic bytes** and served only to the people allowed to hear or see them.

## Decisions taken where the specs were silent

- **Life Rhythm** is derived deterministically from a member's interests (the three strongest lifestyle traits in plain language), never from the structural gates.
- **Voice timing.** Questions are open all Wednesday; the 36-hour Response Clock runs Thursday 00:00 to Friday 12:00 UTC for every pair, so the week stays synchronised.
- **Recording limits.** Each answer is capped at 90 seconds. Re-takes are unlimited, and there are no editing tools.
- **Venue choice.** A venue is auto-assigned at release (within 3 km of the midpoint). When the meeting locks, a wine bar is preferred for slots from 17:00 if one is near.
- **Raincheck.** One Freeze Token per UTC week covers both card carries and rainchecks; a raincheck moves the meeting to the same local time 48 hours later, and the partner has 24 hours to accept.

## Not built yet

- **Psychometric questionnaire.** The 32-d vector is built from life-architecture answers and interests; dedicated psychometric questions (conflict repair, attachment, etc.) still need a validated question set.
- **Notifications.** There are no push or email notifications for exchange or bridge events.
- **Safety and admin tooling.** There is no moderation, reporting queue or admin tooling beyond member blocking.
