import numpy as np
import pandas as pd


def aggregate_player_profiles(match_df):
    """
    Convert multiple match records into one row per player.

    Calculates:
        - mean performance
        - standard deviation / consistency
        - basic match-level averages
    """

    df = match_df.copy()

    # ========================================================
    # PER-MATCH FEATURES
    # ========================================================

    safe_duration = np.maximum(
        df["match_duration_mins"],
        1.0
    )

    df["drop_efficiency"] = np.where(
        df["drop_attempts"] > 0,
        df["drop_successes"] /
        df["drop_attempts"],
        0.0
    )

    # total_winners = ALL point-ending winners, regardless of
    # shot type. Skill-facing rates (winner_rate_pm,
    # aggression_rate) must use this, not clean_winners alone
    # -- clean_winners now only means "non-dink winners" since
    # it was split from dink_winners, and "how much a player
    # wins" should not depend on which zone they won from.
    total_winners = (
        df["clean_winners"] +
        df["dink_winners"]
    )

    df["winner_rate_pm"] = (
        total_winners /
        safe_duration
    )

    df["general_error_rate_pm"] = (
        df["unforced_errors"] /
        safe_duration
    )

    df["dink_error_rate_pm"] = (
        df["dink_errors"] /
        safe_duration
    )

    total_actions = (
        total_winners +
        df["unforced_errors"]
    )

    df["aggression_rate"] = np.where(
        total_actions > 0,
        total_winners /
        total_actions,
        0.0
    )

    total_third_shots = (
        df["drop_attempts"] +
        df["drive_attempts"]
    )

    df["drop_preference_rate"] = np.where(
        total_third_shots > 0,
        df["drop_attempts"] /
        total_third_shots,
        0.0
    )

    df["net_game_preference_rate"] = np.where(
        total_winners > 0,
        df["dink_winners"] /
        total_winners,
        0.0
    )

    df["total_winners"] = total_winners

    # ========================================================
    # AGGREGATE BY PLAYER
    # ========================================================

    player_profiles = (
        df.groupby("player_id")
        .agg(

            # Mean performance
            drop_efficiency_mean=(
                "drop_efficiency",
                "mean"
            ),

            winner_rate_mean=(
                "winner_rate_pm",
                "mean"
            ),

            general_error_rate_mean=(
                "general_error_rate_pm",
                "mean"
            ),

            dink_error_rate_mean=(
                "dink_error_rate_pm",
                "mean"
            ),

            aggression_mean=(
                "aggression_rate",
                "mean"
            ),

            drop_preference_rate_mean=(
                "drop_preference_rate",
                "mean"
            ),

            net_game_preference_rate_mean=(
                "net_game_preference_rate",
                "mean"
            ),

            # Consistency
            drop_efficiency_std=(
                "drop_efficiency",
                "std"
            ),

            winner_rate_std=(
                "winner_rate_pm",
                "std"
            ),

            general_error_rate_std=(
                "general_error_rate_pm",
                "std"
            ),

            dink_error_rate_std=(
                "dink_error_rate_pm",
                "std"
            ),

            aggression_std=(
                "aggression_rate",
                "std"
            ),

            drop_preference_rate_std=(
                "drop_preference_rate",
                "std"
            ),

            net_game_preference_rate_std=(
                "net_game_preference_rate",
                "std"
            ),

            # Other information
            average_drop_attempts=(
                "drop_attempts",
                "mean"
            ),

            average_winners=(
                "total_winners",
                "mean"
            ),

            average_unforced_errors=(
                "unforced_errors",
                "mean"
            ),

            average_dink_errors=(
                "dink_errors",
                "mean"
            ),

            average_match_duration=(
                "match_duration_mins",
                "mean"
            ),

            stacking_rate=(
                "uses_stacking",
                "mean"
            ),

            match_count=(
                "match_id",
                "count"
            )
        )
        .reset_index()
    )

    # ========================================================
    # HANDLE NaN STD
    # ========================================================

    std_columns = [

        "drop_efficiency_std",

        "winner_rate_std",

        "general_error_rate_std",

        "dink_error_rate_std",

        "aggression_std",

        "drop_preference_rate_std",

        "net_game_preference_rate_std"
    ]

    player_profiles[
        std_columns
    ] = (
        player_profiles[
            std_columns
        ]
        .fillna(0.0)
    )

    return player_profiles