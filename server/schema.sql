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

-- Umpire accounts used to carry an admin flag for issuing invite codes.
-- Admin powers now belong to admin accounts (see "Admin accounts" at the
-- end of this file), so the flag is removed.
ALTER TABLE umpires DROP COLUMN IF EXISTS is_admin;

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

-- Lets a player claim their own record by typing the code, inheriting
-- the history an umpire already logged for them. POST /auth/player/claim
-- signs them in with it; it is cleared once they set a password or
-- connect Google.
--
-- Codes are minted lazily on first read rather than backfilled, which
-- keeps this a one-line ALTER.
--
-- SECURITY: claim_code is a bearer secret -- anyone holding it can
-- claim that player. It must never be included in list responses; the
-- roster is the most screenshotted screen in the app. Only a route that
-- answers for one player at a time may return it.
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

-- Every game this player played in the run, scored on the pool's own
-- 0-100 scale: [{"matchId": ..., "score": ...}]. Their rating is the
-- AVERAGE of these, exactly -- min-max scaling and a weighted sum are
-- both affine, so the mean of the scores is the score of the means.
-- The pipeline refuses to publish a run where that stops holding.
-- Null for runs published before it sent them.
ALTER TABLE player_ratings ADD COLUMN IF NOT EXISTS game_scores JSONB;

CREATE INDEX IF NOT EXISTS player_ratings_player_idx
    ON player_ratings (player_id);

-- ============================================================
-- Admin accounts
--
-- Separate from umpires and players on purpose: running the platform is
-- a different job from scoring a match or reading your own stats, and
-- keeping the accounts apart means a leaked umpire password never
-- reaches admin powers. There is exactly one owner, created by
-- scripts/create-owner.mjs; only the owner adds or switches off admins.
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    -- NULL means this admin signs in with Google only.
    password_hash     TEXT,
    -- What a Google sign-in is matched on. Never google_email.
    google_sub        TEXT,
    -- Display only, so the account page can say which Google account.
    google_email      TEXT,
    role              TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
    deactivated_at    TIMESTAMPTZ,
    last_signed_in_at TIMESTAMPTZ,
    created_by        UUID REFERENCES admins (id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS admins_email_lower_idx
    ON admins (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS admins_google_sub_idx
    ON admins (google_sub) WHERE google_sub IS NOT NULL;
-- At most one owner, enforced by the database rather than by hoping
-- every code path remembers to check.
CREATE UNIQUE INDEX IF NOT EXISTS admins_one_owner_idx
    ON admins (role) WHERE role = 'owner';

-- One-time links for choosing a password or connecting Google. Only a
-- hash of the secret is stored. Making a new link for an admin cancels
-- their unused older ones, which is also how a forgotten password is
-- recovered.
CREATE TABLE IF NOT EXISTS admin_setup_links (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
    secret_hash  TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_by   UUID REFERENCES admins (id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who did what. Rows are only ever inserted, in the same transaction as
-- the change they describe; no route updates or deletes them. The id
-- counts up so the page can continue from the last entry it showed.
CREATE TABLE IF NOT EXISTS admin_activity (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- NULL only for scripts/create-owner.mjs.
    admin_id    UUID REFERENCES admins (id) ON DELETE SET NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    summary     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_activity_admin_idx
    ON admin_activity (admin_id, id DESC);

-- Invite codes are made by admins from now on. created_by (an umpire)
-- stays for the codes made before the admin site existed.
ALTER TABLE invites
    ADD COLUMN IF NOT EXISTS created_by_admin UUID REFERENCES admins (id) ON DELETE SET NULL;

-- ============================================================
-- People: pausing and closing accounts from the admin site
--
-- A pause is reversible: the person cannot sign in and any session
-- they hold ends on its next request, but nothing else changes. The
-- reason is kept beside it so every admin sees why.
--
-- A closed player uses players.deactivated_at, the same state as a
-- player who closed their own account. Umpires never had that, so
-- closed_at is theirs. Closing clears a pause.
--
-- last_signed_in_at is set by every sign-in door from here on; older
-- rows stay NULL, which the admin site shows as "Not yet recorded".
-- ============================================================
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS paused_at         TIMESTAMPTZ;
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS paused_reason     TEXT;
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMPTZ;
ALTER TABLE umpires ADD COLUMN IF NOT EXISTS last_signed_in_at TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS paused_at         TIMESTAMPTZ;
ALTER TABLE players ADD COLUMN IF NOT EXISTS paused_reason     TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_signed_in_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS umpires_created_idx ON umpires (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS players_created_idx ON players (created_at DESC, id DESC);

-- Set only when the OWNER closes a player from the admin site, never by
-- a player's own self-deletion. While set, only the owner may mint a
-- fresh claim code for this player (people-rules.js mayMintClaimCode);
-- a successful claim clears it along with deactivated_at.
ALTER TABLE players ADD COLUMN IF NOT EXISTS closed_by_admin_at TIMESTAMPTZ;

-- ============================================================
-- Ending admin sessions
--
-- An admin token issued before this moment no longer works. Set when a
-- password or Google link changes, when an admin is switched off, when
-- backup codes are made or used, and by "Sign out everywhere else".
-- NULL means never reset.
-- ============================================================
ALTER TABLE admins ADD COLUMN IF NOT EXISTS sessions_reset_at TIMESTAMPTZ;

-- The owner's backup codes: one-time ways back in if they lose their
-- password and Google. Stored only as hashes, like passwords.
CREATE TABLE IF NOT EXISTS admin_backup_codes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id   UUID NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_backup_codes_admin_idx ON admin_backup_codes (admin_id) WHERE used_at IS NULL;

-- ============================================================
-- Facilities
--
-- A facility is a place with courts where umpires score matches for an
-- hourly fee the facility sets (shown to players; paid at the
-- facility). Umpires, admins other than the owner, sessions and invite
-- codes each belong to one. Players belong to none: they can play
-- anywhere, and ratings and boards are across everyone on PaddlePad.
-- ============================================================
CREATE TABLE IF NOT EXISTS facilities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    area                TEXT,
    location_url        TEXT,
    opening_hours       TEXT,
    hourly_fee_centavos INTEGER CHECK (hourly_fee_centavos IS NULL OR hourly_fee_centavos >= 0),
    details             TEXT,
    created_by          UUID REFERENCES admins (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS facilities_name_lower_idx ON facilities (lower(name));

-- A facility's logo, shrunk in the admin's browser before upload: the
-- full one fits inside 512 x 512, the small one (for lists) inside
-- 128 x 128. Its own table so facility lists never carry picture bytes.
CREATE TABLE IF NOT EXISTS facility_logos (
    facility_id UUID PRIMARY KEY REFERENCES facilities (id) ON DELETE CASCADE,
    full_image  BYTEA NOT NULL,
    small_image BYTEA NOT NULL,
    mime_type   TEXT  NOT NULL CHECK (mime_type IN ('image/webp', 'image/png', 'image/jpeg')),
    updated_by  UUID REFERENCES admins (id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What an umpire costs per hour at this facility, set by its admins and
-- shown to players beside the court fee. Empty until an admin sets it.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS umpire_fee_centavos INTEGER
    CHECK (umpire_fee_centavos IS NULL OR umpire_fee_centavos >= 0);

ALTER TABLE umpires        ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities (id);
ALTER TABLE admins         ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities (id);
ALTER TABLE sessions       ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities (id);
ALTER TABLE invites        ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities (id);
ALTER TABLE admin_activity ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES facilities (id);
CREATE INDEX IF NOT EXISTS umpires_facility_idx  ON umpires (facility_id);
CREATE INDEX IF NOT EXISTS sessions_facility_idx ON sessions (facility_id);
CREATE INDEX IF NOT EXISTS invites_facility_idx  ON invites (facility_id);
CREATE INDEX IF NOT EXISTS admin_activity_facility_idx ON admin_activity (facility_id, id DESC);

-- The switch-over: everything made before facilities existed goes into
-- one starting facility, created once, which the owner then renames.
-- One-time only: it can act only while no facility exists yet at all.
-- Once the first facility exists (however it got there), this never
-- runs again, and any row left with a NULL facility_id after that
-- stays visibly unassigned instead of being swept in silently. Safe to
-- re-run: an advisory lock (held only for this transaction) keeps two
-- servers booting at once from both inserting a "Starting facility".
DO $$
DECLARE starting UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(729016455);
  IF NOT EXISTS (SELECT 1 FROM facilities)
     AND (EXISTS (SELECT 1 FROM umpires WHERE facility_id IS NULL)
          OR EXISTS (SELECT 1 FROM sessions WHERE facility_id IS NULL)
          OR EXISTS (SELECT 1 FROM invites WHERE facility_id IS NULL)
          OR EXISTS (SELECT 1 FROM admins WHERE facility_id IS NULL AND role <> 'owner')) THEN
    INSERT INTO facilities (name) VALUES ('Starting facility') RETURNING id INTO starting;
    UPDATE umpires  SET facility_id = starting WHERE facility_id IS NULL;
    UPDATE sessions SET facility_id = starting WHERE facility_id IS NULL;
    UPDATE invites  SET facility_id = starting WHERE facility_id IS NULL;
    UPDATE admins   SET facility_id = starting WHERE facility_id IS NULL AND role <> 'owner';
  END IF;
END $$;

-- Two repairs that run on EVERY boot, unlike the one-time switch-over
-- above.
--
-- 1. A session with no facility. The switch-over cannot catch one made
--    afterwards (it stops for good once any facility exists), and a
--    session's facility is simply its umpire's, so fill it in. A
--    session whose umpire is somehow gone stays blank, and a blank
--    session is visible to no umpire -- fail closed rather than
--    guessing.
--
-- 2. umpires.facility_id becomes NOT NULL, so no future code path can
--    make an umpire belonging nowhere. Applied only once nothing is
--    left blank: a boot must never fail because of old data, so if any
--    umpire is still missing one the rule is skipped and said out loud
--    instead. Re-running SET NOT NULL on a column that already has it
--    is a no-op, so this is safe on every boot.
DO $$
DECLARE stranded INT;
BEGIN
  UPDATE sessions s
     SET facility_id = u.facility_id
    FROM umpires u
   WHERE u.id = s.created_by
     AND s.facility_id IS NULL
     AND u.facility_id IS NOT NULL;

  SELECT count(*) INTO stranded FROM umpires WHERE facility_id IS NULL;
  IF stranded = 0 THEN
    EXECUTE 'ALTER TABLE umpires ALTER COLUMN facility_id SET NOT NULL';
  ELSE
    RAISE NOTICE 'umpires.facility_id left nullable: % umpire(s) have no facility', stranded;
  END IF;
END $$;

-- ============================================================
-- The Overview (admin site's landing page)
--
-- Warnings are worked out when the page is opened; the only thing
-- stored is what an admin chose to hide: one reason on one match
-- ("Looks fine"), or a pair of players the owner says are two
-- different people. Hiding a warning never changes a match or player.
-- ============================================================
CREATE TABLE IF NOT EXISTS dismissed_warnings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('match', 'players')),
    match_id    UUID REFERENCES matches (id) ON DELETE CASCADE,
    reason      TEXT,
    player_a    UUID REFERENCES players (id) ON DELETE CASCADE,
    player_b    UUID REFERENCES players (id) ON DELETE CASCADE,
    facility_id UUID REFERENCES facilities (id),
    admin_id    UUID REFERENCES admins (id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT dismissed_warnings_shape CHECK (
        (kind = 'match' AND match_id IS NOT NULL AND reason IS NOT NULL AND player_a IS NULL AND player_b IS NULL)
        OR (kind = 'players' AND match_id IS NULL AND reason IS NULL
            AND player_a IS NOT NULL AND player_b IS NOT NULL AND player_a < player_b)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS dismissed_warnings_match_idx
    ON dismissed_warnings (match_id, reason) WHERE kind = 'match';
CREATE UNIQUE INDEX IF NOT EXISTS dismissed_warnings_players_idx
    ON dismissed_warnings (player_a, player_b) WHERE kind = 'players';

-- The one match change an admin can make: voiding a match the Overview
-- flagged (and undoing that). Set only by the Overview; the umpire
-- app's own void route clears it, so an umpire's later decision always
-- reads as the umpire's.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_by_admin UUID REFERENCES admins (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS matches_started_idx ON matches (started_at DESC);

-- The one session change an admin can make: closing a session an
-- umpire left open (housekeeping, not a match decision -- see Void
-- above). Set only by the Overview; the umpire's own end route clears
-- it on reopening, so the umpire keeps the last word.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ended_by_admin UUID REFERENCES admins (id) ON DELETE SET NULL;
