"""
One pipeline run: fetch match logs, group the players, post a snapshot.

This is the driver. It owns nothing about HOW players are grouped -- that
all lives in ml/pipeline/, vendored from the ML repo. What it owns is
the three things a driver has to get right and the reference driver in
that repo does not:

  1. It applies the data-sufficiency gate BEFORE the pipeline sees
     anything, so under-played players are left out rather than grouped
     from arithmetic that cannot describe them.

  2. It loops over however many skill groups the clustering actually
     found, instead of hardcoding two.

  3. It refuses to publish a snapshot that lost players on the way
     through.
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from pipeline.player_profiles import aggregate_player_profiles
from pipeline.feature_engineering import (
    create_ml_features,
    prepare_for_ml,
    scale_ml_features,
    create_playstyle_features,
    prepare_playstyle_features,
    residualize_playstyle_features,
    scale_playstyle_features,
    extract_playstyle_components,
)
from pipeline.clustering import (
    prepare_clustering_data,
    test_skill_k_values,
    cluster_skill_groups,
    interpret_skill_clusters,
    apply_skill_cluster_labels,
    test_playstyle_k_values,
    cluster_playstyles,
    interpret_playstyle_clusters,
    apply_playstyle_archetypes,
)

RANDOM_STATE = 42

# The player's own feature values behind their archetype, so a playstyle
# can be explained rather than merely asserted. Same list the ML repo's
# own final-profile builder selects.
EVIDENCE_COLUMNS = [
    "aggression_mean",
    "aggression_std",
    "drop_efficiency_mean",
    "drop_efficiency_std",
    "winner_rate_std",
    "general_error_rate_std",
    "dink_error_rate_std",
    "drop_usage_rate",
    "error_to_winner_ratio",
    "drop_preference_rate_mean",
    "drop_preference_rate_std",
    "net_game_preference_rate_mean",
    "net_game_preference_rate_std",
]


class NotEnoughData(Exception):
    """The gate refused the run. Not a bug -- the designed cold-start path."""


def pipeline_version():
    stamp = HERE / "pipeline" / "VENDORED_FROM"
    if stamp.exists():
        return stamp.read_text().splitlines()[0][:12]
    return "unknown"


# ============================================================
# Fetching
# ============================================================

def fetch_match_logs(api_url, api_key, timeout=120):
    response = requests.get(
        f"{api_url.rstrip('/')}/internal/match-logs.json",
        headers={"x-internal-key": api_key},
        timeout=timeout,
    )
    response.raise_for_status()
    body = response.json()
    # Every player's rally points: how good each player is, which names
    # the skill groups and is taken out of the playstyle features.
    return pd.DataFrame(body["rows"]), body["gate"], body["rallyPoints"]


# ============================================================
# The gate
# ============================================================

def apply_gate(match_df, gate):
    """
    Drops players with too few matches, then checks the pool is big
    enough to cluster at all.

    Both halves matter, and for different reasons.

    A player with ONE match has no spread in any per-match rate, so
    pandas returns NaN for all seven consistency features and
    aggregate_player_profiles fills them with 0.0. Zero spread reads to
    K-Means as flawless consistency, which pulls such a player towards
    the steadiest regulars on the strength of a single match.

    And the groups are found among whoever is in the pool:
    test_skill_k_values cannot choose K for fewer than three players,
    so below that the clustering cannot run at all.
    """
    min_matches = gate["minMatchesPerPlayer"]
    min_players = gate["minPlayers"]

    if match_df.empty:
        raise NotEnoughData("No completed matches to work from.")

    counts = match_df.groupby("player_id")["match_id"].count()
    qualifying = counts[counts >= min_matches].index
    held_back = int(len(counts) - len(qualifying))

    gated = match_df[match_df["player_id"].isin(qualifying)].copy()

    report = {
        "playersSeen": int(len(counts)),
        "playersQualifying": int(len(qualifying)),
        "playersHeldBack": held_back,
        "minMatchesPerPlayer": min_matches,
        # Recorded rather than solved: mixing games to 11 and 21 inflates
        # a player's apparent inconsistency, because most features are
        # per-match rates and a longer game moves them. Knowing the mix
        # is what makes a run's numbers interpretable later.
        "pointTargetMix": {
            str(k): int(v)
            for k, v in match_df.get(
                "point_target", pd.Series(dtype=int)
            ).value_counts().items()
        },
    }

    if len(qualifying) < min_players:
        raise NotEnoughData(
            f"Only {len(qualifying)} player(s) have {min_matches}+ matches; "
            f"the clustering needs at least {min_players}."
        )

    return gated, report


# ============================================================
# The pipeline
# ============================================================

def name_skill_groups(skill_clustered, rally_points):
    """
    Names the skill clusters, and says in which order they run.

    K-Means decides who is grouped with whom and never sees a rating.
    The players' rally points only decide which group is called higher:
    the vendored interpret_skill_clusters ranks clusters by the average
    of its rank_by column.

    On staging's synthetic pool, whose players have a hidden ability,
    group numbers ranked by rally points followed that ability (Spearman
    0.81 over ten random starts) -- see scripts/playstyle_truth_check.py.

    Returns the labelled frame, the group names from lowest to highest
    (None when the groups were given neutral letters), what named them
    ("rally_points" or "neutral"), and the gap between each neighbouring
    pair of groups (see group_gaps).
    """
    points = skill_clustered["player_id"].map(rally_points)
    if points.isna().any():
        missing = skill_clustered.loc[points.isna(), "player_id"].tolist()
        # Refused rather than filled in. A player with no points means
        # the API and the export disagree about which matches count,
        # and naming groups from part of a group would hide that.
        raise RuntimeError(
            f"{len(missing)} rated player(s) have no rally points. "
            f"Refusing to publish. Missing: {sorted(missing)[:5]}"
        )
    ranked = skill_clustered.assign(rally_points=points.astype(float))
    source = "rally_points"

    labels = interpret_skill_clusters(ranked, rank_by="rally_points")
    order = ranked.groupby("skill_cluster")["rally_points"].mean().sort_values().index
    gaps = group_gaps(ranked, order)
    if not all(gap["clear"] for gap in gaps):
        labels = neutral_group_names(ranked)
        source = "neutral"
    # `ranked` rather than the frame that came in, so the rally points
    # column travels on to Level 2, which subtracts them from the
    # playstyle features.
    return (
        apply_skill_cluster_labels(ranked, labels),
        None if source == "neutral" else [labels[cluster] for cluster in order],
        source,
        [{"lower": labels[lower], "upper": labels[upper], **rest}
         for gap in gaps
         for lower, upper, rest in [(gap["lowerCluster"], gap["upperCluster"],
                                     {k: v for k, v in gap.items() if not k.endswith("Cluster")})]],
    )


def group_gaps(ranked, order):
    """
    Whether each skill group sits clearly above the one below it on
    rally points: the gap between their averages must be more than twice
    its standard error (the spread a gap that size could show by chance).

    The groups themselves come from K-Means and are real enough (on the
    pklmart games they differ in DUPR far beyond chance), but which is
    HIGHER can only be read from the rating, and a rating can only
    compare players linked by games. pklmart's players mostly stay in
    their own level, the pools average the same, and its two groups
    came out 0.03 points apart -- named by a coin flip, and backwards
    against DUPR. A group of one player has no spread to judge a gap
    by, so it is never clear.
    """
    points = ranked.groupby("skill_cluster")["rally_points"]
    means, variances, sizes = points.mean(), points.var(), points.size()
    gaps = []
    for lower, upper in zip(order, order[1:]):
        gap = float(means[upper] - means[lower])
        if sizes[lower] < 2 or sizes[upper] < 2:
            needed = float("inf")
        else:
            needed = 2 * float(np.sqrt(variances[lower] / sizes[lower] + variances[upper] / sizes[upper]))
        gaps.append({
            "lowerCluster": lower,
            "upperCluster": upper,
            "lowerMean": round(float(means[lower]), 1),
            "upperMean": round(float(means[upper]), 1),
            "gap": round(gap, 1),
            "needed": None if needed == float("inf") else round(needed, 1),
            "clear": bool(gap > needed),
        })
    return gaps


def neutral_group_names(ranked):
    """
    Letters that say nothing about level: Group A for the biggest group,
    then by size (cluster number on a tie), so the letters cannot quietly
    follow the points the order was too unclear to name by.
    """
    sizes = ranked.groupby("skill_cluster").size()
    by_size = sorted(sizes.index, key=lambda cluster: (-sizes[cluster], cluster))
    return {cluster: f"Group {chr(ord('A') + i)}" for i, cluster in enumerate(by_size)}


def run_pipeline(gated_df, rally_points):
    """
    Runs the vendored pipeline end to end and returns one row per
    player, plus a report of what happened structurally.

    `rally_points` maps player id to rally points. It is what the
    pipeline treats as "how good someone is": it names the skill groups
    (see name_skill_groups) and is subtracted from the playstyle
    features at Level 2. Neither K-Means sees it.

    Every player who goes in comes out. That is asserted, not assumed --
    see the integrity check at the bottom.
    """
    profiles = aggregate_player_profiles(gated_df)

    # ---- Level 1: skill groups -------------------------------------
    ml_features = create_ml_features(profiles)
    ml_oriented = prepare_for_ml(ml_features)
    scaled_features, _ = scale_ml_features(ml_oriented)

    clustering_data = prepare_clustering_data(profiles, scaled_features)

    best_skill_k, _ = test_skill_k_values(
        clustering_data, k_min=2, k_max=5, random_state=RANDOM_STATE
    )
    skill_clustered, _ = cluster_skill_groups(
        clustering_data, best_skill_k, random_state=RANDOM_STATE
    )
    skill_clustered, group_order, group_names_from, group_gaps_found = name_skill_groups(
        skill_clustered, rally_points
    )

    # ---- Level 2: playstyles within each group ---------------------
    playstyle_features = create_playstyle_features(profiles)

    # Skill's influence is removed from the playstyle features first, so
    # the archetypes describe how someone plays rather than how well --
    # otherwise Level 2 just rediscovers Level 1 in disguise.
    #
    # What counts as "how well" is the players' rally points. Measured
    # on the synthetic pool, whose players have a hidden ability, over
    # ten random starts: with the rally points subtracted, ability
    # explained 0.09 of the playstyle spread, which is the chance level
    # (0.09), i.e. nothing. See ml/scripts/playstyle_truth_check.py,
    # which reruns it.
    with_skill = playstyle_features.merge(
        skill_clustered[["player_id", "skill_group", "rally_points"]],
        on="player_id",
        how="inner",
        validate="one_to_one",
    )
    adjusted = residualize_playstyle_features(
        with_skill, target_column="rally_points"
    )
    scaled_playstyle, _ = scale_playstyle_features(
        prepare_playstyle_features(adjusted)
    )

    # The unsupervised feature extraction step. The thirteen measurements,
    # already corrected for skill and standardised, are boiled down with
    # PCA to the few scores that carry at least 80% of their spread, and
    # the style K-Means below runs on those. Fitted once on everyone, not
    # per group, so a score means the same thing in every group. Names are
    # still read from the thirteen measurements, kept alongside.
    #
    # Tested before it went in, with the pass rule written first, against
    # the pipeline without it: on the simulated pool it found the hidden
    # net-play habit about as well (0.34 against 0.36, run-to-run spread
    # 0.08) and let about as little ability into the styles (0.16 against
    # 0.13, spread 0.08); on 151 real players from the pklmart dataset its
    # groups held together as well when players were resampled (0.68
    # against 0.68).
    components, _, spread_kept = extract_playstyle_components(scaled_playstyle)
    component_columns = [c for c in components.columns if c != "player_id"]

    playstyle_cluster_data = (
        skill_clustered[["player_id", "skill_cluster", "skill_group"]]
        .merge(scaled_playstyle, on="player_id", how="inner", validate="one_to_one")
        .merge(components, on="player_id", how="inner", validate="one_to_one")
    )

    # THE FIX.
    #
    # The reference driver names exactly two groups, "Developing /
    # Lower-Performance" and "Higher-Performance", and passes them to a
    # build_final_player_profiles that takes exactly two arguments. But
    # interpret_skill_clusters can return THREE groups, the third being
    # "Intermediate-Performance". When it does, every player in that
    # group is dropped from the output with no error and no warning --
    # they are simply not in the results, and nothing anywhere says so.
    #
    # Looping over what the clustering actually produced costs nothing
    # and cannot go stale when the naming logic changes.
    groups = sorted(playstyle_cluster_data["skill_group"].unique())
    branches = []
    unclustered = []

    for group in groups:
        members = playstyle_cluster_data[
            playstyle_cluster_data["skill_group"] == group
        ]
        # test_playstyle_k_values raises below three members. Those
        # players keep their skill group -- only the archetype is
        # unavailable. That is a smaller loss than failing the whole
        # run, and much smaller than dropping them silently.
        if len(members) < 3:
            unclustered.append(group)
            branches.append(members.assign(playstyle_cluster=pd.NA,
                                           playstyle_archetype=pd.NA,
                                           playstyle_traits=None))
            continue

        group_data, best_k, _ = test_playstyle_k_values(
            playstyle_cluster_data, group, k_min=2, k_max=5,
            random_state=RANDOM_STATE, features=component_columns,
        )
        clustered, _, _ = cluster_playstyles(
            group_data, best_k, random_state=RANDOM_STATE,
            features=component_columns,
        )
        # traits_out collects what each name was actually built from --
        # which measurement chose each word, which way it pointed, how
        # far from this group's average. It travels to the app so a
        # player can check the name against their own numbers instead of
        # taking it on faith.
        traits_map = {}
        archetype_map, _, _ = interpret_playstyle_clusters(
            group_data, clustered, playstyle_features, traits_out=traits_map
        )
        branches.append(
            apply_playstyle_archetypes(clustered, archetype_map, traits_map)
        )

    final = pd.concat(branches, ignore_index=True)

    # ---- Integrity: nobody may vanish ------------------------------
    #
    # A partial snapshot that looks complete is worse than no snapshot,
    # because nothing downstream could ever detect it. This is the check
    # whose absence made the bug above invisible for as long as it was.
    went_in = set(gated_df["player_id"].unique())
    came_out = set(final["player_id"])
    if went_in != came_out:
        lost = went_in - came_out
        gained = came_out - went_in
        raise RuntimeError(
            f"Pipeline lost {len(lost)} player(s) and invented "
            f"{len(gained)}. Refusing to publish. Lost: {sorted(lost)[:5]}"
        )
    if final["player_id"].duplicated().any():
        raise RuntimeError("Duplicate player in pipeline output. Refusing to publish.")

    final = final.merge(
        profiles[["player_id", "match_count"]],
        on="player_id", how="left", validate="one_to_one",
    )

    # The RAW playstyle features are returned separately rather than
    # merged in, and that is not a style choice.
    #
    # `final` already carries these same column NAMES holding the scaled
    # and residualized values -- that is what was clustered. Merging the
    # raw ones in produces aggression_mean_x and aggression_mean_y, and
    # any later lookup by the plain name silently finds neither. Which is
    # exactly what happened: evidence came out as {} for every player,
    # and nothing failed.
    #
    # Keeping them apart makes the two versions impossible to confuse.
    # The player is shown the raw values, because "your aggression is
    # -0.34" is not a fact about them -- it is a fact about how they
    # compare to the pool after skill was projected out.
    evidence = playstyle_features.set_index("player_id")[EVIDENCE_COLUMNS]

    report = {
        "skillGroups": groups,
        # Lowest to highest, or None when the rally points could not
        # clearly order the groups and they were given neutral letters
        # instead ("neutral" below). The gaps say why, for each pair.
        "groupOrder": group_order,
        "groupNamesFrom": group_names_from,
        "groupGaps": group_gaps_found,
        # What was subtracted from the playstyle features before
        # Level 2. Recorded with the run because it is part of what the
        # archetypes mean.
        "residualisedBy": "rally_points",
        "skillK": int(best_skill_k),
        "groupsTooSmallToCluster": unclustered,
        # What the style K-Means actually saw. Recorded for the same
        # reason as residualisedBy: it changes what the archetypes mean.
        "styleExtraction": {
            "method": "pca",
            "components": len(component_columns),
            "spreadKept": round(spread_kept, 4),
        },
    }
    return final, evidence, report


# ============================================================
# Publishing
# ============================================================

def to_payload(final, evidence_df, gate_report, structure_report, match_count):
    missing = [c for c in EVIDENCE_COLUMNS if c not in evidence_df.columns]
    if missing:
        # Loud rather than an empty dict. The first version of this
        # skipped absent columns and published {} for every player
        # without a murmur; a rating nobody can explain is only slightly
        # better than no rating, and it should never ship silently.
        raise RuntimeError(f"Evidence columns missing from features: {missing}")

    ratings = []
    for row in final.to_dict("records"):
        values = evidence_df.loc[row["player_id"]]
        evidence = {
            column: (None if pd.isna(values[column]) else float(values[column]))
            for column in EVIDENCE_COLUMNS
        }
        cluster = row.get("playstyle_cluster")
        traits = row.get("playstyle_traits")
        ratings.append({
            "playerId": row["player_id"],
            "skillGroup": row.get("skill_group"),
            "playstyleCluster": None if pd.isna(cluster) else int(cluster),
            "playstyleArchetype": (
                None if pd.isna(row.get("playstyle_archetype")) else
                row["playstyle_archetype"]
            ),
            # What the archetype name was built from. A list, or None for
            # a group too small to cluster -- which has no name either.
            "playstyleTraits": traits if isinstance(traits, list) else None,
            "evidence": evidence,
            "matchCount": int(row.get("match_count") or 0),
        })

    return {
        "status": "completed",
        "pipelineVersion": pipeline_version(),
        "playerCount": len(ratings),
        "matchCount": match_count,
        "notes": {"gate": gate_report, "structure": structure_report},
        "ratings": ratings,
    }


def post_ratings(api_url, api_key, payload, timeout=120):
    response = requests.post(
        f"{api_url.rstrip('/')}/internal/ratings",
        headers={"x-internal-key": api_key},
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def post_failure(api_url, api_key, reason, gate_report=None):
    """
    Records that the pipeline ran and refused to publish.

    Worth the extra call: without it, "the gate held" and "the service
    never woke up" look identical from the database, and those need very
    different responses.
    """
    return post_ratings(api_url, api_key, {
        "status": "failed",
        "pipelineVersion": pipeline_version(),
        "notes": {"reason": reason, "gate": gate_report or {}},
    })


# ============================================================
# Entry point
# ============================================================

def run(api_url=None, api_key=None, publish=True):
    api_url = api_url or os.environ["PADDLEPAD_API_URL"]
    api_key = api_key or os.environ["INTERNAL_API_KEY"]

    started = datetime.now(timezone.utc)
    match_df, gate, rally_points = fetch_match_logs(api_url, api_key)
    print(f"Fetched {len(match_df)} match rows.")

    gate_report = None
    try:
        gated, gate_report = apply_gate(match_df, gate)
        final, evidence, structure = run_pipeline(gated, rally_points)
    except NotEnoughData as reason:
        print(f"Gate held: {reason}")
        if publish:
            post_failure(api_url, api_key, str(reason), gate_report)
        return {"status": "gated", "reason": str(reason), "gate": gate_report}

    payload = to_payload(final, evidence, gate_report, structure, int(len(gated)))
    print(
        f"Rated {payload['playerCount']} players "
        f"in {(datetime.now(timezone.utc) - started).total_seconds():.1f}s."
    )

    if not publish:
        return {"status": "dry-run", "payload": payload}

    written = post_ratings(api_url, api_key, payload)
    print(f"Published run {written['run']['id']}.")
    return {"status": "completed", **written}


if __name__ == "__main__":
    run(publish="--dry-run" not in sys.argv)
