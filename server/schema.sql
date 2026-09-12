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

-- Signing in with Google.
--
-- google_sub is the account identifier Google issues -- stable for the
-- life of that Google account, and never the email address, which a
-- person can change.
--
-- password_hash loses its NOT NULL because an umpire who only ever
-- signs in with Google has no password to store. A NULL there now means
-- exactly that: Google only.
--
-- SECURITY: /auth/login must therefore keep verifying against
-- NO_SUCH_ACCOUNT_HASH when it finds no usable hash, rather than
-- returning early. Short-circuiting would make a Google-only account
-- answer faster than a wrong password, which tells an attacker which
-- accounts exist and how they sign in.
--
-- Registration stays invite-only whichever door is used. Signing IN with
-- Google is free; the first time an unknown Google account appears it
-- still has to present an invite. See routes/auth.js.
ALTER TABLE umpires ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS google_sub TEXT;

-- The Google address, kept only so the account screen can say WHICH
-- Google account is connected -- someone with two of them needs to be
-- able to tell whether the one attached is still theirs.
--
-- SECURITY: display only. google_sub is the only thing a Google sign-in
-- is ever resolved against, and this column must never become a second
-- matching key. Umpires do have an email column and /auth/google links
-- on it deliberately (Google having proved the address is verified),
-- which is exactly why this one has to stay inert: two columns holding
-- an address, only one of them a credential, is how the wrong one gets
-- trusted later.
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS google_email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS umpires_google_sub_idx
    ON umpires (google_sub) WHERE google_sub IS NOT NULL;

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

-- ============================================================
-- Player accounts
--
-- A player can get in two ways, and both are meant to exist.
--
--   1. The claim code above -- an umpire hands over a code or a QR and
--      the player is looking at their stats seconds later. That speed is
--      the whole reason records get claimed at all, so it is not being
--      replaced.
--   2. A username and password they chose themselves, which survives a
--      lost code, a new phone and a cleared browser.
--
-- The code proves who you are; the password keeps you in.
--
-- Credentials live HERE rather than in a separate accounts table,
-- because a player and their account are the same thing. A join table
-- would only earn its keep if one human could hold several player
-- records -- which is exactly what players_name_lower_idx exists to
-- prevent.
--
-- There is still no email column that this app ASKS anyone for.
-- Nothing here has anything to send, so an address typed into a signup
-- form would be a username in disguise: never verified, never used,
-- and inviting the question of why it was collected.
--
-- google_email further down is not that, and does not reopen it. It is
-- a label Google hands back with a sign-in, kept so the profile screen
-- can say WHICH Google account is attached -- "signed in as
-- maria@gmail.com, not you?" -- which is otherwise unanswerable. It is
-- never a login key and never matched against.
--
-- SECURITY: the claim code KEEPS WORKING after a password is set. That
-- is deliberate, not an oversight. With no email there is no reset
-- link, so an umpire regenerating the code is the recovery path for a
-- forgotten password -- and unlike a reset email it has a trusted human
-- in the loop. Do not "fix" this by invalidating codes on registration.
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS username      TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;

-- Partial, because the overwhelming majority of players are created by
-- an umpire and never register. Usernames are compared case-insensitively
-- for the same reason umpire emails are: "Maria" and "maria" must not be
-- able to become two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS players_username_lower_idx
    ON players (lower(username)) WHERE username IS NOT NULL;

-- ============================================================
-- The third way in: Google
--
-- google_sub is the account identifier Google issues. It is stable for
-- the life of that Google account, is never the email address (which a
-- person can change), and is the ONLY thing a Google sign-in is
-- matched on here.
--
-- Why this is not simply what /auth/google does for umpires: an umpire
-- HAS an email column, and it is the address they signed up with, so a
-- Google account whose address matches can be attached to it on sight.
-- A player has no such address. There is nothing to match, and nothing
-- is attempted -- an unrecognised Google account is asked for a name,
-- and if that name is already on the roster it is asked for a claim
-- code, exactly as /auth/player/register is.
--
-- Matching a player on a Google address instead would hand one
-- person's whole history to whoever turned up holding the same address
-- -- the identity guard at the top of this file running backwards.
--
-- SECURITY: deleting a profile must wipe BOTH columns along with the
-- username, password and claim code, or a closed account still signs
-- back in with one tap. routes/player.js DELETE /me does. The merge in
-- POST /player/link must MOVE them onto the surviving row for the same
-- reason it moves the username -- the row it deletes is the one
-- holding them.
-- ============================================================

ALTER TABLE players ADD COLUMN IF NOT EXISTS google_sub   TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS google_email TEXT;

-- Partial for the same reason the username index is: the overwhelming
-- majority of players are created by an umpire and never sign in at all.
CREATE UNIQUE INDEX IF NOT EXISTS players_google_sub_idx
    ON players (google_sub) WHERE google_sub IS NOT NULL;

-- Whether this player's name may appear on the monthly board.
--
-- A DISPLAY choice and nothing more. A player who turns it off keeps
-- every match, every rating and every row of the ML export exactly as
-- before -- the board simply leaves them off. They are also still
-- counted, anonymously, wherever a number is about everyone (how many
-- rated players there are, how many people someone else met). What they
-- asked for is not to be named, and that is all this withholds.
--
-- Defaults to showing, as the user who designed it chose: people can
-- keep themselves private if they want to, rather than having to opt in
-- before the board has anyone on it.
ALTER TABLE players ADD COLUMN IF NOT EXISTS name_visible BOOLEAN NOT NULL DEFAULT true;

-- A player who deleted their profile.
--
-- The row survives, and that is the whole point of this column. A
-- player's matches are not solely theirs: their name appears in every
-- partner's and opponent's history (player-stats.js resolves each id on
-- court to a name from THIS table), matches.first_server_player is a
-- foreign key with no ON DELETE, and team_a/team_b are plain UUID[] with
-- no foreign key at all. Deleting the row would either be refused by
-- Postgres or leave dangling ids in other people's match records.
--
-- So deleting an account clears username, password_hash, claim_code,
-- claimed_at and registered_at, and stamps this. Wiping the credentials
-- rather than merely flagging the row is what makes the account
-- genuinely unusable; freeing the username for someone else to take is
-- intended. A player who has never appeared in a match IS hard-deleted
-- instead -- nothing points at them.
--
-- This has to be its own state rather than being inferred from
-- "username IS NULL AND password_hash IS NULL", because that is exactly
-- what an ordinary umpire-created player who never registered looks
-- like, and the two must be told apart: player tokens are valid for 30
-- days, so a closed account needs something for requireActivePlayer to
-- read.
--
-- Claiming a fresh code REVIVES the account (see routes/auth.js), the
-- same trusted-human recovery path as the forgotten password above: an
-- umpire mints a new code with GET /players/:id/claim-code, which mints
-- lazily and so works on a row whose code was just wiped.
--
-- The ML pipeline is unaffected. It aggregates by player_id over
-- `matches`, and none of this touches a match.
ALTER TABLE players ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

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
-- A session that is finished -- the night is over, everyone has gone
-- home.
--
-- Deliberately NOT the same thing as voiding. A voided session is one
-- that should never have counted and is excluded from the export; an
-- ended session counted perfectly well and is simply over. Every match
-- in it stays in the data.
--
-- It exists because "is this session still running" was otherwise
-- unanswerable. Sessions had a name, a creation time and a roster, so
-- the app could only guess from the clock -- and every umpire sees
-- every umpire's sessions (see the security notes in README), which
-- made a list of other people's nights grow without limit and with no
-- way to tell which were live.
--
-- Reversible, because the honest reason to end a session is usually
-- "we're done" and occasionally people are wrong about that.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES umpires (id) ON DELETE SET NULL;

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
-- Who started the game on the RIGHT, per team.
--
-- Doubles serving order depends on it and cannot be derived without
-- it. The player on the right serves when a team gains the serve, and
-- a pair swaps sides only when their own team scores -- so the right
-- side player is decided by that team's score being even or odd,
-- measured from where they began. Team order in team_a/team_b is the
-- order an umpire tapped names in and says nothing about position.
--
-- For the team that serves first this is the first server, by rule.
-- For the other pair only the umpire knows, which is why match setup
-- asks. NULL on every match recorded before that question existed; see
-- rightStartIndices in src/pickleball.js for what stands in.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS right_start_a UUID REFERENCES players (id);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS right_start_b UUID REFERENCES players (id);

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
    type       TEXT NOT NULL CHECK (type IN ('rally', 'thirdShot', 'serverCorrection')),
    payload    JSONB NOT NULL,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordering within a match must be unambiguous for replay, and this
-- doubles as the idempotency guard for sync retries: re-sending the
-- same event position twice cannot duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS match_events_match_seq_idx
    ON match_events (match_id, seq);

-- 'serverCorrection' joined the list after the table already existed on
-- staging and production, and a CHECK written inline on a CREATE TABLE
-- IF NOT EXISTS does not update itself. So whatever type check is on
-- the table is dropped and re-added on every boot.
--
-- Found by definition rather than by name. Dropping a guessed name that
-- turns out to be wrong is a no-op, which would leave the OLD check in
-- place alongside the new one and quietly reject every correction -- a
-- failure that would show up on court rather than at boot.
DO $$
DECLARE existing record;
BEGIN
    FOR existing IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'match_events'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%type%'
    LOOP
        EXECUTE format('ALTER TABLE match_events DROP CONSTRAINT %I', existing.conname);
    END LOOP;
END $$;

ALTER TABLE match_events ADD CONSTRAINT match_events_type_allowed
    CHECK (type IN ('rally', 'thirdShot', 'serverCorrection'));

-- ============================================================
-- ML pipeline results
--
-- Ratings are stored as immutable SNAPSHOTS, never as a column on
-- players, and this is the most important thing to understand about
-- these two tables.
--
-- The skill score is entirely POOL-RELATIVE: skill_model.py scores
-- each player by where they sit between the weakest and strongest
-- player currently in the data (min_max_normalize). A player's number
-- therefore moves because OTHER PEOPLE played, without them touching a
-- paddle. If a rating were a column that got overwritten, that movement
-- would be invisible and unexplainable -- someone would open the app,
-- see they had dropped four points, and nothing anywhere could say why.
--
-- As snapshots, every number carries the moment it was computed and the
-- size of the pool it was computed against. "78, as of 24 August,
-- against 46 players" is a defensible statement; "78" alone is not.
-- It also means a bad run can be discarded without losing the last
-- good one.
-- ============================================================

CREATE TABLE IF NOT EXISTS rating_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 'completed' rows are the only ones ever read by the app. A run
    -- that fails its own integrity checks is recorded as 'failed' with
    -- the reason in `notes`, so a silent no-op is distinguishable from
    -- a run that never happened.
    status           TEXT NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('completed', 'failed')),
    -- The pool the scores are relative to. Without these two numbers a
    -- stored score cannot be interpreted later.
    player_count     INTEGER NOT NULL DEFAULT 0,
    match_count      INTEGER NOT NULL DEFAULT 0,
    -- Which revision of the vendored pipeline produced this. Scores
    -- from different pipeline versions are not comparable.
    pipeline_version TEXT,
    -- Free-form record of the conditions of the run: the point-target
    -- mix, how many players were held back by the sufficiency gate,
    -- and the failure reason when status = 'failed'.
    notes            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS rating_runs_latest_idx
    ON rating_runs (computed_at DESC) WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS player_ratings (
    run_id             UUID NOT NULL REFERENCES rating_runs (id) ON DELETE CASCADE,
    player_id          UUID NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    -- 0-100, relative to the pool recorded on the run.
    skill_score        DOUBLE PRECISION NOT NULL,
    -- Stored but deliberately NOT shown in the player app. assign_skill_tier
    -- applies absolute cutoffs (40 / 75) to a relative score, so in a small
    -- pool the best player scores 100 and is labelled "Professional"
    -- regardless of how they actually play. Keeping the value means the
    -- problem stays visible in the data rather than being hidden.
    skill_tier         TEXT,
    -- Level 1 of the clustering: which broad performance band the player
    -- was placed in before playstyles were clustered within it.
    skill_group        TEXT,
    playstyle_cluster  INTEGER,
    playstyle_archetype TEXT,
    -- The player's own feature values behind the archetype, so a rating
    -- can be explained rather than merely asserted.
    evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- How many matches this player's row was computed from. Below the
    -- gate's floor a player is excluded from the run entirely, so this
    -- is always a qualifying count -- recorded so the app can say what
    -- the number rests on.
    match_count        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_id, player_id)
);

-- What the archetype name was built from: each word with the
-- measurement that chose it, which way it pointed, and how far from the
-- skill group's average it sat. The pipeline works this out to pick the
-- words and used to throw it away; stored so the app can show a player
-- the numbers beside their name instead of asking them to take it on
-- faith.
--
-- NULL for a rating published before this existed, and for a player in
-- a group too small to cluster -- who has no archetype either. The app
-- says so rather than inventing a reason.
ALTER TABLE player_ratings ADD COLUMN IF NOT EXISTS playstyle_traits JSONB;

-- The four measurements the skill score is a weighted sum of, each with
-- the player's own value and the points it contributed. Where
-- `evidence` explains the ARCHETYPE, this explains the NUMBER: the four
-- add up to skill_score exactly, and the pipeline refuses to publish a
-- run where they do not. Null for runs published before it sent them.
ALTER TABLE player_ratings ADD COLUMN IF NOT EXISTS score_parts JSONB;

CREATE INDEX IF NOT EXISTS player_ratings_player_idx
    ON player_ratings (player_id);
