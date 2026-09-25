"""
The old skill score's accuracy on the same matches the rally rating was
tested on.

    INTERNAL_API_KEY=... .venv/bin/python scripts/skill_score_prediction.py \
        https://api-staging-8ac6.up.railway.app ../server/scripts/.rating-split.json

Read-only. Builds the pipeline's skill score from the split's "train"
matches only, then picks the side with the higher average score in each
"test" match. Uses the vendored pipeline functions unchanged.
"""

import json
import math
import os
import sys
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.player_profiles import aggregate_player_profiles  # noqa: E402
from pipeline.skill_model import calculate_skill_score  # noqa: E402

MIN_MATCHES = 5

api = sys.argv[1].rstrip("/")
split = json.loads(Path(sys.argv[2]).read_text())
key = os.environ["INTERNAL_API_KEY"]

# The same door run.py uses. The umpire-facing CSV download this script
# used to read was removed: it showed every facility's matches to any
# signed-in umpire, while the app itself scopes an umpire to one.
response = requests.get(f"{api}/internal/match-logs.json", headers={"x-internal-key": key}, timeout=60)
response.raise_for_status()
rows = pd.DataFrame(response.json()["rows"])
# pandas' datetime parsing crashes on this machine's Python 3.14 build,
# and nothing here needs the timestamps as dates.
rows["ended_at"] = rows["ended_at"].astype(str)

train_rows = rows[rows["match_id"].isin(set(split["train"]))]
counts = train_rows.groupby("player_id")["match_id"].nunique()
eligible = counts[counts >= MIN_MATCHES].index
scored = calculate_skill_score(aggregate_player_profiles(train_rows[train_rows["player_id"].isin(eligible)]))
if "player_id" not in scored.columns:
    scored = scored.reset_index()
skill = dict(zip(scored["player_id"], scored["skill_score"]))

right = total = 0
for match_id in split["test"]:
    group = rows[rows["match_id"] == match_id]
    if group.empty:
        continue
    a = group[group["team"] == "A"]
    b = group[group["team"] == "B"]
    won = a["won"].iloc[0]
    if pd.isna(won) or won == "":
        continue
    values_a = [skill.get(p) for p in a["player_id"]]
    values_b = [skill.get(p) for p in b["player_id"]]
    if None in values_a or None in values_b:
        continue
    mean_a = sum(values_a) / len(values_a)
    mean_b = sum(values_b) / len(values_b)
    if mean_a == mean_b:
        continue
    a_won = int(float(won)) == 1
    total += 1
    right += int((mean_a > mean_b) == a_won)

if total == 0:
    print("no later match had both sides' skill scores; cannot report an accuracy", file=sys.stderr)
    sys.exit(1)

accuracy = right / total
z = 1.96
centre = (accuracy + z * z / (2 * total)) / (1 + z * z / total)
half = z * math.sqrt(accuracy * (1 - accuracy) / total + z * z / (4 * total * total)) / (1 + z * z / total)
print(f"old skill score on later matches: {accuracy:.1%} of {total} "
      f"(95% range {centre - half:.0%}-{centre + half:.0%})")
# The skill score is 0-100, not a probability, and there is no agreed way
# to turn its gap into one, so only accuracy (which side it points to) is
# compared -- no Brier score.
print("(accuracy only -- the skill score is not a match-win probability, so no Brier score is reported)")

truth_path = Path(sys.argv[2]).with_name(".sim-pool-truth.json")
if truth_path.exists():
    truth = json.loads(truth_path.read_text())["players"]
    all_counts = rows.groupby("player_id")["match_id"].nunique()
    all_eligible = all_counts[all_counts >= MIN_MATCHES].index
    all_scored = calculate_skill_score(aggregate_player_profiles(rows[rows["player_id"].isin(all_eligible)]))
    if "player_id" not in all_scored.columns:
        all_scored = all_scored.reset_index()
    frame = pd.DataFrame(truth).merge(all_scored[["player_id", "skill_score"]], left_on="id", right_on="player_id")
    rho = frame[["ability", "skill_score"]].corr(method="spearman").iloc[0, 1]
    print(f"old skill score vs true ability (all matches, {len(frame)} players): Spearman {rho:.2f}")
