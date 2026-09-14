import assert from "node:assert/strict"
import test from "node:test"

import { createPosSessionHolder } from "./pos-session.ts"

const session = (token: string) => ({ token, cookieHeader: null })

test("the first get authenticates and later gets reuse it", async () => {
  let logins = 0
  const holder = createPosSessionHolder({
    maxAgeMs: 60_000,
    now: () => 0,
    authenticate: async () => {
      logins += 1
      return session(`t${logins}`)
    },
  })

  assert.equal((await holder.get()).token, "t1")
  assert.equal((await holder.get()).token, "t1")
  assert.equal(logins, 1)
})

test("a session older than maxAge is replaced", async () => {
  // The actual bug: one token captured before the row loop, used for the whole
  // run, so every row failed once its TTL passed.
  let logins = 0
  let clock = 0
  const holder = createPosSessionHolder({
    maxAgeMs: 1_000,
    now: () => clock,
    authenticate: async () => {
      logins += 1
      return session(`t${logins}`)
    },
  })

  assert.equal((await holder.get()).token, "t1")
  clock = 1_001
  assert.equal((await holder.get()).token, "t2")
  assert.equal(logins, 2)
})

test("refresh forces a new session even when the cached one is fresh", async () => {
  let logins = 0
  const holder = createPosSessionHolder({
    maxAgeMs: 60_000,
    now: () => 0,
    authenticate: async () => {
      logins += 1
      return session(`t${logins}`)
    },
  })

  await holder.get()
  assert.equal((await holder.refresh()).token, "t2")
  // The refreshed session becomes the cached one.
  assert.equal((await holder.get()).token, "t2")
  assert.equal(logins, 2)
})

test("concurrent refreshes share a single login", async () => {
  // A burst of 401s must not each trigger their own login — POS rate-limits it.
  let logins = 0
  const holder = createPosSessionHolder({
    maxAgeMs: 60_000,
    now: () => 0,
    authenticate: async () => {
      logins += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return session(`t${logins}`)
    },
  })

  const results = await Promise.all([
    holder.refresh(),
    holder.refresh(),
    holder.refresh(),
  ])
  assert.equal(logins, 1)
  assert.deepEqual(
    results.map((r) => r.token),
    ["t1", "t1", "t1"]
  )
})

test("a failed login does not poison later attempts", async () => {
  let attempts = 0
  const holder = createPosSessionHolder({
    maxAgeMs: 60_000,
    now: () => 0,
    authenticate: async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error("POS down")
      }
      return session("recovered")
    },
  })

  await assert.rejects(holder.get(), /POS down/)
  assert.equal((await holder.get()).token, "recovered")
})
