# Meta Pixel — demoform conversion tracking

How Facebook Ads conversions from the public demoform are tracked. The pixel is
implemented **natively in the app code**, gated on `NEXT_PUBLIC_META_PIXEL_ID`:

- **Base pixel** (`PageView`) loads site-wide from the root layout
  (`src/app/layout.tsx`), mirroring the GTM block.
- **`Lead` conversion** fires from the demoform success handler
  (`src/app/demoform/demo-form.tsx`), right after the existing `demo_form_submit`
  dataLayer push, with `source`, `business_type`, and `language` params.
- **Conversions API** (optional, `META_CAPI_ACCESS_TOKEN`) sends the same `Lead`
  server-side from `POST /api/leads` so it survives ad blockers — see the
  Conversions API section below.

> **Single source of the Lead event.** The code owns the `Lead` conversion. Do
> **not** also configure a `Lead` tag in GTM — Facebook would double-count. GTM
> may still be used for other tags; just don't fire `Lead` from both.

## How the conversion signal works

`fbq('track', 'Lead', …)` runs only after `POST /api/leads` returns `ok` — i.e. a
lead was actually created (spam/validation failures never reach this point).
`fbq` is a no-op when `NEXT_PUBLIC_META_PIXEL_ID` is unset, so the call is safe in
all environments.

```js
fbq('track', 'Lead', {
  source: 'web' | 'mobile',   // web = /demoform/web, mobile = /demoform (whatsapp)
  business_type: '<selected type>',
  language: 'en' | 'bm',
})
```

## Setup (one-time)

1. **Meta Events Manager** → create/confirm the Pixel, copy the numeric **Pixel
   ID**.
2. Set **`NEXT_PUBLIC_META_PIXEL_ID`** in the environment. Because it is a
   `NEXT_PUBLIC_*` var it is baked into the JS bundle at build time, so a change
   requires a full redeploy (in Coolify, mark it as a Build Variable).
3. In **Events Manager**, mark **`Lead`** as a conversion event so ad campaigns
   can optimize/attribute against it.

No GTM configuration is required for the pixel.

## Conversions API (server-side, ad-blocker resilient)

Ad blockers block the browser pixel's `facebook.com/tr` beacon, so real
conversions get lost. To capture them, the `Lead` is **also** sent server-side
via the Meta Conversions API (`src/lib/meta-capi.ts`), fired from `POST
/api/leads` after the lead is created.

- **Enable it**: set `META_CAPI_ACCESS_TOKEN` (a System User token from **Events
  Manager → Settings → Conversions API → Generate access token**). No-op unless
  both this and `NEXT_PUBLIC_META_PIXEL_ID` are set.
- **Deduplication**: the client generates one `event_id` per submit, passes it to
  the browser pixel (`fbq('track','Lead', …, { eventID })`) and to the server
  (`event_id` form field). Meta collapses the browser + server events into one.
- **Match quality**: the server hashes phone and name with SHA-256 (per Meta's
  rules) and attaches the client IP, user-agent, and the `_fbc`/`_fbp` cookies
  (synthesising `fbc` from `fbclid` when the cookie is absent).
- **Testing**: set `META_CAPI_TEST_EVENT_CODE` to the code from **Events Manager
  → Test Events** so server events show there; unset it in production.

## Verifying

- **Meta Pixel Helper** (browser extension): `PageView` on load, `Lead` on a
  successful submit, with the custom params populated.
- **Events Manager → Test Events**: with `META_CAPI_TEST_EVENT_CODE` set, submit
  the form; confirm both the browser `Lead` and the server `Lead` arrive and show
  as **deduplicated** (shared `event_id`).
- **Ad-blocker check**: with an ad blocker on, the browser `Lead` is blocked but
  the server `Lead` should still arrive.
- **Negative check**: trigger a validation error (e.g. bad phone) → no `Lead`
  event fires (browser or server), since no lead is created.

## Notes

- Lead attribution stored in the database (origin / utm / gclid / fbclid columns)
  is a separate mechanism captured server-side on `POST /api/leads`; see
  `docs/TDD.md`.
