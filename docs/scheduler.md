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
