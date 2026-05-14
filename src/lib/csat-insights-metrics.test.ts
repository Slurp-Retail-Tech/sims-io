import assert from "node:assert/strict"
import test from "node:test"

import { CSAT_SENT_LINK_HISTORY_FIELDS } from "./csat-insights-metrics.ts"

test("counts WhatsApp CSAT sends as sent links", () => {
  assert.deepEqual(CSAT_SENT_LINK_HISTORY_FIELDS, [
    "csat_link_shared",
    "csat_link_shared_at",
    "csat_whatsapp_sent",
  ])
})
