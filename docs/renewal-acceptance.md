# Renewal & Retention — PRD acceptance checklist

Status of AC1–AC36 (PRD §6, `PRD-Automated-Renewal-Reminders-Invoicing-and-Payment-Collection.md` v1.0) against the code, with the evidence for each grade.

- **First walk:** 2026-09-23 at 4.28.0 (read-only code audit): 15 MET, 19 PARTIAL, 2 NOT MET.
- **This revision:** 2026-09-23 at **4.35.1**, after Phases 8 and 9. Phase 6 (Respond.io dispatch) is not built yet, so every criterion that needs a message actually sent is still PARTIAL or NOT MET.

Grades: **MET**, implemented and enforced, with the code and, where one exists, the test that proves it. **PARTIAL**, some is missing, and the gap says what. **NOT MET**. **BLOCKED**, waits on something outside the codebase.

## Summary

| Grade | 4.28.0 | 4.35.1 |
|---|---|---|
| MET | 15 | 24 |
| PARTIAL | 19 | 10 |
| NOT MET | 2 | 2 |

Everything still open traces to three things:

1. **Respond.io dispatch (Phase 6):** AC3, 6, 9, 10, 21, 22, 23, 28, 30, 33.
2. **In-SIMS notifications (PRD 4.24):** AC20, 27. Open question: SIMS has no staff owner per franchise for renewals, so "notify the assigned Renewal PIC in SIMS" needs a decision on who is notified, and where, before it can be built.
3. **Deviations to settle in the PRD:** AC21 (the proforma stays `paid`), AC26 (a cancelled payment returns the invoice to `issued`).

## Checklist

| AC | Criterion (paraphrased) | Grade | Evidence | Gap |
|---|---|---|---|---|
| 1 | One plan carries both term prices and is reusable | MET | `plans.ts`, `plan-resolution.ts`; tests in `plan-validation.test.ts`, `plan-resolution.test.ts` | |
| 2 | Outlet-scope assignment beats franchise-scope; row shows the source | MET | `resolvePlanForOutlet`; `renewal-list-data.ts` `resolvedFrom`; `plan-resolution.test.ts` | |
| 3 | Newly imported outlet inherits the franchise plan and gets `reminder_first` | PARTIAL | `subscription-sync.ts` insert; inheritance test in `plan-resolution.test.ts`; `cycle.ts` invoices it | `reminder_first` dispatch: Phase 6 |
| 4 | Agreed price applies every cycle; the difference is recorded and reported | MET | `resolvePriceForLine`; `catalog_amount`/`adjustment_amount` on lines; `metrics.ts` `pricingMetrics`; named **Agreed price** since 4.31.0 | |
| 5 | Price past the threshold blocks invoicing until approved | MET | `plans.ts` pending approval; `cycle.ts` `override_pending_approval`; approve key on the route; `plan-resolution.test.ts` | |
| 6 | Grouped franchise: one proforma, N lines, one token, one dispatch | PARTIAL | `invoice-build.ts` grouping and totals; `invoice-build.test.ts` | The dispatch to the PIC: Phase 6 |
| 7 | Tax is exclusive and suppressed at 0% | MET | `money.ts` `applyTaxExclusive`; `pdf/renewal-documents.ts`; `money.test.ts` | |
| 8 | Term switch reprices group-wide; unpaid session superseded | MET | `public-invoice.ts` `applyTermChange`; `term/route.ts`; `term-change.test.ts` | Event named `term_changed`, not `plan_changed` |
| 9 | Reminders fan out to every recipient on every enabled channel | NOT MET | Recipient rules in `pic-resolution.ts` (tested) | `renewal_dispatches` and the dispatch job: Phase 6. WhatsApp also waits on Meta template approval |
| 10 | Partly unreachable PIC gets what it can; fully unreachable blocks | PARTIAL | `cycle.ts` raises `channel_unreachable` (informational) and `unreachable_renewal_pic` (blocking); tests in `pic-resolution.test.ts`; contact page warning (4.29.0) | The send itself: Phase 6 |
| 11 | Web proforma previews the invoice; only priced terms offered; open recorded | MET | `renew/[token]/page.tsx`, `buildPublicView`, `markOpened` | Route is `/renew/…` |
| 12 | Proforma prints as displayed | MET | `public/renewal/[token]/pdf/route.ts`; `ensureInvoicePdf` re-renders on term change and on **Re-print proforma** (4.30.0) | Served at `?document=proforma` |
| 13 | Payment session created for the confirmed amount | MET | `payment-sessions.ts` `startPaymentSession`; `commercepay` client and `money.test.ts` | |
| 14 | One-off price applies to one invoice only | MET | `invoice-actions.ts` `applyCycleOverride`; `plan-resolution.test.ts` | Named **One-off price** since 4.31.0 |
| 15 | Approval needed in both directions; reported separately | MET | `requiresOverrideApproval` (absolute variance); `metrics.test.ts`. The One-off price dialog uses the configured threshold since 4.31.0 | |
| 16 | Signed callback marks the invoice paid | MET | `commercepay/callback/route.ts`, `confirmPayment`; `payment-confirmation-rules.test.ts` | |
| 17 | Invalid signature rejected | MET | callback route `rejected_signature`; `signature.test.ts` | |
| 18 | Missed callback recovered by reconciliation | MET | `payment-reconcile.ts` `querySessionOnce` → `processGatewayNotice("sweep")`; also on demand from the receipt page (4.34.0) | |
| 19 | `valid_until` extends from the previous expiry, group-wide, idempotently | MET | `post-payment.ts` `applyExtensions`; `extension.test.ts` | |
| 20 | Extension failure keeps the payment | PARTIAL | `applyExtensions` catch path; `extension_failed` in Actions Required; `renewal-list.test.ts` | The in-SIMS notification: PRD 4.24 decision needed |
| 21 | Tax invoice follows payment; receipt dispatched | PARTIAL | `ensureTaxInvoice`, `numbering.ts`; `numbering.test.ts`. Receipt PDF kept once issued (4.35.1) | `renewal_payment_receipt` dispatch: Phase 6. Proforma stays `paid` rather than `superseded` by design (TDD); settle in the PRD |
| 22 | Payer receives documents by email without visiting a page | PARTIAL | `sendPayerDocuments` over SMTP, driven after the callback; held while dispatch is paused (4.35.1) | Respond.io send, dispatch row, `renewal-payer` tag: Phase 6 |
| 23 | Same person not sent duplicate documents | NOT MET | — | Needs the dispatch pipeline: Phase 6 |
| 24 | Receipt page confirms the renewal and prints both documents | MET | `receipt/page.tsx`; `buildReceiptDocMeta` shows the payment reference (4.34.0); `pdf?document=receipt\|tax_invoice` | |
| 25 | Redirect ahead of the callback resolves without merchant action | MET | Receipt page polls with `?poll=1` up to `receipt_poll_ceiling_seconds`; `check-payment` route runs at most one Query per link per minute (`cacheAcquire`); never marks paid on the redirect (4.34.0) | |
| 26 | Failed payment returns the merchant to an editable proforma | MET | `processGatewayNotice` `session_closed`; on-demand query resolves a cancel within a minute (4.34.0); switcher unlocked | The invoice returns to `issued`, not `payment_pending`; settle in the PRD |
| 27 | Non-renewal flagged; late payment in grace still renews | PARTIAL | `lapse.ts` sets `lapsed` and `renewal_state = 'non_renewed'` (4.33.0; cutoff tested against `payabilityOf`); grace payability and extension from the original expiry | The PIC notification: PRD 4.24 decision needed |
| 28 | Missing plan or PIC flagged before the window closes; auto-resolves | PARTIAL | `cycle.ts` raises both independently with `days_to_expiry`; readiness window; `resolveUnseenActions`; **Check now** (4.32.0) | "Dispatched on the T-5 run": Phase 6 |
| 29 | Opens tracked, repeats counted, staff excluded | MET | `public/renewal/[token]/route.ts`: staff and `?poll=1` excluded (4.34.0); `engagementMetrics` | |
| 30 | Renewal List shows resolved state per subscription | PARTIAL | `renewal-list.ts`, `renewal-list-data.ts`, filters incl. `?month=`/`?state=`/`?opened=` (4.35.0) | `reminder_sent` is hard-coded false until dispatch exists: Phase 6 |
| 31 | Analytics computed per cohort, monthly and annually, reconcilable | MET | `metrics.ts`, `analytics-data.ts`, `analytics-periods.ts` (tested); drill-through to the Renewal List (4.35.0) | |
| 32 | Bukku export complete and not repeatable by accident | MET | `bukku-export-data.ts`: INV- number via `parent_invoice_id`, `Central ID`, `Proforma No`, `includeExported` opt-in (4.35.1); `bukku-export.test.ts` | Column set still to confirm against a real Bukku import (open dependency) |
| 33 | Offline payment runs the same path as a gateway payment | PARTIAL | `markPaidOffline` → `confirmPayment(paidVia 'manual')` | Receipt dispatch to the PIC: Phase 6 |
| 34 | Access control gates the module | MET | API 404s; `page-access.ts` and user-management carry every key; invoice detail page `notFound()` (4.31.0) | Detail keyed by id, not invoice number |
| 35 | Third-party failure does not block SIMS | MET | Nightly job calls neither service; `renderInvoicePdfSafely`; per-franchise try/catch; POS and email failures recorded and raised to Actions Required | Dispatch retry → Actions Required is part of Phase 6 |
| 36 | Kill switch suspends outbound messaging only | MET | Payer email held while `dispatch_enabled` is off, released on resume (4.35.1); invoices, PDFs and links unaffected | Phase 6's job must read it too |

## How to re-walk

1. `npm test`: the pure-module tests cited above.
2. Local database (see `docs/scheduler.md` and the plan's working notes): seed an outlet inside the invoicing window, run `POST /api/renewals/cycle`, and follow it through the proforma page, **Mark paid offline**, the receipt page and the Bukku export.
3. On staging, one real CommercePay payment end to end. It proves the one unit assumption local testing cannot: no `payment_amount_mismatch` on the timeline.
