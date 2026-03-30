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
curl -X POST "https://your-app-domain.com/api/merchants/import" -H "x-user-id: ${MERCHANT_IMPORT_USER_ID}"
```

Notes:
- Store the user ID as a platform secret (for example, `MERCHANT_IMPORT_USER_ID`).
- `x-user-id` must be an existing value from the `users.id` column, typically a Super Admin user.
- The import creates an entry in `merchant_import_runs`.
- You can test the same call locally with `http://localhost:3000`.
- Keep the command on one line in Coolify.
- Quote both the URL and the header value exactly as shown above.
- The current merchant import endpoint uses `x-user-id`. It does not use a cron secret.

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
