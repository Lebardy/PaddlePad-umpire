// ============================================================
// When a skill group and a playstyle are allowed to mean anything
//
// The pipeline will happily produce a result from four players and one
// match each. That result is not weak -- it is confidently wrong, in
// two specific ways that are worth naming because they are properties
// of the algorithm rather than of the data:
//
//  1. The result is entirely POOL-RELATIVE. Every feature is
//     standardised against the players currently present and K-Means
//     groups whoever is there, so a pool of four is split into groups
//     whether or not its players differ in any way that matters.
//
//  2. A player with ONE match has no spread in any of their per-match
//     rates, so pandas returns NaN for all seven consistency features
//     and aggregate_player_profiles fills them with 0.0. Zero spread
//     reads to K-Means as FLAWLESS CONSISTENCY, which pulls a one-match
//     player towards the steadiest regulars.
//
// So a player below the floor is left OUT of the run entirely rather
// than grouped badly. Grouping someone off one match and quietly
// correcting it later is worse than not grouping them yet.
//
// These are served to the ML service over /internal/match-logs.json so
// there is one definition rather than a copy in Python that can drift.
// ============================================================

// Five is where the consistency features start describing the player
// rather than the arithmetic. It is a judgement call, not a derivation.
export const MIN_MATCHES_PER_PLAYER = 5

// A hard floor from the code, not a preference: choose_skill_k
// sets maximum_k = min(k_max, len(X) - 1) and raises
// ValueError("Not enough players for K selection.") below three. The
// pipeline cannot run at all under this.
export const MIN_PLAYERS = 3

// The practical floor. The clustering is two-level -- it splits the
// pool into skill groups, then clusters playstyles WITHIN each group --
// and skips any group with fewer than three members. Below roughly
// forty players the second level starts collapsing and the archetype,
// the interesting half of the result, stops being produced.
export const RECOMMENDED_PLAYERS = 40

export const RATING_GATE = {
  minMatchesPerPlayer: MIN_MATCHES_PER_PLAYER,
  minPlayers: MIN_PLAYERS,
  recommendedPlayers: RECOMMENDED_PLAYERS,
}
