import numpy as np
import pandas as pd


# ============================================================
# SKILL SCORE WEIGHTS
# ============================================================
#
# These weights are the same scoring logic we were using
# previously.
#
# Drop efficiency       = 25%
# Winner production     = 30%
# General error control = 20%
# Dink error control    = 25%
# ============================================================

SKILL_WEIGHTS = {
    "drop_efficiency": 0.25,
    "winner_rate": 0.30,
    "general_error": 0.20,
    "dink_error": 0.25
}


# ============================================================
# MIN-MAX NORMALIZATION
# ============================================================

def min_max_normalize(series):
    """
    Normalize a feature to the range 0-1.
    """

    minimum = series.min()
    maximum = series.max()

    if maximum == minimum:

        return pd.Series(
            0.5,
            index=series.index
        )

    return (
        (series - minimum) /
        (maximum - minimum)
    )


# ============================================================
# CALCULATE SKILL SCORE
# ============================================================

def calculate_skill_score(
    player_profiles
):
    """
    Calculate a 0-100 skill score for each player.

    This is a statistical scoring layer, not supervised ML.

    Features:

        Drop efficiency
        Winner rate
        General error control
        Dink error control
    """

    df = player_profiles.copy()

    # --------------------------------------------------------
    # Validate required columns
    # --------------------------------------------------------

    required_columns = [

        "drop_efficiency_mean",

        "winner_rate_mean",

        "general_error_rate_mean",

        "dink_error_rate_mean"
    ]

    missing_columns = [

        column

        for column in required_columns

        if column not in df.columns
    ]

    if missing_columns:

        raise ValueError(
            "Missing required skill-score columns: "
            +
            ", ".join(
                missing_columns
            )
        )

    # --------------------------------------------------------
    # Convert each feature to 0-1
    # --------------------------------------------------------

    drop_score = min_max_normalize(
        df[
            "drop_efficiency_mean"
        ]
    )

    winner_score = min_max_normalize(
        df[
            "winner_rate_mean"
        ]
    )

    # Lower error = better
    general_error_score = (
        1 -
        min_max_normalize(
            df[
                "general_error_rate_mean"
            ]
        )
    )

    # Lower dink error = better
    dink_error_score = (
        1 -
        min_max_normalize(
            df[
                "dink_error_rate_mean"
            ]
        )
    )

    # --------------------------------------------------------
    # Weighted score
    # --------------------------------------------------------

    skill_score = (

        drop_score
        *
        SKILL_WEIGHTS[
            "drop_efficiency"
        ]

        +

        winner_score
        *
        SKILL_WEIGHTS[
            "winner_rate"
        ]

        +

        general_error_score
        *
        SKILL_WEIGHTS[
            "general_error"
        ]

        +

        dink_error_score
        *
        SKILL_WEIGHTS[
            "dink_error"
        ]
    )

    df["skill_score"] = (
        skill_score * 100
    ).round(2)

    return df


# ============================================================
# ASSIGN SKILL TIER
# ============================================================

def assign_skill_tier(
    player_profiles
):
    """
    Assign players to one of three skill tiers.

        0-39.99   -> Beginner
        40-74.99  -> Intermediate
        75-100    -> Professional
    """

    df = player_profiles.copy()

    conditions = [

        df[
            "skill_score"
        ]
        <
        40,

        df[
            "skill_score"
        ]
        <
        75,

        df[
            "skill_score"
        ]
        >=
        75
    ]

    choices = [

        "Beginner",

        "Intermediate",

        "Professional"
    ]

    df["skill_tier"] = np.select(

        conditions,

        choices,

        default="Beginner"
    )

    return df


# ============================================================
# COMPLETE SKILL MODEL
# ============================================================

def build_skill_model(
    player_profiles
):
    """
    Run the complete skill scoring layer.

        Player profiles
              ↓
        Skill score
              ↓
        Skill tier
    """

    df = calculate_skill_score(
        player_profiles
    )

    df = assign_skill_tier(
        df
    )

    return df


# ============================================================
# PRINT SKILL SUMMARY
# ============================================================

def print_skill_summary(
    player_profiles
):
    """
    Display basic information about the calculated
    skill scores and tiers.
    """

    print(
        "\n=== SKILL MODEL SUMMARY ==="
    )

    print(
        f"Players: "
        f"{len(player_profiles)}"
    )

    print(
        f"Average Skill Score: "
        f"{player_profiles['skill_score'].mean():.2f}"
    )

    print(
        f"Minimum Skill Score: "
        f"{player_profiles['skill_score'].min():.2f}"
    )

    print(
        f"Maximum Skill Score: "
        f"{player_profiles['skill_score'].max():.2f}"
    )

    print(
        "\n=== PLAYERS BY SKILL TIER ==="
    )

    tier_counts = (
        player_profiles[
            "skill_tier"
        ]
        .value_counts()
        .reindex(
            [
                "Beginner",
                "Intermediate",
                "Professional"
            ],
            fill_value=0
        )
    )

    print(
        tier_counts
    )


# ============================================================
# PRINT SAMPLE PLAYERS
# ============================================================

def print_skill_profiles(
    player_profiles,
    number_of_players=10
):
    """
    Display a sample of players with their calculated
    skill scores and tiers.
    """

    columns = [

        "player_id",

        "skill_score",

        "skill_tier",

        "drop_efficiency_mean",

        "winner_rate_mean",

        "general_error_rate_mean",

        "dink_error_rate_mean"
    ]

    sample = (
        player_profiles[
            columns
        ]
        .head(
            number_of_players
        )
        .copy()
    )

    print(
        "\n=== SAMPLE SKILL PROFILES ==="
    )

    print(
        sample.to_string(
            index=False
        )
    )