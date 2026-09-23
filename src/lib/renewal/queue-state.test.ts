import assert from "node:assert/strict"
import test from "node:test"

import { describeQueueState } from "./queue-state.ts"
import type { RunSummary } from "./queue-state.ts"

const neverRan: RunSummary = { lastStatus: null, lastFinishedAt: null, lastSucceededAt: null }
const ranOk: RunSummary = {
  lastStatus: "succeeded",
  lastFinishedAt: "2026-09-22 17:15:04.000",
  lastSucceededAt: "2026-09-22 17:15:04.000",
}

test("open entries are real whatever the run history says", () => {
  assert.equal(describeQueueState({ run: neverRan, openCount: 3, subscriptionsInWindow: 0 }), "has_entries")
})

test("an empty queue before any check has run is not 'clear'", () => {
  // The fresh-install case that prompted this module: nothing has been
  // examined, so the page must not claim everything has a plan and a PIC.
  assert.equal(describeQueueState({ run: neverRan, openCount: 0, subscriptionsInWindow: 40 }), "never_checked")
})

test("a failed most recent run means an empty queue says nothing about today", () => {
  const failedAfterSuccess: RunSummary = { ...ranOk, lastStatus: "failed" }
  assert.equal(describeQueueState({ run: failedAfterSuccess, openCount: 0, subscriptionsInWindow: 40 }), "last_run_failed")
  const onlyFailures: RunSummary = { lastStatus: "failed", lastFinishedAt: "x", lastSucceededAt: null }
  assert.equal(describeQueueState({ run: onlyFailures, openCount: 0, subscriptionsInWindow: 40 }), "last_run_failed")
})

test("a successful check with nothing in the window is distinct from clear", () => {
  assert.equal(describeQueueState({ run: ranOk, openCount: 0, subscriptionsInWindow: 0 }), "nothing_in_window")
})

test("only a successful check that examined something and found nothing is clear", () => {
  assert.equal(describeQueueState({ run: ranOk, openCount: 0, subscriptionsInWindow: 40 }), "clear")
})
