# Scheduler (Coolify)

Use your platform scheduler to trigger the merchants import instead of running
an in-app cron.

## Merchants import endpoint

```
POST /api/merchants/import
```

## Coolify job example

Cron expression (Asia/Kuala_Lumpur 00:15 daily):
```
15 16 * * *
```

If Coolify lets you set the timezone, choose `Asia/Kuala_Lumpur`.

Command example using a platform env var:
```
curl -X POST "https://your-app-domain.com/api/merchants/import" -H "x-cron-secret: ${MERCHANT_IMPORT_CRON_SECRET}"
```

Notes:
- Store the cron secret as a platform secret (for example, `MERCHANT_IMPORT_CRON_SECRET`).
- `MERCHANT_IMPORT_CRON_SECRET` must match the header value.
- **This endpoint now enqueues a durable job and returns 202 immediately**; it
  no longer runs the whole import inside the request. It drives one bounded
  slice inline, and the job runner tick (below) carries the rest and resumes
  from the page cursor if a deploy interrupts it. Progress is in `job_runs`;
  `merchant_import_runs` is retained read-only for pre-cutover history.
- Concurrent calls are safe: the job is keyed so a second request joins the run
  already in flight rather than starting a rival one.
- You can test the same call locally with `http://localhost:3000`.
- Keep the command on one line in Coolify.
- Quote both the URL and the header value exactly as shown above.

## ClickUp ticket status sync endpoint

Use a daily scheduler call to refresh statuses for all linked ClickUp tickets:

```
POST /api/clickup/sync
```

Recommended cron expression (Asia/Kuala_Lumpur 01:00 daily):
```
0 17 * * *
```

If your scheduler supports explicit timezones, set timezone to `Asia/Kuala_Lumpur`.

Command example:
```
curl -X POST "https://your-app-domain.com/api/clickup/sync" -H "x-cron-secret: ${CLICKUP_SYNC_CRON_SECRET}"
```

Notes:
- Set `CLICKUP_API_TOKEN` and `CLICKUP_LIST_ID` in app environment.
- `CLICKUP_SYNC_CRON_SECRET` must match the header value.
- This updates `support_requests.clickup_task_status` and `clickup_task_status_synced_at`.
- Keep the command on one line in Coolify.
- Quote both the URL and the header value exactly as shown above. This avoids shell parsing issues when the secret contains special characters.

## Troubleshooting

- `sh: curl: not found`
  Use an image or task environment that includes `curl`, or switch the command to `wget`.
- `curl: (3) URL rejected: Malformed input to a URL function`
  This is usually caused by shell parsing or missing quotes. Re-enter the command as a single line and wrap the URL and header in double quotes.

## Renewal subscription sync endpoint

Projects POS outlets into `outlet_subscriptions`, the SIMS-owned record of
`valid_until`.

```
POST /api/renewals/subscriptions/sync
```

Run it **after** the merchants import, since it reads what that import just
wrote. Recommended cron expression (Asia/Kuala_Lumpur 00:45 daily):

```
45 16 * * *
```

Command example:

```
curl -X POST "https://your-app-domain.com/api/renewals/subscriptions/sync" -H "x-cron-secret: ${RENEWAL_SUBSCRIPTION_SYNC_CRON_SECRET}"
```

Notes:
- `RENEWAL_SUBSCRIPTION_SYNC_CRON_SECRET` must match the header value.
- Enqueues a durable job and returns 202 immediately, driving one bounded slice
  inline. The job runner tick (below) carries the rest.
- Safe to run repeatedly: every write is an upsert keyed on
  `(franchise_id, outlet_id)`, and the job is keyed so a second call joins the
  run already in flight.
- **This is what makes SIMS the system of record for `valid_until`.** The
  merchants import rewrites `merchant_outlets.raw_payload` wholesale, so an
  expiry date SIMS extended could never survive there. The projection seeds
  `valid_until` from POS the first time it sees an outlet and stops taking the
  POS value once a renewal has been applied.
- Where POS reports a date *later* than the one SIMS extended to, somebody
  renewed that outlet outside SIMS. The run logs it rather than picking a
  winner.
- Test and closed merchant accounts are skipped and never enter a renewal
  cadence.

## Renewal cycle endpoint

Nightly renewal detection: finds subscriptions expiring inside the invoicing
window — from the furthest configured reminder offset (15 days by default)
down to the expiry date itself — raises or reuses their proforma, and records
the specific reason for every one it could not invoice.

The same run also performs a readiness sweep over every subscription
expiring inside `renewal_settings.readiness_window_days` (30 by default).
Those are checked for a plan assignment and a reachable renewal PIC and
nothing else: no invoice is raised. A gap shows up in Actions Required weeks
before the offset that needs it and auto-resolves the night after it is
fixed.

```
POST /api/renewals/cycle
```

Run it **after** the subscription sync, which is itself after the merchants
import. Recommended cron expression (Asia/Kuala_Lumpur 01:15 daily):

```
15 17 * * *
```

Command example:

```
curl -X POST "https://your-app-domain.com/api/renewals/cycle" -H "x-cron-secret: ${RENEWAL_CYCLE_CRON_SECRET}"
```

Notes:
- `RENEWAL_CYCLE_CRON_SECRET` must match the header value.
- Safe to run repeatedly. Invoice generation races against a unique index
  rather than checking first, so a second run reuses what the first created
  and the T-5 and T-1 runs reuse the proforma raised at T-15. Actions Required
  entries are upserted, not duplicated.
- Invoicing is driven by a **window**, not by the three offset dates. Any
  eligible outlet from 15 days out down to its expiry day gets a proforma on
  the first night it qualifies, and every night after that reuses it. An
  expiry date that moves — the POS sync correcting it, a renewal done outside
  SIMS, a hand edit — can therefore no longer step over all three offsets and
  lapse with nothing raised.
- A run skipped for several days does not double-invoice when it comes back:
  generation races a unique index and `findOpenProformaForOutlets` matches on
  the outlet and the expiry it renews from, so the catch-up night reuses what
  already exists.
- The offsets remain the **reminder cadence**. Only a night that lands on one
  records the cadence event on the invoice timeline, so the fourteen routine
  reuses in between leave no trace.
- Outlets already past expiry are never invoiced retroactively. A licence that
  lapsed without an invoice is a question for a person.
- The same run sweeps **every** open proforma, not just tonight's cohort, for
  documents billing an expiry their outlet has since moved off. Those are
  reported to Actions Required as `stale_proforma` and never voided
  automatically: the document may have been sent, opened, or have a live
  payment session against it. The entry clears on its own once the invoice is
  voided, paid, or the dates come back into line. The correct proforma for the
  new date is raised by the due pass regardless, so nobody waits on this.
- Outlets that cannot be invoiced are written to Actions Required with the
  reason, and re-evaluated every night, so closing the underlying gap re-enters
  them automatically and resolves the entry.
- **Check now.** An Admin with the invoices key can press **Check now** on
  Actions Required, which POSTs `{"mode":"check"}` to the same route. A check
  runs every plan, price and PIC check and the stale-proforma sweep, but never
  raises an invoice, renders a document or records a cadence event. It holds
  its own single-flight key (`check`), so it can never join or swallow the
  nightly run. The cron path is always a full run.
- Every gap is reported, not just the first: an outlet with no plan *and* no
  renewal PIC raises both, so one pass through the queue closes both.
- Nothing is sent to a merchant by this job. Outbound dispatch is behind the
  `dispatch_enabled` setting, which ships off.

## Renewal payment reconcile endpoint

The hourly safety net under the CommercePay callback. Asks the gateway about
every open payment session older than a few minutes, settles any that paid
without a callback arriving (recorded as `reconciledBySweep` for the
analytics), closes attempts that failed or expired, and re-queues any
post-payment step still outstanding on a paid invoice: licence extension, tax
invoice, receipt and tax invoice PDFs, the POS `valid_until` push, and the
payer email.

```
POST /api/renewals/payments/reconcile
```

Recommended cron expression (hourly, at :20):

```
20 * * * *
```

Command example:

```
curl -X POST "https://your-app-domain.com/api/renewals/payments/reconcile" -H "x-cron-secret: ${RENEWAL_PAYMENT_RECONCILE_CRON_SECRET}"
```

Notes:
- `RENEWAL_PAYMENT_RECONCILE_CRON_SECRET` must match the header value.
- Safe to run repeatedly. A payment already settled is recognised as a
  duplicate; the job is keyed so a second call joins the run already in flight.
- Automatic re-queuing of post-payment steps stops 48 hours after payment.
  After that the Actions Required entry (`extension_failed`, `pos_push_failed`,
  `payer_email_failed`) is worked by a person, who uses **Retry post-payment
  steps** on the invoice once the cause is fixed.
- The callback itself needs no scheduling: CommercePay posts to
  `/api/public/commercepay/callback`, which is public, signature-verified and
  excluded from the auth middleware like every other `/api` route. Its
  `callbackUrl` is built from `APP_BASE_URL`, so that variable must be the
  public origin the gateway can reach.

## Job runner tick (required)

```
POST /api/jobs/tick
```

Drives the durable job runner: reaps jobs whose lease expired (a deploy
mid-run), then claims and advances one slice of work per job type.

Cron expression — every minute:
```
* * * * *
```

```
curl -X POST "https://your-app-domain.com/api/jobs/tick" -H "x-cron-secret: ${JOBS_TICK_CRON_SECRET}"
```

Notes:
- `JOBS_TICK_CRON_SECRET` must match the header value. The route returns 404
  without it, so its existence is not confirmed to an unauthenticated caller.
- Safe to run every minute and safe to overlap: the runner takes a MySQL
  advisory lock per job type, so concurrent ticks (including across replicas)
  produce exactly one worker. A tick that finds the lock held returns
  immediately, reporting the type under `skippedLocked`.
- Each tick is bounded by `JOBS_TICK_BUDGET_MS` (45s default) so it stays well
  inside any proxy timeout. Long jobs resume from their checkpoint on the next
  tick rather than running to completion in one request.
- **This job must be scheduled before imports and syncs are moved onto the
  runner.** Without it, enqueued work is never claimed.
