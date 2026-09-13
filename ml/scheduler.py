"""
The nightly run, scheduled from inside the web process.

The tidier arrangement is a second Railway service with a cron schedule
that starts, runs and exits -- Railway cron services are expected to
exit, and this one never does, so a cronSchedule set on it would look
configured and quietly do nothing. Production now has that service,
`ml-cron`, and runs this web service with PADDLEPAD_SCHEDULE=off. The
thread is what staging still uses, and was the only option while the
free plan capped the project at five services.

Where the schedule does live in a thread here: Two things make that
safe enough to rely on:

  - It computes the NEXT occurrence of the target time and sleeps until
    then, rather than sleeping a fixed 24 hours. A redeploy at any hour
    therefore resumes on the same clock instead of drifting by however
    long the container had been up.

  - It shares the run lock with POST /run, so a manual trigger during
    the scheduled run cannot start a second one in this process.

What it cannot survive is the container not running. That is fine while
sleepApplication is off, and would silently stop being fine if it were
ever turned on -- which is why the deployment notes call that out.
"""

import os
import threading
import traceback
from datetime import datetime, time, timedelta, timezone

# 19:00 UTC is 3am in Manila (UTC+8): after play has finished, before
# anyone opens the app in the morning. Stored as UTC because that is
# what the server clock is; converting here rather than at read time
# means there is one place to be wrong.
RUN_AT_UTC = time(hour=19, minute=0)


def seconds_until_next(target=RUN_AT_UTC, now=None):
    """Seconds from now until the next occurrence of `target`, in UTC."""
    now = now or datetime.now(timezone.utc)
    next_run = datetime.combine(now.date(), target, tzinfo=timezone.utc)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


def start(run_callable, lock, enabled=True):
    """
    Starts the scheduler thread. Returns it, or None when disabled.

    `run_callable` and `lock` are passed in rather than imported so this
    module has no opinion about what it is scheduling, and so a test can
    drive it without touching the network.

    The thread is a daemon: a scheduled run must never keep a container
    alive through a shutdown, and an interrupted run is not a problem --
    the pipeline is a pure recomputation from the API's data, so the
    next run produces the same answer.
    """
    if not enabled:
        print("Nightly run disabled (PADDLEPAD_SCHEDULE=off).")
        return None

    def loop():
        while True:
            delay = seconds_until_next()
            print(f"Next scheduled run in {delay / 3600:.1f}h.")
            # A plain sleep rather than a wait on an event: there is
            # nothing that would legitimately cancel this, and an Event
            # would only add a way to get it wrong.
            threading.Event().wait(delay)

            if not lock.acquire(blocking=False):
                # A manual POST /run is already in progress. Skipping is
                # right: it is computing the same thing from the same
                # data, so waiting for it would only publish a duplicate
                # snapshot a few seconds later.
                print("Scheduled run skipped; a run is already in progress.")
                continue
            try:
                run_callable()
            except Exception:
                # Never let one bad night kill the schedule. The failure
                # is recorded by run() itself where it can be, and this
                # catches the cases where it cannot -- the API being
                # unreachable, most likely.
                print("Scheduled run failed:")
                traceback.print_exc()
            finally:
                lock.release()

    thread = threading.Thread(target=loop, name="nightly-run", daemon=True)
    thread.start()
    return thread


def enabled_from_env():
    """Off only when explicitly asked, so the default is a working schedule."""
    return os.environ.get("PADDLEPAD_SCHEDULE", "on").lower() != "off"
