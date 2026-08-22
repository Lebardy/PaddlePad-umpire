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

CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    created_by UUID REFERENCES umpires (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
