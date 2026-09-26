import numpy as np
import pandas as pd

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA


# ============================================================
# FEATURE GROUPS
# ============================================================

MEAN_FEATURES = [
    "winner_rate_mean",
    "general_error_rate_mean",
    "dink_error_rate_mean",
    "drop_efficiency_mean",
    "aggression_mean"
]

STD_FEATURES = [
    "winner_rate_std",
    "general_error_rate_std",
    "dink_error_rate_std",
    "drop_efficiency_std",
    "aggression_std"
]

ALL_FEATURES = (
    MEAN_FEATURES +
    STD_FEATURES
)


# ============================================================
# CREATE PLAYER ML FEATURES
# ============================================================

def create_ml_features(player_profiles):
    """
    Create the 10 behavioral features used for future ML.

    This function does NOT:
        - scale the features
        - calculate skill score
        - perform K-Means
    """

    df = player_profiles.copy()

    # --------------------------------------------------------
    # Validate required columns
    # --------------------------------------------------------

    missing_columns = [
        column
        for column in ALL_FEATURES
        if column not in df.columns
    ]

    if missing_columns:

        raise ValueError(
            "Missing required feature columns: "
            + ", ".join(
                missing_columns
            )
        )

    # --------------------------------------------------------
    # Select features
    # --------------------------------------------------------

    ml_features = df[
        [
            "player_id",
            *ALL_FEATURES
        ]
    ].copy()

    # --------------------------------------------------------
    # Handle invalid values
    # --------------------------------------------------------

    ml_features = (
        ml_features
        .replace(
            [np.inf, -np.inf],
            np.nan
        )
        .fillna(0.0)
    )

    return ml_features


# ============================================================
# PREPARE ML-ORIENTED FEATURE DIRECTIONS
# ============================================================

def prepare_for_ml(ml_features):
    """
    Orient the features so their direction is meaningful
    before StandardScaler.

    Error rates:
        lower = better
        therefore inverted.

    Standard deviations:
        lower = more consistent
        therefore inverted.

    This function does NOT scale.
    """

    ml_data = ml_features.copy()

    # --------------------------------------------------------
    # Error direction
    # --------------------------------------------------------

    ml_data[
        "general_error_rate_mean"
    ] *= -1

    ml_data[
        "dink_error_rate_mean"
    ] *= -1

    # --------------------------------------------------------
    # Consistency direction
    # --------------------------------------------------------

    for feature in STD_FEATURES:

        ml_data[
            feature
        ] *= -1

    return ml_data


# ============================================================
# STANDARDIZE FEATURES
# ============================================================

def scale_ml_features(
    ml_oriented_features
):
    """
    Standardize the 10 ML-oriented features.

    StandardScaler transforms each feature so that:

        mean ≈ 0
        standard deviation ≈ 1

    This prevents features with larger numerical ranges
    from dominating distance-based algorithms such as
    K-Means.

    Returns:

        scaled_features
        scaler
    """

    # --------------------------------------------------------
    # Separate ID from numerical features
    # --------------------------------------------------------

    player_ids = (
        ml_oriented_features[
            "player_id"
        ].copy()
    )

    feature_data = (
        ml_oriented_features[
            ALL_FEATURES
        ].copy()
    )

    # --------------------------------------------------------
    # Fit scaler and transform
    # --------------------------------------------------------

    scaler = StandardScaler()

    scaled_data = (
        scaler.fit_transform(
            feature_data
        )
    )

    # --------------------------------------------------------
    # Rebuild DataFrame
    # --------------------------------------------------------

    scaled_features = pd.DataFrame(
        scaled_data,
        columns=ALL_FEATURES
    )

    scaled_features.insert(
        0,
        "player_id",
        player_ids.reset_index(
            drop=True
        )
    )

    return (
        scaled_features,
        scaler
    )


# ============================================================
# PRINT FEATURE INFORMATION
# ============================================================

def print_feature_information(
    ml_features
):

    print(
        "\n=== ML FEATURE DATASET ==="
    )

    print(
        f"Players: "
        f"{len(ml_features)}"
    )

    print(
        f"Features: "
        f"{len(ml_features.columns) - 1}"
    )

    print(
        "\n=== FEATURES ==="
    )

    for feature in ml_features.columns:

        if feature == "player_id":
            continue

        if feature in MEAN_FEATURES:

            print(
                f"  {feature:<30}"
                f"[MEAN]"
            )

        elif feature in STD_FEATURES:

            print(
                f"  {feature:<30}"
                f"[CONSISTENCY]"
            )


# ============================================================
# PRINT FEATURE DIRECTIONS
# ============================================================

def print_feature_directions(
    ml_features,
    ml_oriented_features
):

    print(
        "\n=== FEATURE DIRECTIONS ==="
    )

    print(
        "\nHuman-readable:"
    )

    print(
        "  Winner rate mean       -> higher = more winners"
    )

    print(
        "  General error mean     -> lower = better"
    )

    print(
        "  Dink error mean        -> lower = better"
    )

    print(
        "  Drop efficiency mean   -> higher = better"
    )

    print(
        "  Aggression mean        -> higher = more aggressive"
    )

    print(
        "\nConsistency:"
    )

    print(
        "  Standard deviation     -> lower = more consistent"
    )

    print(
        "\nML-oriented representation:"
    )

    print(
        "  Error means are inverted"
    )

    print(
        "  Standard deviations are inverted"
    )

    print(
        "  Higher ML value = more of the represented characteristic"
    )

    # --------------------------------------------------------
    # Show example
    # --------------------------------------------------------

    print(
        "\n=== BEFORE vs ML-ORIENTED EXAMPLE ==="
    )

    example_columns = [

        "winner_rate_mean",

        "general_error_rate_mean",

        "dink_error_rate_mean",

        "drop_efficiency_mean",

        "winner_rate_std",

        "general_error_rate_std",

        "dink_error_rate_std"
    ]

    example = pd.DataFrame({

        "Feature":
            example_columns,

        "Original":
            [
                ml_features.iloc[0][feature]
                for feature in example_columns
            ],

        "ML Oriented":
            [
                ml_oriented_features.iloc[0][feature]
                for feature in example_columns
            ]
    })

    print(
        example.to_string(
            index=False
        )
    )


# ============================================================
# PRINT STANDARDIZATION SUMMARY
# ============================================================

def print_scaling_summary(
    scaled_features
):
    """
    Show the mean and standard deviation after scaling.

    Ideally every feature should be approximately:

        mean = 0
        std  = 1
    """

    summary = (
        scaled_features
        .drop(
            columns=["player_id"]
        )
        .agg(
            ["mean", "std"]
        )
        .transpose()
    )

    print(
        "\n=== STANDARDIZATION SUMMARY ==="
    )

    print(
        summary.to_string()
    )


# ============================================================
# PRINT ORIGINAL FEATURE SUMMARY
# ============================================================

def print_feature_summary(
    ml_features
):

    print(
        "\n=== FEATURE SUMMARY ==="
    )

    summary = (
        ml_features
        .drop(
            columns=["player_id"]
        )
        .describe()
        .transpose()
    )

    print(
        summary[
            [
                "mean",
                "std",
                "min",
                "max"
            ]
        ].to_string()
    )


# ============================================================
# PLAYSTYLE FEATURES
# ============================================================

PLAYSTYLE_FEATURES = [
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


def create_playstyle_features(
    player_profiles
):
    """
    Create behavioral features specifically for the
    second-level playstyle clustering.

    These are derived entirely from the statistics already
    collected by the umpire UI.
    """

    df = player_profiles.copy()

    # --------------------------------------------------------
    # Drop usage rate
    #
    # Approximate number of drop attempts per minute.
    # --------------------------------------------------------

    safe_duration = np.maximum(
        df["average_match_duration"],
        1.0
    )

    df["drop_usage_rate"] = (
        df["average_drop_attempts"] /
        safe_duration
    )

    # --------------------------------------------------------
    # Error-to-winner ratio
    #
    # Higher value = more errors relative to winners.
    # --------------------------------------------------------

    df["error_to_winner_ratio"] = (
        df["average_unforced_errors"] /
        np.maximum(
            df["average_winners"],
            1.0
        )
    )

    # --------------------------------------------------------
    # Select only playstyle features
    # --------------------------------------------------------

    playstyle_features = df[
        [
            "player_id",
            *PLAYSTYLE_FEATURES
        ]
    ].copy()

    # --------------------------------------------------------
    # Handle invalid values
    # --------------------------------------------------------

    playstyle_features = (
        playstyle_features
        .replace(
            [np.inf, -np.inf],
            np.nan
        )
        .fillna(0.0)
    )

    return playstyle_features

def prepare_playstyle_features(
    playstyle_features
):
    """
    Prepare descriptive playstyle features.

    Unlike the skill model, playstyle features are not
    interpreted as inherently good or bad.

    We keep:
        - aggression in its natural direction
        - error-to-winner ratio in its natural direction
        - standard deviations in their natural direction

    This allows K-Means to discover behavioral differences
    rather than simply ranking players by performance.
    """

    return playstyle_features.copy()


# ============================================================
# RESIDUALIZE SKILL-CORRELATED PLAYSTYLE FEATURES
# ============================================================

FEATURES_TO_RESIDUALIZE = [
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


def residualize_playstyle_features(
    playstyle_features_with_skill,
    features_to_residualize=None,
    group_column="skill_group",
    target_column="skill_score"
):
    """
    Replace each listed feature with its residual after
    regressing it against `target_column`, fit separately
    within each `group_column` group.

    This removes the LINEAR relationship between a feature
    and skill so that Level 2 clustering finds style
    differences rather than re-discovering skill variance
    under a different name.

    Features not listed in `features_to_residualize` are
    left unchanged. The default list currently covers every
    playstyle feature: earlier testing against synthetic data
    suggested a couple of features (drop_efficiency_std,
    the drop/net-game preference features) were safely
    independent of skill, but real match data (see
    pklmart_import.py) showed real, non-trivial correlation
    for those too -- so nothing is assumed safe without
    per-dataset verification, and everything gets corrected
    uniformly.
    """

    if features_to_residualize is None:
        features_to_residualize = FEATURES_TO_RESIDUALIZE

    df = playstyle_features_with_skill.copy()

    for feature in features_to_residualize:

        residual = pd.Series(
            index=df.index,
            dtype=float
        )

        for _, group_df in df.groupby(group_column):

            x = group_df[target_column].to_numpy()
            y = group_df[feature].to_numpy()

            # Too few players or no skill variance in this
            # group: regression is undefined, leave unchanged.
            if len(group_df) < 3 or np.std(x) == 0:
                residual.loc[group_df.index] = y
                continue

            slope, intercept = np.polyfit(x, y, 1)

            predicted = intercept + slope * x

            residual.loc[group_df.index] = y - predicted

        df[feature] = residual

    return df


def scale_playstyle_features(
    playstyle_features
):
    """
    Standardize the playstyle feature space separately
    from the skill feature space.
    """

    player_ids = (
        playstyle_features[
            "player_id"
        ].copy()
    )

    X = playstyle_features[
        PLAYSTYLE_FEATURES
    ].copy()

    scaler = StandardScaler()

    X_scaled = scaler.fit_transform(
        X
    )

    scaled = pd.DataFrame(
        X_scaled,
        columns=PLAYSTYLE_FEATURES
    )

    scaled.insert(
        0,
        "player_id",
        player_ids.reset_index(
            drop=True
        )
    )

    return (
        scaled,
        scaler
    )


# ============================================================
# EXTRACT PLAYSTYLE COMPONENTS (UNSUPERVISED)
# ============================================================

PLAYSTYLE_COMPONENT_SHARE = 0.80


def extract_playstyle_components(
    scaled_playstyle_features,
    min_share=PLAYSTYLE_COMPONENT_SHARE
):
    """
    Boil the standardized playstyle features down to a few
    summary scores with PCA, fitted once on every player.

    Keeps the fewest components that together explain at
    least `min_share` of the spread. The second-level
    K-Means clusters on these scores (see the `features`
    argument of clustering.test_playstyle_k_values); the
    archetype names are still read from the features
    themselves.

    Fitted on everyone rather than per skill group, so a
    score means the same thing in every group.

    Returns:
        components  DataFrame: player_id, pc_1 .. pc_n,
                    in the input's row order
        pca         the fitted PCA, n components
        share       the share of the spread they explain
    """

    player_ids = (
        scaled_playstyle_features[
            "player_id"
        ]
        .reset_index(
            drop=True
        )
    )

    X = scaled_playstyle_features[
        PLAYSTYLE_FEATURES
    ].to_numpy()

    cumulative = np.cumsum(
        PCA()
        .fit(X)
        .explained_variance_ratio_
    )

    n_components = min(
        int(
            np.searchsorted(
                cumulative,
                min_share
            )
        ) + 1,
        len(cumulative)
    )

    pca = PCA(
        n_components=n_components
    )

    components = pd.DataFrame(
        pca.fit_transform(X),
        columns=[
            f"pc_{i + 1}"
            for i in range(n_components)
        ]
    )

    components.insert(
        0,
        "player_id",
        player_ids
    )

    return (
        components,
        pca,
        float(cumulative[n_components - 1])
    )