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

and, for player accounts: a claim code cannot take over an account that
already exists, the right code links a new account to the matches an
umpire already recorded, and the code still works afterwards as the
recovery path.

You can also point it at a deployed API directly:

```bash
SMOKE_INVITE=<code> node scripts/smoke.mjs https://paddlepad-api.up.railway.app
```

Do that sparingly. It writes real rows into whatever it talks to, and
recovering from that means trusting `scripts/cleanup-test-data.mjs` to
find every one of them again.

That script deletes strictly by **ownership** — `sessions.created_by`,
`players.created_by`, `matches.recorded_by` — which is what makes it
structurally unable to reach a real umpire's records whatever they are
named. A self-registered player has no owner by definition, so the smoke
run prints the ids it created and the exact command to remove them:

```bash
node scripts/cleanup-test-data.mjs 'smoke.%@example.com' <player-ids>
```

Those are deleted by id, never by name, and any id with even one
recorded match is refused.

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
| `POST` | `/auth/register` | — | Create an umpire account (needs an invite) |
| `POST` | `/auth/login` | — | Sign in as an umpire, returns a token |
| `GET` | `/auth/me` | Bearer | Validate a stored token on app launch |
| `POST` | `/auth/player/claim` | — | Exchange an umpire-issued code for a player session |
| `POST` | `/auth/player/register` | — | Sign up as a player |
| `POST` | `/auth/player/login` | — | Sign in as a player, username + password |
| `POST` | `/auth/player/credentials` | Bearer (player) | Set up sign-in, or change the username or password |
| `GET` | `/export/match-logs.csv` | Bearer (umpire) | The club-wide ML export |
| `GET` | `/player/me` | Bearer (player) | A player's own summary, plus their rating or its gate state |
| `PATCH` | `/player/me` | Bearer (player) | Rename yourself |
| `DELETE` | `/player/me` | Bearer (player) | Delete your profile — see below |
| `GET` | `/internal/match-logs.json` | `x-internal-key` | Same rows as the export, for the ML service |
| `POST` | `/internal/ratings` | `x-internal-key` | Records one pipeline run as a snapshot |

Tokens are JWTs valid for 30 days, sent as `Authorization: Bearer <token>`.

### The two ways a player gets in

Both exist on purpose, and neither replaces the other.

**The claim code** is the fast one. An umpire hands over a code or a QR
and the player is looking at their stats seconds later, with nothing to
fill in. That speed is the point: the data is a person's own pickleball
stats, and a signup form at the moment someone is handed a QR courtside
is exactly the friction that leaves records unclaimed and this app
pointless.

**A username and password** is the durable one. It survives a lost code,
a new phone and a cleared browser, and it can be set up afterwards from
the profile screen by someone who arrived by code — which is the order
that actually works.

The code proves who you are; the password keeps you in.

#### Why a username and not an email

Nothing in this app has anything to send. With no verification link and
no reset mail, an email address would be a username in disguise: never
checked, never used, and inviting the fair question of why it was
collected at all. A username is the honest version of the same field,
and it means no personal contact data is held for players. Adding email
later is one nullable column, not a redesign.

#### Registering under a name already on the roster

Players live in one table keyed by a case-insensitive unique name,
because the ML pipeline aggregates by `player_id` and the same human has
to resolve to the same row whichever umpire logged the match. So a name
that already exists is never simply handed over — otherwise registering
as "Maria Santos" would inherit the real Maria's history and her rating.

| Situation | Result |
|---|---|
| Name is new | Created, starts empty |
| Name exists, umpire-created, no account | Needs the claim code; the right one links the account to that row and all its history |
| Name exists and already has an account | Refused outright |

The middle row answers with `needsCode: true` so the app can reveal the
code field rather than showing a dead end.

#### Recovery

There is no password reset, because there is no email to send one to.
**The claim code deliberately keeps working after a password is set**, so
an umpire regenerating it is how a locked-out player gets back in. That
is a decision, not an oversight — it is written into the schema comment
and pinned by a test. Unlike a reset email it has a trusted human in the
loop.

### Editing your own profile

A player owns three things and can change all of them from the You tab.

**Their name.** Allowed, and worth saying why, because an earlier
version of this code refused it. The identity guard this app is built
around is about one human ending up with *two* player rows — matches
point at `players.id`, so renaming a single row moves no data and splits
no history. What renaming genuinely costs is that the umpire's roster
label changes under them, and the umpire is the person who has to find
you at the net. So the form says so in plain words, and the rule itself
(trim, non-empty, at most 80 characters, unique case-insensitively) is
the same one `POST /players` uses — one validator in `src/validate.js`,
not two that agree today.

**Their username and password.** Either can be changed without the
other, but once an account exists both require the current password.
Gating a *username* change that way is deliberate: changing the username
someone signs in with locks them out exactly as effectively as changing
the password, and a phone left unlocked on the profile screen would
otherwise be a silent takeover.

### What deleting your profile does

Two outcomes, and which one happens is not a preference:

| Situation | Result |
|---|---|
| Never appeared in a match | The record is really deleted. Nothing points at it |
| Has appeared in a match | The **account** is destroyed; the record stays |

The second case is the honest answer rather than a soft one. A player's
matches are not solely theirs: their name appears in every partner's and
opponent's history — `player-stats.js` resolves each id on court to a
name from the `players` table — `matches.first_server_player` is a
foreign key with no `ON DELETE`, and `team_a`/`team_b` are bare `UUID[]`
with no foreign key at all. Deleting the row would either be refused by
Postgres or leave dangling ids in other people's match records.

So the account is destroyed properly: `username`, `password_hash`,
`claim_code`, `claimed_at` and `registered_at` are all cleared, and
`deactivated_at` is stamped. Freeing the username for someone else to
take is intended. The screen states which of the two will happen
*before* asking for confirmation, and reports whichever the server
actually did rather than guessing.

Because player tokens last 30 days and are stateless, `requireActivePlayer`
re-reads the row on every player request — otherwise "you won't be able
to get back in" would be false for a month for the person who just read
it. Same reasoning as `requireAdmin` reading `is_admin` from the
database rather than the token.

**Coming back** works the same way a forgotten password does: an umpire
mints a fresh claim code (the old one was wiped), and claiming it clears
`deactivated_at`. The trusted human in the loop is the whole mechanism.

The ML pipeline is unaffected either way — it aggregates by `player_id`
over `matches`, and none of this touches a match.

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
- **Umpire registration is invite-only.** The API is on the public
  internet, so an open form would let anyone create an account and write
  into the match data. Only admins can issue invites, and codes are
  single-use, claimed in the same transaction that creates the umpire.
- **Player sign-in returns one message** whether the username is unknown
  or the password is wrong, and spends comparable time on both, so it
  cannot be used to discover which usernames exist. Registration
  necessarily reveals that a username is taken — unavoidable if
  usernames are unique — but nothing else.
- **Rate limits key on the first `X-Forwarded-For` entry, not `req.ip`,
  and that is deliberate.** `req.ip` is the principled choice on paper;
  it was tried and it silently disabled the limiter in production.
  Railway's edge does not present as a single hop, so with
  `trust proxy: 1` Express resolved `req.ip` to a rotating pool of
  Railway's own addresses rather than the caller — every request got a
  fresh bucket and nothing was limited. Railway **overwrites**
  `X-Forwarded-For` rather than appending, so its first entry is the
  true client and a caller cannot inject a value that survives.
  That is a fact about this deployment, not about proxies in general:
  behind a proxy that appends, the first entry is attacker-controlled
  and this becomes a free bypass. **If the API ever moves off Railway or
  is exposed without a proxy, revisit that line first.**
- **Each limiter gets its own bucket**, keyed on `req.baseUrl`. Using
  `req.path` shared one bucket across every endpoint, because Express
  strips the mount path inside `app.use(path, mw)` — spending the ten
  attempts on `/auth/login` left `/auth/register` returning 429 on its
  first call.
- `DANGEROUSLY_DISABLE_RATE_LIMITS=1` turns every limit off, for tests
  against a disposable database only. The API prints a loud warning at
  boot whenever it is set, so it cannot be on quietly.
- Authentication identifies the umpire but does **not** restrict which
  umpire may edit which match. That's deliberate: umpires hand courts
  over mid-session, and locking a match to its creator would block the
  normal case. Attribution is recorded (`matches.recorded_by`) so any
  entry can still be traced to whoever logged it.
