import assert from "node:assert/strict"
import test from "node:test"

import { resolveTicketHistoryActor } from "./ticket-history-actor.ts"

test("uses the user id as the ticket history actor", () => {
  assert.equal(
    resolveTicketHistoryActor({
      id: "user_123",
      name: "Jane Support",
      email: "jane@example.com",
    }),
    "user_123"
  )
})
