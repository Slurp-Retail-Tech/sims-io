/**
 * What an Actions Required queue may honestly claim about itself.
 *
 * An empty queue used to say every subscription in the window had a plan, a
 * price and someone accountable -- even on a fresh install before the nightly
 * check had looked at anything. That is the exact message that left a staff
 * member asking where to assign a plan. An empty queue only means "clear" when
 * a check has actually run, succeeded, and had something to check.
 *
 * Pure and runtime-free so the rule is unit-tested and shared by every screen
 * that reports on the queue.
 */

/** The nightly renewal check's most recent outcomes, as recorded in `job_runs`. */
export type RunSummary = {
  /** Status of the most recent finished run, or null if none has finished. */
  lastStatus: "succeeded" | "failed" | null
  lastFinishedAt: string | null
  /** When a run last succeeded; null if none ever has. */
  lastSucceededAt: string | null
}

export type QueueState =
  /** The check has never completed successfully, so nothing has been examined. */
  | "never_checked"
  /** The most recent check failed; an empty queue says nothing about today. */
  | "last_run_failed"
  /** The check ran and found no subscription inside the window to examine. */
  | "nothing_in_window"
  /** The check ran, examined subscriptions, and nothing is blocked. */
  | "clear"
  /** There are open entries to work. */
  | "has_entries"

/**
 * Decide the queue's state.
 *
 * Open entries are real whatever the run history says, so they win. After
 * that, the absence of entries is only meaningful once a check has succeeded,
 * and only reads as "clear" when there was something to check.
 */
export function describeQueueState(input: {
  run: RunSummary
  openCount: number
  subscriptionsInWindow: number
}): QueueState {
  const { run, openCount, subscriptionsInWindow } = input
  if (openCount > 0) {
    return "has_entries"
  }
  if (run.lastSucceededAt === null) {
    return run.lastStatus === "failed" ? "last_run_failed" : "never_checked"
  }
  if (run.lastStatus === "failed") {
    return "last_run_failed"
  }
  if (subscriptionsInWindow === 0) {
    return "nothing_in_window"
  }
  return "clear"
}
