// ============================================================
// When a skill rating is allowed to mean anything
//
// The pipeline will happily produce a number from four players and one
// match each. That number is not weak -- it is confidently wrong, in
// two specific ways that are worth naming because they are properties
// of the algorithm rather than of the data:
//
//  1. The score is entirely POOL-RELATIVE. skill_model.min_max_normalize
//     places each player between the weakest and strongest player
//     currently present, so in a pool of four the best of them scores
//     100 whether they are good or not.
//
//  2. A player with ONE match has no spread in any of their per-match
//     rates, so pandas returns NaN for all seven consistency features
//     and aggregate_player_profiles fills them with 0.0. Zero spread
//     reads to the skill model as FLAWLESS CONSISTENCY, and it is
//     rewarded for it. A one-match player outranks a genuine regular.
//
// So a player below the floor is left OUT of the run entirely rather
// than rated badly. Rating someone off one match and quietly correcting
// it later is worse than not rating them yet.
//
// These are served to the ML service over /internal/match-logs.json so
// there is one definition rather than a copy in Python that can drift.
// ============================================================

// Five is where the consistency features start describing the player
// rather than the arithmetic. It is a judgement call, not a derivation.
export const MIN_MATCHES_PER_PLAYER = 5

// A hard floor from the code, not a preference: test_skill_k_values
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
