"""
Would using the rally rating inside the pipeline change its results?

    INTERNAL_API_KEY=... .venv/bin/python scripts/compare_skill_input.py \
        https://api-staging-8ac6.up.railway.app ../server/scripts/.rally-points.json

Read-only, and changes nothing in the pipeline. Runs run.run_pipeline
twice on the same staging match logs:

  A. with the old skill score doing both jobs, as the nightly job did
     before rally points named its groups;
  B. with each player's rally points standing in for skill_score.

K-Means itself never reads the score and uses a fixed random_state, so
any difference comes from the two places the score IS used: naming the
skill clusters and residualising the playstyle features.
"""

import json
import os
import sys
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run  # noqa: E402

MIN_MATCHES = 5

api = sys.argv[1].rstrip("/")
rally_points = json.loads(Path(sys.argv[2]).read_text())
key = os.environ["INTERNAL_API_KEY"]

# The same door run.py uses. The umpire-facing CSV download this script
# used to read was removed: it showed every facility's matches to any
# signed-in umpire, while the app itself scopes an umpire to one.
response = requests.get(f"{api}/internal/match-logs.json", headers={"x-internal-key": key}, timeout=60)
response.raise_for_status()
rows = pd.DataFrame(response.json()["rows"])
# pandas' datetime parsing crashes on this machine's Python 3.14 build.
rows["ended_at"] = rows["ended_at"].astype(str)

counts = rows.groupby("player_id")["match_id"].nunique()
gated = rows[rows["player_id"].isin(counts[counts >= MIN_MATCHES].index)].copy()

# ---- A: the old score for everything (no rally points passed) ----
final_a, *_ = run.run_pipeline(gated)

# ---- B: rally points in place of the old score ----
original_build = run.build_skill_model
original_parts = run.build_score_parts
original_games = run.build_game_scores


def build_with_rally_points(profiles):
    skill_profiles = original_build(profiles)
    points = skill_profiles["player_id"].map(rally_points)
    missing = points.isna().sum()
    if missing:
        raise RuntimeError(f"{missing} gated players have no rally points; rerun rally-rating-prediction.mjs")
    skill_profiles["skill_score"] = points.astype(float)
    return skill_profiles


run.build_skill_model = build_with_rally_points
# These two re-derive the OLD score's arithmetic and stop if the score no
# longer matches it -- correctly, for the real job. They are not part of
# the clustering, so they are skipped for this run only.
run.build_score_parts = lambda skill_profiles: {}
run.build_game_scores = lambda gated_df, skill_profiles: {}
try:
    final_b, *_ = run.run_pipeline(gated)
finally:
    run.build_skill_model = original_build
    run.build_score_parts = original_parts
    run.build_game_scores = original_games

# ---- Compare ----
both = final_a[["player_id", "skill_group", "playstyle_archetype"]].merge(
    final_b[["player_id", "skill_group", "playstyle_archetype"]],
    on="player_id",
    suffixes=("_old", "_rally"),
)
n = len(both)
group_changed = (both["skill_group_old"] != both["skill_group_rally"]).sum()
style_changed = (
    both["playstyle_archetype_old"].fillna("-") != both["playstyle_archetype_rally"].fillna("-")
).sum()


def same_people(left, right):
    """Whether two labellings put exactly the same players together,
    whatever each group happens to be called. Group names are numbered by
    average score, so a different score can renumber identical groups."""
    pairs = both[[left, right]].fillna("-").drop_duplicates()
    return pairs[left].is_unique and pairs[right].is_unique


pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 20)

print(f"players compared: {n}")
print(f"skill group name changed: {group_changed} of {n} ({group_changed / n:.0%})")
print(f"playstyle changed:        {style_changed} of {n} ({style_changed / n:.0%})")
print(f"same people in each skill group, names aside: {same_people('skill_group_old', 'skill_group_rally')}")
print(f"same people in each playstyle, names aside:   {same_people('playstyle_archetype_old', 'playstyle_archetype_rally')}")
print("\nskill groups, old (rows) against rally (columns):")
print(pd.crosstab(both["skill_group_old"], both["skill_group_rally"]))
print("\nplaystyles found, old:  ", sorted(both["playstyle_archetype_old"].dropna().unique()))
print("playstyles found, rally:", sorted(both["playstyle_archetype_rally"].dropna().unique()))
