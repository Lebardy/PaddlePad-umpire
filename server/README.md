# PaddlePad Umpire — API server

Express + Postgres API backing the umpire app. Handles umpire accounts
and (from phase 2 on) the shared player registry and match sync.

## Why this exists

Each umpire uses their own device. Browser storage is per-device, so
without a server two umpires build two disjoint datasets that can never
merge — and, worse, each device mints its own id the first time a
player's name is typed. The same person then appears in the exported
data as several different players, each with a fraction of their real
match history.

That matters because the ML pipeline (`~/skul/PaddlePad`) groups by
`player_id` and derives its consistency features (`*_std`) from the
spread across a player's matches. Fragmented identities don't fail
loudly — the numbers just quietly get worse. The shared `players`
table with a case-insensitive unique name is the guard against that.

## Local development

You need a Postgres running locally.

```bash
cd server
cp .env.example .env          # then edit it (see below)
pnpm install
pnpm dev
```

`.env` needs two things:

- `DATABASE_URL` — your local Postgres connection string.
- `JWT_SECRET` — a random string, 32+ characters. Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

`.env` is gitignored and must stay that way. Anyone holding
`JWT_SECRET` can forge a login as any umpire.

The schema in `schema.sql` is applied automatically on every boot.
Every statement is idempotent, so there's no separate migration step.

## Testing

```bash
cd server
pnpm test:e2e
```

That is the whole loop. It starts a throwaway Postgres in Docker,
resets it, boots the API against it on its own port, runs the smoke
test, and shuts the API down again. Nothing it touches is real: the
database is local-only, empty, and `pnpm test:db:down` takes it with
it.

It needs the Docker daemon running (`sudo systemctl start docker`).
The container is deliberately left up between runs, so the second run
is a couple of seconds rather than ten.

`scripts/smoke.mjs` holds the assertions, and it is worth reading
rather than just running — each one is a claim the sync design makes
about itself:

1. pushing the same log twice changes nothing (retry safety)
2. pushing a shorter log removes the extra events (undo)
3. status and winner are derived, never believed (trust)
4. ending early survives a re-sync (`ended_early`)
5. one code, one match, cannot be double-claimed (concurrency)
6. a game to 15 is not declared won at 11 (`point_target`)

You can also point it at a deployed API directly:

```bash
SMOKE_INVITE=<code> node scripts/smoke.mjs https://paddlepad-api.up.railway.app
```

Do that sparingly. It writes real rows into whatever it talks to, and
recovering from that means trusting `scripts/cleanup-test-data.mjs` to
find every one of them again.

### What this does not catch

Everything about the deploy itself. Root directory, service variables,
`CORS_ORIGIN`, and differences between the local and Railway builds are
all invisible from here — and that has been this project's most
expensive class of bug, not logic errors. Twice the API service
deployed the React app because its root directory was wrong, and the
tests were green throughout.

So a green run is a necessary check before deploying, not a sufficient
one. Verify the deploy separately: hit `/health`, and confirm the code
you expect is actually in the served bundle.

## Deploying to Railway

1. **Add a Postgres service** to your Railway project. Railway sets
   `DATABASE_URL` on your services automatically — don't set it by hand.

2. **Add a service for this directory.** Point it at this repo and set
   the service's **root directory** to `server`, so Railway builds the
   API rather than the React app. It runs `pnpm start`.

3. **Set these variables** on the API service:

   | Variable | Value |
   |---|---|
   | `JWT_SECRET` | A fresh random 48-byte hex string — **not** the one from your local `.env` |
   | `CORS_ORIGIN` | Comma-separated list of every app origin, e.g. `https://paddlepad-umpire.up.railway.app,https://paddlepad.up.railway.app` |
   | `INTERNAL_API_KEY` | A fresh random 48-byte hex string, shared only with the `ml` service in the **same** environment. Different per environment. |

   `PORT` is provided by Railway; the server reads it automatically.

4. **Point the app at the API.** When building the React app, set
   `VITE_API_URL` to the API service's public URL. Vite inlines this at
   build time, so the app must be rebuilt after changing it.

`GET /health` returns `{"ok":true}` only when the database is actually
reachable, so it's suitable as Railway's health check path.

### The staging environment

The Railway project has two environments. `production` is what the club
uses; `staging` is an identical copy to deploy to first.

| | production | staging |
|---|---|---|
| api | `paddlepad-api.up.railway.app` | `api-staging-8ac6.up.railway.app` |
| web (umpire) | `paddlepad-umpire.up.railway.app` | `web-staging-e8e9.up.railway.app` |
| play (player) | `paddlepad.up.railway.app` | `play-staging-7f59.up.railway.app` |
| ml (pipeline) | not deployed yet | `ml-staging-12f5.up.railway.app` |

```bash
railway up --service api  --environment staging
railway up --service web  --environment staging
railway up --service play --environment staging
```

Then run the smoke test against it, which is safe here in a way it is
not against production — staging's data is disposable:

```bash
SMOKE_INVITE=<staging bootstrap code> \
  node scripts/smoke.mjs https://api-staging-8ac6.up.railway.app
```

The staging services are set to sleep when idle, so the first request
after a quiet spell takes a few seconds to wake.

**The separation is the whole point, and it is not automatic.**
Duplicating an environment copies the variables verbatim, which means a
fresh staging environment starts out pointing at production: its
`CORS_ORIGIN` and `VITE_API_URL` name the production domains, and its
`JWT_SECRET` is production's — so a token minted on staging would be
accepted by production. All four were overridden by hand when staging
was created.

If you ever recreate it, verify these before trusting it:

- staging `JWT_SECRET` differs from production's, and a token signed
  with it is **rejected** by the production API;
- staging `DATABASE_URL` resolves to staging's own Postgres (the
  internal hostname is identical in both environments — compare the
  credentials, not the host);
- `CORS_ORIGIN` and both `VITE_*` variables name staging domains;
- the built bundle contains no production URL:
  ```bash
  curl -s https://web-staging-e8e9.up.railway.app/assets/index-*.js \
    | grep -oE 'https://[a-z0-9.-]*railway\.app' | sort -u
  ```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Liveness + database reachability |
| `POST` | `/auth/register` | — | Create an umpire account |
| `POST` | `/auth/login` | — | Sign in, returns a token |
| `GET` | `/auth/me` | Bearer | Validate a stored token on app launch |
| `GET` | `/export/match-logs.csv` | Bearer (umpire) | The club-wide ML export |
| `GET` | `/player/me` | Bearer (player) | A player's own summary, plus their rating or its gate state |
| `GET` | `/internal/match-logs.json` | `x-internal-key` | Same rows as the export, for the ML service |
| `POST` | `/internal/ratings` | `x-internal-key` | Records one pipeline run as a snapshot |

Tokens are JWTs valid for 30 days, sent as `Authorization: Bearer <token>`.

### The `/internal` routes

These are for the ML service (`ml/`) and nothing else. They use a shared
key in `x-internal-key`, not a bearer token, and the two systems do not
overlap in either direction: an umpire token is refused on `/internal`,
and the key is accepted nowhere else. When `INTERNAL_API_KEY` is unset
the routes refuse everything, so a missing value is a locked door rather
than an open one.

A service umpire account was the obvious alternative and was rejected:
that would be a real login with a real password hash, able to sign in to
the umpire app and score matches. The ML service needs to read match
logs and write a ratings snapshot. A header key grants exactly that.

Ratings are stored as immutable **snapshots** (`rating_runs` +
`player_ratings`), never as a column on `players`. The score is entirely
pool-relative, so it moves when *other* people play; without the date
and pool size stored alongside it, that movement would be unexplainable
after the fact. See the comment above those tables in `schema.sql`.

## Security notes

- Passwords are hashed with **scrypt** (Node's built-in `crypto`), each
  with a unique random salt, and compared in constant time. No native
  build dependency, and no plaintext password is ever stored.
- Login returns the same error whether the email is unknown or the
  password is wrong, and spends comparable time in both cases, so the
  endpoint can't be used to discover which emails are registered.
- **Registration is currently open.** Anyone who can reach the API can
  create an umpire account. That's acceptable while this is used by one
  trusted group, but it needs an invite or approval flow before the API
  is exposed publicly.
- Authentication identifies the umpire but does **not** restrict which
  umpire may edit which match. That's deliberate: umpires hand courts
  over mid-session, and locking a match to its creator would block the
  normal case. Attribution is recorded (`matches.recorded_by`) so any
  entry can still be traced to whoever logged it.
