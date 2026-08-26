"""
The HTTP surface of the ML service.

Deliberately tiny. The interesting question is why this is a scheduled
service rather than an endpoint that scores a player on request, and the
answer is in the algorithm, not in preference:

There is no predict() anywhere in the pipeline -- only fit_predict.
K-Means learns where the clusters sit by looking at every player at
once, assigns each player to the nearest, and keeps nothing. There is no
saved model for a new player to be measured against. On top of that the
skill score itself is not from K-Means at all: min_max_normalize places
each player between the weakest and strongest player CURRENTLY present,
so it moves when other people play regardless of any model.

An endpoint that scored one player on demand would therefore secretly
re-run the entire clustering on every page load, and would give slightly
different answers each time as n_init=20 re-seeds. So the work happens
in batches, and the app reads the last published snapshot.
"""

import os
import threading

from flask import Flask, jsonify, request

from run import run

app = Flask(__name__)

# One run at a time. Two overlapping runs would publish two snapshots
# computed from near-identical data, and the later-finishing one would
# not necessarily be the later-starting one.
run_lock = threading.Lock()

TRIGGER_KEY = os.environ.get("INTERNAL_API_KEY", "")


@app.get("/health")
def health():
    """Railway's health check, and what wakes the service from sleep."""
    return jsonify(ok=True)


@app.post("/run")
def trigger():
    """
    Runs the pipeline now. Guarded by the same shared key the service
    uses to talk to the API, so triggering a run needs the credential
    that could already read all the data anyway.

    Synchronous on purpose: at club scale a run is seconds, and being
    able to trigger one and see the result in the response is worth more
    during a demo than freeing the connection early.
    """
    presented = request.headers.get("x-internal-key", "")
    if not TRIGGER_KEY or len(TRIGGER_KEY) < 32 or presented != TRIGGER_KEY:
        return jsonify(error="Missing or invalid internal key"), 401

    if not run_lock.acquire(blocking=False):
        return jsonify(error="A run is already in progress"), 409
    try:
        return jsonify(run(publish=request.args.get("dry") != "1"))
    finally:
        run_lock.release()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
