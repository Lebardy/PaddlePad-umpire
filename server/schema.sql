-- ============================================================
-- PaddlePad Umpire -- database schema
--
-- Applied automatically on server start (see db.js). Every
-- statement is written to be safe to re-run.
--
-- The central design constraint here is that the ML pipeline
-- aggregates by player_id and needs many matches per player to
-- compute its consistency (*_std) features. That is why players
-- live in ONE shared table keyed by a case-insensitive unique
-- name, rather than being minted per-device: the same human must
-- resolve to the same player_id no matter which umpire logged
-- the match, or their history silently splits into fragments.
-- ============================================================

CREATE TABLE IF NOT EXISTS umpires (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Emails are compared case-insensitively so "Alex@x.com" and
-- "alex@x.com" cannot become two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS umpires_email_lower_idx
    ON umpires (lower(email));

-- Only admins may issue invite codes. Ordinary umpires can score
-- matches but cannot bring new people in, so control over who gets an
-- account stays with the project owner rather than spreading to
-- everyone who has ever been given one.
--
-- The founding umpire (the one who registers with BOOTSTRAP_INVITE_CODE)
-- is made admin automatically; see routes/auth.js. Promoting anyone
-- else is a deliberate manual UPDATE -- there is intentionally no
-- endpoint for it.
ALTER TABLE umpires
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Registration is invite-only: the API is on the public internet, so
-- an open signup form would let anyone create an umpire account and
-- write into the match data.
--
-- Codes are single-use. `used_by` is claimed in the same transaction
-- that creates the umpire (see routes/auth.js), so two people
-- submitting the same code at once can't both get accounts.
CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    created_by UUID REFERENCES umpires (id) ON DELETE SET NULL,
    note       TEXT,
    expires_at TIMESTAMPTZ,
    used_by    UUID REFERENCES umpires (id) ON DELETE SET NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invites_unused_idx
    ON invites (code) WHERE used_by IS NULL;

CREATE TABLE IF NOT EXISTS players (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_by UUID REFERENCES umpires (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The guard against the identity-fragmentation problem above.
CREATE UNIQUE INDEX IF NOT EXISTS players_name_lower_idx
    ON players (lower(name));

-- Groundwork for letting a player claim their own record later (by QR
-- or by typing the code), inheriting the history an umpire already
-- logged for them. Nothing reads this yet.
--
-- It exists from the start so that feature is a small addition rather
-- than a schema migration plus a backfill across every historical row.
-- Codes are minted lazily on first read rather than backfilled, which
-- keeps this a one-line ALTER.
--
-- SECURITY: claim_code is a bearer secret -- anyone holding it can
-- claim that player. It must never be included in list responses; the
-- roster is the most screenshotted screen in the app. Only the
-- single-player claim-code endpoint may return it.
ALTER TABLE players ADD COLUMN IF NOT EXISTS claim_code TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS players_claim_code_idx
    ON players (claim_code) WHERE claim_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_by UUID REFERENCES umpires (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A session thrown out wholesale -- wrong night, duplicate, a practice
-- run someone recorded for real.
--
-- Voiding a session excludes every match in it from the export without
-- touching the matches themselves. That independence matters: it means
-- restoring a session brings back only the matches that were fine,
-- leaving any individually-voided ones still excluded. A cascade would
-- quietly un-void those too.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES umpires (id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE TABLE IF NOT EXISTS session_players (
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    player_id  UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS matches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    -- Attribution: which umpire scored this match. Kept so data can
    -- be traced back to a scorer, and so an inconsistent umpire can
    -- be identified rather than quietly skewing the dataset.
    recorded_by  UUID REFERENCES umpires (id) ON DELETE SET NULL,
    team_a       UUID[] NOT NULL,
    team_b       UUID[] NOT NULL,
    stacking_a   BOOLEAN NOT NULL DEFAULT false,
    stacking_b   BOOLEAN NOT NULL DEFAULT false,
    first_server_team    TEXT NOT NULL CHECK (first_server_team IN ('A', 'B')),
    first_server_player  UUID NOT NULL REFERENCES players (id),
    status       TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress', 'completed')),
    winner       TEXT CHECK (winner IN ('A', 'B')),
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS matches_session_idx ON matches (session_id);

-- Games are usually to 11, but 15 and 21 are both normal depending on
-- the format, so the target is recorded per match rather than assumed.
--
-- It must be stored, not inferred: the winner is re-derived from the
-- event log on every sync, and deriving a match played to 15 against a
-- target of 11 would declare the wrong team the winner partway through.
-- Existing rows default to 11, which is what they were actually scored
-- under.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS point_target INTEGER NOT NULL DEFAULT 11
    CONSTRAINT matches_point_target_valid CHECK (point_target IN (11, 15, 21));

-- A match that was stopped early (a retirement or forfeit) rather than
-- won on court. This is the ONE piece of match state that cannot be
-- re-derived from the event log, because ending early appends no event
-- -- it just stops play. Without storing it explicitly, every
-- manually-ended match would silently reopen as "in progress" the
-- moment a device re-synced its log.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_early BOOLEAN NOT NULL DEFAULT false;

-- A match the umpire has thrown out -- wrong pairing, wrong court,
-- started by mistake.
--
-- Voided rather than deleted, because a COMPLETED match is real
-- recorded activity that merely got attributed to the wrong people.
-- Keeping the row means the mistake stays auditable and reversible;
-- what matters is that the export skips it, since a mis-paired match is
-- worse than no match at all for the ML pipeline -- it silently credits
-- one player's rallies to another.
--
-- In-progress matches are hard-deleted instead: there is nothing worth
-- keeping in a match abandoned before it counted.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES umpires (id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Soft lease over who is currently scoring a match.
--
-- Two umpires scoring the same match do not produce complementary
-- halves to merge -- they produce two independent opinions of the same
-- rallies, and interleaving them yields a point sequence that matches
-- neither. So concurrent scoring is refused rather than merged, and
-- taking over is explicit and destructive: the taking-over device's log
-- wins whole.
--
-- The lease goes stale deliberately (see routes/matches.js). Court
-- handover mid-session is the normal case, and without an expiry a
-- pocketed or crashed phone would lock that court forever.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scoring_device TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scoring_claimed_at TIMESTAMPTZ;

-- Back the `player_id = ANY(team_a)` lookups behind the player search,
-- which reports each player's match count and last-played date so an
-- umpire can confirm they mean the same person before reusing a name.
CREATE INDEX IF NOT EXISTS matches_team_a_gin ON matches USING gin (team_a);
CREATE INDEX IF NOT EXISTS matches_team_b_gin ON matches USING gin (team_b);

-- Append-only tap log. Score, server rotation and per-player stats
-- are always derived from this by replaying it through
-- src/lib/pickleball.js -- never stored directly. That is what makes
-- undo correct, and what will make offline sync from several devices
-- mergeable without conflict resolution.
CREATE TABLE IF NOT EXISTS match_events (
    id         UUID PRIMARY KEY,
    match_id   UUID NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('rally', 'thirdShot')),
    payload    JSONB NOT NULL,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordering within a match must be unambiguous for replay, and this
-- doubles as the idempotency guard for sync retries: re-sending the
-- same event position twice cannot duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS match_events_match_seq_idx
    ON match_events (match_id, seq);
