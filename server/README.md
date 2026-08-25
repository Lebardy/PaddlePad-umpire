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

   `PORT` is provided by Railway; the server reads it automatically.

4. **Point the app at the API.** When building the React app, set
   `VITE_API_URL` to the API service's public URL. Vite inlines this at
   build time, so the app must be rebuilt after changing it.

`GET /health` returns `{"ok":true}` only when the database is actually
reachable, so it's suitable as Railway's health check path.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | — | Liveness + database reachability |
| `POST` | `/auth/register` | — | Create an umpire account |
| `POST` | `/auth/login` | — | Sign in, returns a token |
| `GET` | `/auth/me` | Bearer | Validate a stored token on app launch |

Tokens are JWTs valid for 30 days, sent as `Authorization: Bearer <token>`.

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
