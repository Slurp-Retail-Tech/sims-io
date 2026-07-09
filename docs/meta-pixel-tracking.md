# Meta Pixel — demoform conversion tracking

How Facebook Ads conversions from the public demoform are tracked. This is
configured entirely in the **Google Tag Manager** dashboard — there is no
application code for the pixel. It rides on the existing GTM container
(`NEXT_PUBLIC_GTM_ID`) and the `demo_form_submit` dataLayer event the form
already pushes on a successful submission.

## How the conversion signal works

On a successful demoform submit — i.e. after `POST /api/leads` returns `ok`, so
a lead was actually created (spam/validation failures never reach this point) —
the client pushes to the dataLayer (see `src/app/demoform/demo-form.tsx`):

```js
dataLayer.push({
  event: "demo_form_submit",
  form_id: "demo-form",
  source: "web" | "mobile",   // web = /demoform/web, mobile = /demoform (whatsapp)
  business_type: "<selected type>",
  language: "en" | "bm",
})
```

## GTM setup (one-time)

In the GTM container set as `NEXT_PUBLIC_GTM_ID`:

1. **Base pixel tag** — Custom HTML tag (or the community "Facebook Pixel"
   template) containing the Meta base pixel snippet with the **Pixel ID** from
   Meta Events Manager. Trigger: **All Pages**. This enables `PageView`.
2. **Data Layer Variables** — create three, matching the pushed keys exactly:
   - `DLV - source` → `source`
   - `DLV - business_type` → `business_type`
   - `DLV - language` → `language`
3. **Custom Event trigger** — event name `demo_form_submit`.
4. **Meta Pixel `Lead` event tag** — fires `fbq('track', 'Lead', {...})` with the
   three DLVs as custom parameters, bound to the trigger from step 3:
   ```js
   fbq('track', 'Lead', {
     source: {{DLV - source}},
     business_type: {{DLV - business_type}},
     language: {{DLV - language}}
   });
   ```
5. **Publish** the container version.

## Meta Events Manager

- Confirm the Pixel exists and copy its Pixel ID (used in step 1).
- Mark **`Lead`** as a conversion event so ad campaigns can optimize/attribute
  against it.

## Verifying

- **GTM Preview**: submit the form and confirm the Meta `Lead` tag fires with the
  custom params populated.
- **Meta Pixel Helper** (browser extension): `PageView` on load, `Lead` on submit.
- **Events Manager → Test Events**: submit with the test code; confirm the `Lead`
  event arrives with parameters.
- **Negative check**: trigger a validation error (e.g. bad phone) → no `Lead`
  event fires.

## Notes

- `NEXT_PUBLIC_GTM_ID` is baked into the JS bundle at build time, but GTM-side
  tag/trigger changes take effect on publish with no app redeploy.
- This is browser-side pixel tracking. Server-side Conversions API (better for
  ad-blocker resilience) is not implemented.
- Lead attribution stored in the database (origin / utm / gclid / fbclid columns)
  is a separate mechanism captured server-side on `POST /api/leads`; see
  `docs/TDD.md`.
