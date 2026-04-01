# File Uploads

Use the shared upload endpoint for all files:

```
POST /api/uploads
```

## Request format

Send `multipart/form-data` with:
- `file` (required) - file to upload.
- `folder` (optional) - logical bucket prefix. Allowed values: `avatars`, `uploads`.
- `sims-csrf` cookie plus matching `x-csrf-token` header.
- `sims-auth` cookie for authenticated browser uploads.

Example (curl):
```
curl -X POST https://your-app-domain.com/api/uploads \
  -H "x-csrf-token: YOUR_CSRF_TOKEN" \
  -H "Cookie: sims-auth=YOUR_SESSION_TOKEN; sims-csrf=YOUR_CSRF_TOKEN" \
  -F "file=@/path/to/file.png" \
  -F "folder=uploads"
```

The response returns the proxy `url`, `publicUrl`, and `key` for storage.

## Notes

- Avatars must be images and are stored under `avatars/`.
- The default folder is `uploads`.
- File size limit: 10MB.
- Browser clients in this repo keep the CSRF cookie/header pair aligned automatically through `getClientCsrfToken()`.
