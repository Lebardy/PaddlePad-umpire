import numpy as np
import pandas as pd

from sklearn.cluster import KMeans
from sklearn.metrics import (
    silhouette_score,
    adjusted_rand_score
)


# ============================================================
# CLUSTERING FEATURES
# ============================================================

CLUSTERING_FEATURES = [
    "winner_rate_mean",
    "general_error_rate_mean",
    "dink_error_rate_mean",
    "drop_efficiency_mean",
    "aggression_mean",
    "winner_rate_std",
    "general_error_rate_std",
    "dink_error_rate_std",
    "drop_efficiency_std",
    "aggression_std"
]


# ============================================================
# PLAYSTYLE CLUSTERING FEATURES
# ============================================================

PLAYSTYLE_CLUSTERING_FEATURES = [
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
    "net_game_preference_rate_std"
]

# ============================================================
# PREPARE CLUSTERING DATA
# ============================================================

def prepare_clustering_data(
    player_profiles,
    scaled_features
):
    """
    Combine the player ids with the standardized
    behavioral feature representation.

    The features are everything K-Means is given to
    create the skill clusters.
    """

    players = player_profiles.copy()
    features = scaled_features.copy()

    # --------------------------------------------------------
    # Validate IDs
    # --------------------------------------------------------

    if "player_id" not in players.columns:
        raise ValueError(
            "player_profiles must contain 'player_id'."
        )

    if "player_id" not in features.columns:
        raise ValueError(
            "scaled_features must contain 'player_id'."
        )

    # --------------------------------------------------------
    # Validate features
    # --------------------------------------------------------

    missing_features = [
        feature
        for feature in CLUSTERING_FEATURES
        if feature not in features.columns
    ]

    if missing_features:
        raise ValueError(
            "Missing clustering features: "
            + ", ".join(missing_features)
        )

    # --------------------------------------------------------
    # Select columns
    # --------------------------------------------------------

    player_data = players[
        [
            "player_id"
        ]
    ].copy()

    feature_data = features[
        [
            "player_id",
            *CLUSTERING_FEATURES
        ]
    ].copy()

    # --------------------------------------------------------
    # Merge
    # --------------------------------------------------------

    combined = player_data.merge(
        feature_data,
        on="player_id",
        how="inner",
        validate="one_to_one"
    )

    # --------------------------------------------------------
    # Validate merge
    # --------------------------------------------------------

    if len(combined) != len(player_data):
        raise ValueError(
            "Some players were lost when combining "
            "player ids and clustering features."
        )

    return combined


# ============================================================
# TRY EACH K AND KEEP THE BEST
# ============================================================

def score_k_values(
    X,
    k_min,
    maximum_k,
    random_state
):
    """
    Fit K-Means for every K from k_min to maximum_k and score
    each fit with the Silhouette Score.

    Prints one line per K. Returns the K with the highest
    score, and every fit keyed by K.
    """

    results = {}

    for k in range(
        k_min,
        maximum_k + 1
    ):

        kmeans = KMeans(
            n_clusters=k,
            random_state=random_state,
            n_init=20
        )

        labels = (
            kmeans.fit_predict(X)
        )

        score = silhouette_score(
            X,
            labels
        )

        results[k] = {
            "silhouette": score,
            "labels": labels,
            "model": kmeans
        }

        print(
            f"  K={k}: "
            f"Silhouette Score = "
            f"{score:.3f}"
        )

    best_k = max(
        results,
        key=lambda k:
        results[k]["silhouette"]
    )

    return (
        best_k,
        results
    )


# ============================================================
# CHOOSE K FOR SKILL CLUSTERING
# ============================================================

def choose_skill_k(
    clustering_data,
    k_min=2,
    k_max=5,
    random_state=42
):
    """
    Test multiple K values for the first-level
    skill clustering.

    K is selected using the highest Silhouette Score.
    """

    X = clustering_data[
        CLUSTERING_FEATURES
    ].copy()

    maximum_k = min(
        k_max,
        len(X) - 1
    )

    if maximum_k < k_min:
        raise ValueError(
            "Not enough players for K selection."
        )

    print(
        "\n=== SKILL CLUSTER K SELECTION ==="
    )

    best_k, results = score_k_values(
        X,
        k_min,
        maximum_k,
        random_state
    )

    print(
        f"\nBest K for skill groups: "
        f"K={best_k}"
    )

    print(
        f"Best Silhouette Score: "
        f"{results[best_k]['silhouette']:.3f}"
    )

    return (
        best_k,
        results
    )


# ============================================================
# RUN FINAL SKILL CLUSTERING
# ============================================================

def cluster_skill_groups(
    clustering_data,
    best_k,
    random_state=42
):
    """
    Run the final first-level K-Means model.

    This produces generic skill groups such as:

        Cluster 0
        Cluster 1
        Cluster 2

    We intentionally DO NOT name them yet. See
    interpret_skill_clusters.
    """

    X = clustering_data[
        CLUSTERING_FEATURES
    ].copy()

    kmeans = KMeans(
        n_clusters=best_k,
        random_state=random_state,
        n_init=20
    )

    labels = (
        kmeans.fit_predict(X)
    )

    result = clustering_data.copy()

    result[
        "skill_cluster"
    ] = labels

    cluster_counts = (
        result[
            "skill_cluster"
        ]
        .value_counts()
        .sort_index()
    )

    print(
        "\n=== SKILL CLUSTER RESULT ==="
    )

    print(
        f"Selected K: "
        f"{best_k}"
    )

    for cluster_id, count in (
        cluster_counts.items()
    ):

        print(
            f"Cluster {cluster_id}: "
            f"{count} players"
        )

    return (
        result,
        kmeans
    )

# ============================================================
# INTERPRET SKILL CLUSTERS
# ============================================================

def interpret_skill_clusters(
    skill_clustered,
    rank_by
):
    """
    Assign human-readable names to the discovered
    first-level skill clusters.

    The cluster with the highest average of the
    `rank_by` column is interpreted as the
    higher-performance group.

    The cluster with the lowest average of the
    `rank_by` column is interpreted as the
    lower-performance group.

    IMPORTANT:
    The ranking column is used for interpretation
    only. It was NOT provided to K-Means, so changing
    it changes which group is called higher, never
    who is in which group.

    PaddlePad passes rank_by="rally_points": each
    player's rally rating, calculated rally by rally in
    the app from how every rally ended and who ended
    it. On a synthetic pool whose players had a hidden
    true ability, group numbers ranked by rally points
    followed that ability closely (Spearman 0.81 over
    ten K-Means random starts).

    The same column is what
    residualize_playstyle_features removes from the
    playstyle features.
    """

    if rank_by not in skill_clustered.columns:
        raise ValueError(
            f"skill_clustered must contain '{rank_by}' "
            f"to rank the skill clusters by."
        )

    if skill_clustered[rank_by].isna().any():
        raise ValueError(
            f"Every player needs a '{rank_by}' value "
            f"to rank the skill clusters by."
        )

    cluster_scores = (
        skill_clustered
        .groupby(
            "skill_cluster"
        )[
            rank_by
        ]
        .mean()
        .sort_values()
    )

    cluster_ids = (
        cluster_scores
        .index
        .tolist()
    )

    labels = {}

    # --------------------------------------------------------
    # Two-cluster case
    # --------------------------------------------------------

    if len(cluster_ids) == 2:

        labels[
            cluster_ids[0]
        ] = "Developing / Lower-Performance"

        labels[
            cluster_ids[1]
        ] = "Higher-Performance"

    # --------------------------------------------------------
    # Three-cluster case
    # --------------------------------------------------------

    elif len(cluster_ids) == 3:

        labels[
            cluster_ids[0]
        ] = "Developing / Lower-Performance"

        labels[
            cluster_ids[1]
        ] = "Intermediate-Performance"

        labels[
            cluster_ids[2]
        ] = "Higher-Performance"

    # --------------------------------------------------------
    # Generic fallback for K > 3
    # --------------------------------------------------------

    else:

        for position, cluster_id in enumerate(
            cluster_ids
        ):

            labels[
                cluster_id
            ] = (
                f"Performance Group "
                f"{position + 1}"
            )

    return labels


# ============================================================
# ADD SKILL GROUP LABELS
# ============================================================

def apply_skill_cluster_labels(
    skill_clustered,
    cluster_labels
):
    """
    Add human-readable skill-group labels to the
    discovered cluster assignments.
    """

    result = skill_clustered.copy()

    result[
        "skill_group"
    ] = (
        result[
            "skill_cluster"
        ]
        .map(
            cluster_labels
        )
    )

    return result

# ============================================================
# LEVEL 2: PLAYSTYLE K SELECTION
# ============================================================

def choose_playstyle_k(
    skill_clustered,
    skill_group,
    k_min=2,
    k_max=5,
    random_state=42,
    features=None
):
    """
    Test K values for second-level playstyle clustering
    inside one discovered skill group.

    The first-level skill group is already known.

    Example:

        Developing / Lower-Performance
                    ↓
              K-Means #2
                    ↓
              playstyle groups

    `features` names the columns K-Means sees. By default
    the standardized playstyle features; PaddlePad passes
    the component scores from
    feature_engineering.extract_playstyle_components.
    """

    # --------------------------------------------------------
    # Select the players belonging to this skill group
    # --------------------------------------------------------

    group_data = (
        skill_clustered[
            skill_clustered[
                "skill_group"
            ]
            ==
            skill_group
        ]
        .copy()
        .reset_index(drop=True)
    )

    if len(group_data) < 3:
        raise ValueError(
            f"Not enough players in "
            f"'{skill_group}' for clustering."
        )

    # --------------------------------------------------------
    # Extract standardized behavioral features
    # --------------------------------------------------------

    if features is None:
        features = PLAYSTYLE_CLUSTERING_FEATURES

    X = group_data[
        features
    ].copy()

    maximum_k = min(
        k_max,
        len(group_data) - 1
    )

    print(
        f"\n=== PLAYSTYLE K SELECTION: "
        f"{skill_group} ==="
    )

    best_k, results = score_k_values(
        X,
        k_min,
        maximum_k,
        random_state
    )

    print(
        f"\nBest K for "
        f"{skill_group}: "
        f"K={best_k}"
    )

    print(
        f"Best Silhouette Score: "
        f"{results[best_k]['silhouette']:.3f}"
    )

    return (
        group_data,
        best_k,
        results
    )


# ============================================================
# LEVEL 2: RUN PLAYSTYLE K-MEANS
# ============================================================

def cluster_playstyles(
    group_data,
    best_k,
    random_state=42,
    features=None
):
    """
    Run second-level K-Means inside one skill group.

    `features` names the columns K-Means sees, as in
    choose_playstyle_k.
    """

    if features is None:
        features = PLAYSTYLE_CLUSTERING_FEATURES

    X = group_data[
        features
    ].copy()

    kmeans = KMeans(
        n_clusters=best_k,
        random_state=random_state,
        n_init=20
    )

    labels = (
        kmeans.fit_predict(X)
    )

    result = group_data.copy()

    result[
        "playstyle_cluster"
    ] = labels

    cluster_counts = (
        result[
            "playstyle_cluster"
        ]
        .value_counts()
        .sort_index()
    )

    return (
        result,
        kmeans,
        cluster_counts
    )

# ============================================================
# PLAYSTYLE STABILITY
# ============================================================

def measure_playstyle_stability(
    skill_clustered,
    skill_group,
    random_states=None,
    k_min=2,
    k_max=5,
    features=None
):
    """
    Test the stability of Level 2 playstyle clustering
    across multiple random seeds.

    We check:

        1. Which K is selected?
        2. Silhouette score for each run
        3. Cluster agreement using ARI

    The first run is used as the reference partition.

    `features` names the columns K-Means sees, as in
    choose_playstyle_k; pass the same columns the
    real clustering used, or this tests a different setup.
    """

    if features is None:
        features = PLAYSTYLE_CLUSTERING_FEATURES

    if random_states is None:
        random_states = [
            1,
            7,
            21,
            42,
            100
        ]

    # --------------------------------------------------------
    # Select the requested skill group
    # --------------------------------------------------------

    group_data = (
        skill_clustered[
            skill_clustered[
                "skill_group"
            ] == skill_group
        ]
        .copy()
        .reset_index(drop=True)
    )

    if len(group_data) < 3:
        raise ValueError(
            f"Not enough players in '{skill_group}'."
        )

    X = group_data[
        features
    ].copy()

    results = {}

    print(
        f"\n=== PLAYSTYLE STABILITY: "
        f"{skill_group} ==="
    )

    # --------------------------------------------------------
    # Run multiple seeds
    # --------------------------------------------------------

    for seed in random_states:

        best_k = None
        best_score = -1
        best_labels = None

        maximum_k = min(
            k_max,
            len(group_data) - 1
        )

        for k in range(
            k_min,
            maximum_k + 1
        ):

            model = KMeans(
                n_clusters=k,
                random_state=seed,
                n_init=20
            )

            labels = (
                model.fit_predict(X)
            )

            score = silhouette_score(
                X,
                labels
            )

            if score > best_score:

                best_score = score
                best_k = k
                best_labels = labels

        results[seed] = {
            "k": best_k,
            "silhouette": best_score,
            "labels": best_labels
        }

        print(
            f"Seed {seed}: "
            f"K={best_k} | "
            f"Silhouette={best_score:.3f}"
        )

    # --------------------------------------------------------
    # Determine most common K
    # --------------------------------------------------------

    selected_k_values = [
        result["k"]
        for result in results.values()
    ]

    k_counts = (
        pd.Series(
            selected_k_values
        )
        .value_counts()
        .sort_index()
    )

    most_common_k = (
        k_counts
        .idxmax()
    )

    most_common_count = (
        k_counts
        .max()
    )

    print(
        f"\nMost common K: "
        f"{most_common_k} "
        f"({most_common_count}/"
        f"{len(random_states)} runs)"
    )

    # --------------------------------------------------------
    # Compare cluster assignments
    # --------------------------------------------------------

    reference_seed = random_states[0]

    reference = results[
        reference_seed
    ]

    print(
        "\nCluster agreement "
        f"against seed {reference_seed}:"
    )

    for seed in random_states:

        if seed == reference_seed:
            continue

        current = results[seed]

        if current["k"] != reference["k"]:

            print(
                f"  Seed {seed}: "
                f"K differs "
                f"({current['k']} vs "
                f"{reference['k']})"
            )

            continue

        ari = adjusted_rand_score(
            reference["labels"],
            current["labels"]
        )

        print(
            f"  Seed {seed}: "
            f"ARI={ari:.3f}"
        )

    # --------------------------------------------------------
    # Average metrics
    # --------------------------------------------------------

    silhouette_values = [
        result["silhouette"]
        for result in results.values()
    ]

    print(
        "\nMetric stability:"
    )

    print(
        f"  Average Silhouette: "
        f"{np.mean(silhouette_values):.3f}"
    )

    print(
        f"  Silhouette Std: "
        f"{np.std(silhouette_values):.3f}"
    )

    return results

# ============================================================
# AUTOMATIC PLAYSTYLE ARCHETYPE INTERPRETATION
# ============================================================

# ============================================================
# ARCHETYPE NAMING VOCABULARY
# ============================================================
#
# A name is built as:
#
#     {skill prefix} {0-N trait adjectives} {identity noun}
#
# e.g. "Advanced Clean Net Player" or
# "Developing All-Court Player" -- always a grammatically
# complete phrase (adjectives, then a noun), never a bare list
# of unrelated words.
#
# TRAIT_DESCRIPTORS supply the adjectives: how the player plays
# (precision, consistency). IDENTITY_DESCRIPTORS
# supply the single noun that anchors the name: what kind of
# player they are, based on shot selection. Splitting these two
# roles is what keeps combinations readable -- two adjectives
# plus one noun always reads as English, whereas stacking
# arbitrary adjectives together does not.
#
# Naming compares a cluster only to its own siblings (other
# style clusters in the same skill group), using the thirteen
# z-scored playstyle features (K-Means itself may cluster on
# component scores; see interpret_playstyle_clusters) -- this is
# dataset-agnostic by construction, unlike fixed absolute
# thresholds.
#
# drop_usage_rate and the two *_std preference features are
# deliberately left out of naming (not the clustering feature
# set): they overlap heavily with the two identity features
# below and would just add redundant wording.
#
# aggression_mean is left out of naming too, though it still
# shapes the clusters. It is winners / (winners + unforced
# errors): how cleanly a player finishes, not how often they
# attack, so "Patient" / "Aggressive" said something it does
# not measure. It also ranks players almost exactly opposite to
# error_to_winner_ratio (-0.96 on the pklmart players), so the
# precision words already carry what it says. Taking it out of
# the clustering failed a check on the simulated pool, so only
# its words were removed.
# ============================================================

# Words are kept neutral: a name is a label a player wears, not a
# verdict. The high side of three spread features shares one
# word, "Unpredictable", since each says only that something
# changes a lot from match to match (the app names the exact
# measurement beside the word). Two sides have no word at all
# (None): fewer drops landing, and more mistakes per winner.
# Mistakes are shown in the app as things to work on instead.
# A trait whose side has no word is skipped when naming, and
# the next-biggest difference supplies the word.
TRAIT_DESCRIPTORS = {
    "drop_efficiency_mean": (None, "Precise"),
    "error_to_winner_ratio": ("Clean", None),
    "aggression_std": ("Steady", "Unpredictable"),
    "drop_efficiency_std": ("Reliable", "Inconsistent"),
    "winner_rate_std": ("Consistent", "Streaky"),
    "general_error_rate_std": ("Composed", "Unpredictable"),
    "dink_error_rate_std": ("Solid-Net", "Unpredictable")
}

IDENTITY_DESCRIPTORS = {
    "drop_preference_rate_mean": ("Driver", "Dropper"),
    "net_game_preference_rate_mean": ("Power Player", "Net Player")
}

DEFAULT_IDENTITY_NOUN = "All-Court Player"

# Which FAMILY each trait belongs to. A name takes at most one
# adjective per family.
#
# Five of the seven traits describe five different spread
# features -- whether the finishing varies, whether the drops
# do, whether the scoring does -- and each is a genuinely
# different measurement. To a reader they are the same word. A
# cluster above average on two of them used to be named
# "Advanced Streaky Inconsistent Driver", which nobody can read
# aloud and which says one thing twice. One word per family
# keeps the real detail (a precision word AND a consistency
# word still both appear) while never repeating itself.
TRAIT_FAMILIES = {
    "drop_efficiency_mean": "precision",
    "error_to_winner_ratio": "precision",
    "aggression_std": "consistency",
    "drop_efficiency_std": "consistency",
    "winner_rate_std": "consistency",
    "general_error_rate_std": "consistency",
    "dink_error_rate_std": "consistency"
}

# Cohen's d convention treats |z| >= 0.2 as at least a "small"
# effect size. Below that, a cluster isn't meaningfully
# different from its skill group's average on that feature, so
# it's not worth naming after it.
MEANINGFUL_EFFECT_SIZE = 0.2


def get_playstyle_centroids(
    clustered_data,
    raw_playstyle_features
):
    """
    Compute playstyle cluster centroids from each player's RAW
    (pre-residualization, pre-scaling) feature values.

    This intentionally does NOT reconstruct centroids from the
    K-Means input space via scaler.inverse_transform: several
    playstyle features are residualized against skill
    before clustering (see
    feature_engineering.residualize_playstyle_features), so
    their scaled/residual values are small deltas around zero,
    not human-readable percentages or rates. Averaging each
    player's original values instead keeps the reported
    centroids honest and interpretable.

    Returns:
        DataFrame containing one row per playstyle cluster.
    """

    merged = (
        clustered_data[
            [
                "player_id",
                "playstyle_cluster"
            ]
        ]
        .merge(
            raw_playstyle_features,
            on="player_id",
            how="left",
            validate="one_to_one"
        )
    )

    centroids = (
        merged
        .groupby(
            "playstyle_cluster"
        )[
            PLAYSTYLE_CLUSTERING_FEATURES
        ]
        .mean()
    )

    return centroids


# Known skill-group labels, mapped to a short prefix word.
# interpret_skill_clusters can produce more than these two (a
# 3-way split adds "Intermediate-Performance"; K > 3 falls back
# to "Performance Group N") -- both of those are handled by the
# fallback branch below, not hardcoded here, so this keeps
# working if the number of skill groups changes.
_KNOWN_SKILL_GROUP_PREFIXES = {
    "Developing / Lower-Performance": "Developing",
    "Higher-Performance": "Advanced"
}


def _skill_group_prefix(
    skill_group
):
    """
    Short word used to prefix a generated archetype name.
    Unlike the naming logic itself, this is just cosmetic --
    it does not gate which descriptors get chosen.

    Falls back to a shortened version of whatever
    interpret_skill_clusters produced (e.g.
    "Intermediate-Performance" -> "Intermediate",
    "Performance Group 3" -> "Group 3") so naming keeps working
    if skill K ever selects more than 2-3 groups.
    """

    if skill_group in _KNOWN_SKILL_GROUP_PREFIXES:
        return _KNOWN_SKILL_GROUP_PREFIXES[skill_group]

    return (
        skill_group
        .replace("-Performance", "")
        .replace("Performance Group", "Group")
    )


def _pick_identity(
    scaled_profile
):
    """
    Pick the single noun that anchors an archetype name, from
    whichever identity feature (shot-selection tendency) is
    furthest from this skill group's average. Falls back to a
    generic noun if neither identity feature is meaningfully
    different from average.

    Returns (noun, feature, z). The feature and its z come back
    too so the app can show WHY the noun was chosen -- the
    player's own number for it, beside their group's average --
    rather than asserting the name and leaving them to take it
    on faith. `feature` is None for the generic fallback, which
    was chosen precisely because nothing stood out.
    """

    best_magnitude = 0.0
    best_noun = DEFAULT_IDENTITY_NOUN
    best_feature = None
    best_z = 0.0

    for feature, (low_label, high_label) in (
        IDENTITY_DESCRIPTORS.items()
    ):

        z = scaled_profile[feature]

        if abs(z) > best_magnitude:

            best_magnitude = abs(z)
            best_feature = feature
            best_z = z

            best_noun = (
                high_label
                if z >= 0
                else low_label
            )

    if best_magnitude < MEANINGFUL_EFFECT_SIZE:
        return (
            DEFAULT_IDENTITY_NOUN,
            None,
            0.0
        )

    return (
        best_noun,
        best_feature,
        best_z
    )


def _pick_identity_noun(
    scaled_profile
):
    """
    The noun alone. Kept because naming only needs the word.
    """

    noun, _, _ = _pick_identity(
        scaled_profile
    )

    return noun


def choose_playstyle_traits(
    scaled_profile,
    max_traits=2
):
    """
    The traits a name is built from: the strongest one per
    family, furthest from this skill group's average first,
    ignoring anything below MEANINGFUL_EFFECT_SIZE.

    One per family is what stops a name saying the same thing
    twice -- see TRAIT_FAMILIES. Returns dicts rather than bare
    words, because these travel out to the app as the evidence
    for the name: which measurement, which way, and how far.
    """

    chosen = []
    families_used = set()

    for magnitude, label, feature in _rank_trait_descriptors(
        scaled_profile
    ):

        if magnitude < MEANINGFUL_EFFECT_SIZE:
            break

        family = TRAIT_FAMILIES[feature]

        if family in families_used:
            continue

        families_used.add(family)

        chosen.append({
            "label": label,
            "feature": feature,
            "family": family,
            "direction": (
                "above"
                if scaled_profile[feature] >= 0
                else "below"
            ),
            "z": round(
                float(scaled_profile[feature]),
                3
            )
        })

        if len(chosen) == max_traits:
            break

    return chosen


def describe_playstyle_name(
    scaled_profile,
    max_traits=2
):
    """
    Everything behind one archetype name: the adjectives with
    the measurement each came from, and the noun with the
    shot-selection feature that anchored it.

    The name itself asserts; this is what lets it be checked.
    """

    traits = choose_playstyle_traits(
        scaled_profile,
        max_traits=max_traits
    )

    noun, feature, z = _pick_identity(
        scaled_profile
    )

    return traits + [{
        "label": noun,
        "feature": feature,
        "family": "identity",
        "direction": (
            "above"
            if z >= 0
            else "below"
        ),
        "z": round(float(z), 3)
    }]


def _rank_trait_descriptors(
    scaled_profile
):
    """
    Rank every trait feature by how far this cluster sits from
    its skill group's average (in standard deviations),
    furthest first. Returns (magnitude, label, feature) triples
    -- the feature travels with the label so callers can tell
    which family a word came from, and so a name can say what it
    was built from.

    A side with no word (None in TRAIT_DESCRIPTORS) is left out,
    so the next-biggest difference names the cluster instead.
    """

    scored = []

    for feature, (low_label, high_label) in (
        TRAIT_DESCRIPTORS.items()
    ):

        z = scaled_profile[feature]

        label = (
            high_label
            if z >= 0
            else low_label
        )

        if label is None:
            continue

        scored.append(
            (abs(z), label, feature)
        )

    scored.sort(
        key=lambda scored_pair: scored_pair[0],
        reverse=True
    )

    return scored


# ============================================================
# SKILL-AWARE PLAYSTYLE ARCHETYPE NAMING
# ============================================================

def generate_playstyle_archetype_name(
    scaled_profile,
    skill_group,
    max_traits=2
):
    """
    Generate a human-readable playstyle name from a cluster's
    centroid in the z-scored, skill-residualized playstyle
    features (one row of the scaled centroids computed in
    interpret_playstyle_clusters).

    The name always has the shape:

        {skill prefix} {0 to max_traits adjectives} {noun}

    which reads as a grammatically ordinary phrase no matter
    how many adjectives are included, rather than a list of
    loosely related words. `max_traits` is raised by
    interpret_playstyle_clusters when two clusters would
    otherwise generate the same name -- e.g. if a skill group
    is later split into more style clusters than this
    vocabulary can uniquely describe with just 2 adjectives.

    Each value in `scaled_profile` is already "number of
    standard deviations from this skill group's average" for
    that feature -- a magnitude that means the same thing
    regardless of the feature's original units or the dataset
    it came from.

    The naming layer does NOT affect K-Means -- it only
    describes clusters after the fact.
    """

    traits = [
        trait["label"]
        for trait in choose_playstyle_traits(
            scaled_profile,
            max_traits=max_traits
        )
    ]

    noun = _pick_identity_noun(
        scaled_profile
    )

    prefix = _skill_group_prefix(
        skill_group
    )

    parts = [prefix] + traits + [noun]

    return " ".join(parts)


def _generate_unique_playstyle_names(
    scaled_centroids,
    skill_group,
    traits_out=None
):
    """
    Generate archetype names for every cluster in one skill
    group, resolving any collisions by asking for MORE
    descriptive detail (more adjectives) rather than jumping
    straight to a meaningless "Type 2" suffix.

    This is what lets naming keep working if a skill group is
    ever split into more style clusters than 2 adjectives can
    tell apart -- as clusters increase, this tries one adjective
    per family before it ever resorts to numbering duplicates.
    """

    cluster_ids = list(
        scaled_centroids.index
    )

    # Two, then one per family. There is no point trying more: a
    # name takes at most one adjective per family, so a longer
    # attempt would produce the same words. Breaking a tie by
    # stacking two words from the same family is exactly what
    # TRAIT_FAMILIES removed, and it must not come back in through
    # this door -- a numbered duplicate below is honest,
    # "Streaky Inconsistent" is not.
    families = len(set(TRAIT_FAMILIES.values()))
    trait_counts_to_try = sorted({min(2, families), families})

    archetype_map = {}

    def record(max_traits):
        """
        The evidence behind the names just generated, for the
        caller that asked for it. Recorded at the detail level
        that actually won, so it always matches the words in
        the name rather than a level that was tried and
        rejected.
        """

        if traits_out is None:
            return

        traits_out.clear()

        for cluster_id in cluster_ids:

            traits_out[
                int(cluster_id)
            ] = describe_playstyle_name(
                scaled_centroids.loc[cluster_id],
                max_traits=max_traits
            )

    for max_traits in trait_counts_to_try:

        archetype_map = {
            int(cluster_id): generate_playstyle_archetype_name(
                scaled_centroids.loc[cluster_id],
                skill_group,
                max_traits=max_traits
            )
            for cluster_id in cluster_ids
        }

        all_unique = (
            len(set(archetype_map.values()))
            ==
            len(cluster_ids)
        )

        if all_unique:
            record(max_traits)
            return archetype_map

    # ----------------------------------------------------
    # Even the full trait vocabulary couldn't tell every
    # cluster apart (rare -- only possible with many nearly
    # identical clusters). Number the remaining duplicates
    # as a last resort.
    # ----------------------------------------------------

    record(trait_counts_to_try[-1])

    used_names = {}

    for cluster_id, name in list(
        archetype_map.items()
    ):

        if name not in used_names:

            used_names[name] = 1

        else:

            used_names[name] += 1

            archetype_map[
                cluster_id
            ] = (
                f"{name} "
                f"Type {used_names[name]}"
            )

    return archetype_map


# ============================================================
# INTERPRET PLAYSTYLE CLUSTERS
# ============================================================

def interpret_playstyle_clusters(
    group_data,
    clustered_data,
    raw_playstyle_features,
    traits_out=None
):
    """
    Interpret the playstyle clusters after K-Means.

    The cluster labels are generated from the cluster
    statistics and the skill-group context.
    """

    # --------------------------------------------------------
    # Identify the skill group
    # --------------------------------------------------------

    skill_group = (
        group_data[
            "skill_group"
        ]
        .iloc[0]
    )

    # --------------------------------------------------------
    # Raw centroids: each cluster's average of the players' own,
    # un-adjusted values. Returned for the caller to show.
    # --------------------------------------------------------

    centroids = (
        get_playstyle_centroids(
            clustered_data,
            raw_playstyle_features
        )
    )

    # --------------------------------------------------------
    # Scaled centroids: each cluster's mean of the thirteen
    # z-scored playstyle features. K-Means may have clustered
    # on component scores instead (see
    # feature_engineering.extract_playstyle_components), but
    # names are read here because a feature can be named and a
    # component cannot. Used ONLY for naming: this is what
    # distinguishes each cluster from its siblings, already
    # skill-adjusted and unit-free.
    # --------------------------------------------------------

    scaled_centroids = (
        clustered_data
        .groupby(
            "playstyle_cluster"
        )[
            PLAYSTYLE_CLUSTERING_FEATURES
        ]
        .mean()
    )

    # --------------------------------------------------------
    # Generate names (escalates detail level to resolve
    # collisions before falling back to numbering duplicates --
    # see _generate_unique_playstyle_names)
    # --------------------------------------------------------

    archetype_map = _generate_unique_playstyle_names(
        scaled_centroids,
        skill_group,
        traits_out=traits_out
    )

    return (
        archetype_map,
        centroids,
        scaled_centroids
    )

# ============================================================
# APPLY PLAYSTYLE ARCHETYPE LABELS
# ============================================================

def apply_playstyle_archetypes(
    clustered_data,
    archetype_map,
    traits_map=None
):
    """
    Add the automatically generated archetype name to
    every player based on their playstyle cluster.

    With `traits_map`, the evidence behind that name travels
    with it as `playstyle_traits`: which measurements chose the
    words, which way each pointed, and how far from the skill
    group's average it sat. A name a player cannot check is
    barely better than no name.
    """

    result = clustered_data.copy()

    result[
        "playstyle_archetype"
    ] = (
        result[
            "playstyle_cluster"
        ]
        .map(
            archetype_map
        )
    )

    if traits_map is not None:

        result[
            "playstyle_traits"
        ] = (
            result[
                "playstyle_cluster"
            ]
            .map(
                traits_map
            )
        )

    return result



# ============================================================
# FINAL PADDLEPAD PLAYER PROFILES
# ============================================================

def build_final_player_profiles(
    developing_playstyles,
    higher_playstyles,
    playstyle_features
):
    """
    Build one clean final record per player.

    The final result contains:

        player_id
        skill_group
        skill_cluster
        playstyle_cluster
        playstyle_archetype

    Plus the player's own playstyle evidence.
    """

    # ========================================================
    # 1. COMBINE THE TWO PLAYSTYLE BRANCHES
    # ========================================================

    playstyle_assignments = pd.concat(
        [
            developing_playstyles[
                [
                    "player_id",
                    "skill_group",
                    "skill_cluster",
                    "playstyle_cluster",
                    "playstyle_archetype"
                ]
            ],

            higher_playstyles[
                [
                    "player_id",
                    "skill_group",
                    "skill_cluster",
                    "playstyle_cluster",
                    "playstyle_archetype"
                ]
            ]
        ],
        ignore_index=True
    )

    # ========================================================
    # 2. SELECT PLAYER'S OWN EVIDENCE
    # ========================================================

    evidence_columns = [
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
        "net_game_preference_rate_std"
    ]

    player_evidence = playstyle_features[
        [
            "player_id",
            *evidence_columns
        ]
    ].copy()

    # ========================================================
    # 3. VERIFY UNIQUE PLAYER IDS
    # ========================================================

    if playstyle_assignments[
        "player_id"
    ].duplicated().any():

        raise ValueError(
            "Duplicate player IDs found in playstyle assignments."
        )

    if player_evidence[
        "player_id"
    ].duplicated().any():

        raise ValueError(
            "Duplicate player IDs found in player evidence."
        )

    # ========================================================
    # 4. MERGE PLAYER ASSIGNMENT + PLAYER EVIDENCE
    # ========================================================

    final_profiles = playstyle_assignments.merge(
        player_evidence,
        on="player_id",
        how="left",
        validate="one_to_one"
    )

    # ========================================================
    # 5. VERIFY EVERY PLAYER HAS EVIDENCE
    # ========================================================

    missing_evidence = (
        final_profiles[
            evidence_columns
        ]
        .isnull()
        .any(axis=1)
    )

    if missing_evidence.any():

        missing_players = (
            final_profiles.loc[
                missing_evidence,
                "player_id"
            ]
            .tolist()
        )

        raise ValueError(
            "Missing playstyle evidence for players: "
            + ", ".join(missing_players)
        )

    # ========================================================
    # 6. SORT
    # ========================================================

    final_profiles = (
        final_profiles
        .sort_values(
            "player_id"
        )
        .reset_index(
            drop=True
        )
    )

    return final_profiles
