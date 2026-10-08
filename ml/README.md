# The ML service

Turns PaddlePad's match logs into a skill score and a playstyle
archetype for each player, and publishes them back to the API as a
dated snapshot.

## What runs where

```
umpire app ──► api (Node) ──► ml (this) ──► api ──► player app
   taps         match logs     score +        snapshot    rating
                               archetype
```

This service never touches the database. It asks the API for rows and
posts results back, through `/internal/*` with a shared key.

That is not caution about credentials -- it is where the data lives. The
per-player shot counts the pipeline consumes (`drop_successes`,
`dink_winners`, ...) are not columns anywhere. They are derived by
replaying the append-only tap log through `deriveMatchState` in
`server/src/pickleball.js`. Reading Postgres directly would mean
reimplementing side-out pickleball scoring in Python, and a second
scoring engine is the last thing this project needs.

## Files

- `pipeline/` — the ML pipeline, **vendored** from its own repo. Do not
  edit these. Edit them there and run `./sync-pipeline.sh`.
- `run.py` — one run: fetch, gate, cluster, publish.
- `service.py` — `GET /health` and `POST /run`.
- `test_run.py` — offline checks on the driver, no API needed.

## Why it runs on a schedule

There is no `predict()` in the pipeline, only `fit_predict`. K-Means
learns where the clusters sit by looking at every player at once,
assigns each to the nearest, and keeps nothing -- there is no saved
model for a new player to be measured against.

And the skill score does not come from K-Means at all. It comes from
`min_max_normalize`, which places each player between the weakest and
strongest player *currently present*. It moves when other people play,
model or no model.

So an endpoint that scored one player on demand would secretly re-run
the whole clustering on every page load, and would give slightly
different answers each time as `n_init=20` re-seeds. The work happens in
batches; the app reads the last published snapshot.

**When to save a model instead:** once the population stops changing
shape. At a few hundred regular players the clusters are real rather
than noise, and that is the point to freeze the K-Means model, both
`StandardScaler`s, and the min/max bounds together as one versioned
artifact. Freezing only the model would not help — the score would still
move.

## The gate

A run refuses to publish unless the data can support it. The thresholds
come from the API (`/internal/match-logs.json` returns them) so there is
one definition rather than a copy here that drifts.

| Rule | Why |
|---|---|
| A player needs **5+ matches** | At one match there is no spread in any per-match rate, so all seven consistency features are `NaN` filled with `0.0` — which the skill model reads as *flawless consistency* and rewards. Such a player outranks genuine regulars. |
| The pool needs **3+ players** | `test_skill_k_values` raises below three. Hard limit, not a preference. |
| The pool wants **~40 players** | The clustering is two-level and skips any skill group with fewer than three members. Below roughly forty, the archetype half stops being produced. |

Players under the floor are left out of the run, not rated badly. A run
that the gate stops is still recorded, as a `failed` row with the
reason — otherwise "the gate held" and "the service never woke up" look
identical afterwards.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python test_run.py          # offline checks, no API

export PADDLEPAD_API_URL=https://api-staging-xxxx.up.railway.app
export INTERNAL_API_KEY=...           # same value as on the api service
.venv/bin/python run.py --dry-run     # computes, publishes nothing
.venv/bin/python run.py               # publishes a snapshot
```

Always `--dry-run` first against an environment you care about.

## Deploying

A fourth Railway service per environment, root directory `/ml`, with:

**Set the root directory before the first deploy.** There is no CLI flag
for it -- it is a service setting in the Railway dashboard, under
Settings -> Source -> Root Directory. `railway up` uploads the git root
regardless of which directory you run it from, so a service left at the
default `/` builds the repo root: this service's first deploy served the
React umpire app on `ml-staging-12f5.up.railway.app` and reported
success while doing it. A green deploy is not evidence the right thing
was built; check what the URL actually serves.


- `PADDLEPAD_API_URL` — the api service's URL for the same environment.
  **Check this points at the matching environment.** Staging computing
  against production data and publishing to staging would look entirely
  normal in the logs.
- `INTERNAL_API_KEY` — the same value as the api service in that
  environment, and a different value between environments.

### The nightly run

It runs at 19:00 UTC — 3am Manila — in production only:

| | production | staging |
|---|---|---|
| Nightly run | `ml-cron` service (Railway cron) | none; `POST /run` by hand |
| `sleepApplication` on `ml` | on | on |

Railway cron services are expected to start, run and **exit**, and `ml`
is a gunicorn process that never does, so a `cronSchedule` set on it
would look configured and quietly never fire. That is why the cron is a
second service.

`ml` itself sleeps when idle; a request to `/health` or `POST /run`
wakes it. Staging snapshots are only as fresh as the last manual run.

The schedule used to run from a thread inside `ml`, built while the free
plan capped the project at five services. It kept a container holding
about 160 MB awake all month and was the largest line on the bill, so it
was switched off on 2026-10-08 and removed the day after (`git log --
ml/scheduler.py` has it). The `PADDLEPAD_SCHEDULE` variable it read does
nothing now and can be deleted from both `ml` services.

### Giving an environment its cron service

Done for production on the Hobby plan:

- Create an `ml-cron` service from this same directory:

   ```bash
   railway add --service ml-cron     # NOT --variables, see below
   railway variables --service ml-cron --set "PADDLEPAD_API_URL=..." \
                                      --set "INTERNAL_API_KEY=..."
   ```

   Then set `rootDirectory: "ml"`, `startCommand: "python run.py"` and
   `cronSchedule: "0 19 * * *"` on its service instance through the
   GraphQL API (`railway api`) — `rootDirectory` has no CLI flag, and
   setting it in the dashboard did not save when it was tried here.
   Leave `healthcheckPath` unset; a process that exits has nothing to
   health-check.

   Setting the root directory in the dashboard failed to save again for
   production's `ml-cron`, and its first deploy built the umpire app.
   What worked, and can be read back to check:

   ```bash
   railway api 'mutation($s:String!,$e:String){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:{rootDirectory:"ml"})}' \
     --var s=<service id> --var e=<environment id>
   railway api 'query($s:String!,$e:String!){serviceInstance(serviceId:$s,environmentId:$e){rootDirectory startCommand cronSchedule nextCronRunAt}}' \
     --var s=<service id> --var e=<environment id>
   ```

   The variables can be references rather than copies, so no key is
   typed: `INTERNAL_API_KEY=${{ml.INTERNAL_API_KEY}}` and
   `PADDLEPAD_API_URL=${{ml.PADDLEPAD_API_URL}}`.

**Adding a service to production with the dashboard's Sync copies
staging's variables along with it.** Production's `ml` arrived pointing
at the staging API with the staging key. Check both before the first
deploy.

**Never pass `--variables` to `railway add`.** That command echoes each
prompt back *including the value*. It is how the staging
`INTERNAL_API_KEY` ended up in a terminal transcript and had to be
rotated. `railway variables --set` prints only the name.

## Known limitations

Recorded rather than fixed, and both belong in the pipeline's own repo:

- **`assign_skill_tier` uses absolute cutoffs on a relative score.**
  Under 40 Beginner, under 75 Intermediate, 75+ Professional — applied
  to a score that only says where you sit in the current pool. In a pool
  of twelve the best player scores 100 and is labelled Professional
  regardless of how they play. The tier is stored but deliberately never
  shown to a player.
- **Mixed point targets read as inconsistency.** Most features are
  per-match rates, so a player whose games mix 11 and 21 shows more
  spread and is marked down for it, though nothing about their play
  changed. Each run records the format mix in its notes; `run.py` has a
  one-line switch to filter to one target, off by default because right
  now it would discard most of the data.
