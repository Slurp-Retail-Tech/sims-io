# Meta Pixel — demoform conversion tracking

How Facebook Ads conversions from the public demoform are tracked. The pixel is
implemented **natively in the app code**, gated on `NEXT_PUBLIC_META_PIXEL_ID`:

- **Base pixel** (`PageView`) loads site-wide from the root layout
  (`src/app/layout.tsx`), mirroring the GTM block.
- **`Lead` conversion** fires from the demoform success handler
  (`src/app/demoform/demo-form.tsx`), right after the existing `demo_form_submit`
  dataLayer push, with `source`, `business_type`, and `language` params.

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

## Verifying

- **Meta Pixel Helper** (browser extension): `PageView` on load, `Lead` on a
  successful submit, with the custom params populated.
- **Events Manager → Test Events**: submit with the test code; confirm `PageView`
  and `Lead` arrive.
- **Negative check**: trigger a validation error (e.g. bad phone) → no `Lead`
  event fires.

## Notes

- Browser-side pixel tracking only. Server-side Conversions API (better for
  ad-blocker resilience) is not implemented.
- Lead attribution stored in the database (origin / utm / gclid / fbclid columns)
  is a separate mechanism captured server-side on `POST /api/leads`; see
  `docs/TDD.md`.
