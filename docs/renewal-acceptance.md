# Renewal & Retention — PRD acceptance checklist

Status of AC1–AC36 (PRD §6, `PRD-Automated-Renewal-Reminders-Invoicing-and-Payment-Collection.md` v1.0) against the code, with the evidence for each grade.

- **First walk:** 2026-09-23 at 4.28.0 (read-only code audit): 15 MET, 19 PARTIAL, 2 NOT MET.
- **Second revision:** 2026-09-23 at 4.35.1, after Phases 8 and 9: 24 MET, 10 PARTIAL, 2 NOT MET.
- **This revision:** 2026-09-23 at **4.36.0**, after Phase 6 (Respond.io dispatch), built and exercised against a local Respond.io stand-in. It ships switched off; the WhatsApp half waits on Meta template approval.

Grades: **MET**, implemented and enforced, with the code and, where one exists, the test that proves it. **PARTIAL**, some is missing, and the gap says what. **NOT MET**. **BLOCKED**, waits on something outside the codebase.

## Summary

| Grade | 4.28.0 | 4.35.1 | 4.36.0 |
|---|---|---|---|
| MET | 15 | 24 | 31 |
| PARTIAL | 19 | 10 | 4 |
| NOT MET | 2 | 2 | 0 |
| BLOCKED | 0 | 0 | 1 |

Everything still open traces to three things:

1. **Meta template approval:** AC9's WhatsApp half. Email reminders and receipts work once dispatch is resumed.
2. **In-SIMS notifications (PRD 4.24):** AC20, 27. Open question: SIMS has no staff owner per franchise for renewals, so "notify the assigned Renewal PIC in SIMS" needs a decision on who is notified, and where, before it can be built.
3. **Deviations to settle in the PRD:** AC21 (the proforma stays `paid`), AC22 (payer documents over SMTP, not Respond.io), AC26 (a cancelled payment returns the invoice to `issued`).

## Checklist

| AC | Criterion (paraphrased) | Grade | Evidence | Gap |
|---|---|---|---|---|
| 1 | One plan carries both term prices and is reusable | MET | `plans.ts`, `plan-resolution.ts`; tests in `plan-validation.test.ts`, `plan-resolution.test.ts` | |
| 2 | Outlet-scope assignment beats franchise-scope; row shows the source | MET | `resolvePlanForOutlet`; `renewal-list-data.ts` `resolvedFrom`; `plan-resolution.test.ts` | |
| 3 | Newly imported outlet inherits the franchise plan and gets `reminder_first` | MET | `subscription-sync.ts` insert; inheritance test in `plan-resolution.test.ts`; `cycle.ts` invoices it and queues `reminder_first` the night the proforma is raised (`reminderTypeForNight`, `dispatch-plan.test.ts`) | Live once dispatch is switched on |
| 4 | Agreed price applies every cycle; the difference is recorded and reported | MET | `resolvePriceForLine`; `catalog_amount`/`adjustment_amount` on lines; `metrics.ts` `pricingMetrics`; named **Agreed price** since 4.31.0 | |
| 5 | Price past the threshold blocks invoicing until approved | MET | `plans.ts` pending approval; `cycle.ts` `override_pending_approval`; approve key on the route; `plan-resolution.test.ts` | |
| 6 | Grouped franchise: one proforma, N lines, one token, one dispatch | MET | `invoice-build.ts` grouping and totals; one reminder set per invoice, addressed by the group PIC (`cycle.ts` → `queueRenewalMessages`) | |
| 7 | Tax is exclusive and suppressed at 0% | MET | `money.ts` `applyTaxExclusive`; `pdf/renewal-documents.ts`; `money.test.ts` | |
| 8 | Term switch reprices group-wide; unpaid session superseded | MET | `public-invoice.ts` `applyTermChange`; `term/route.ts`; `term-change.test.ts` | Event named `term_changed`, not `plan_changed` |
| 9 | Reminders fan out to every recipient on every enabled channel | BLOCKED | `planDispatches` (tested: PIC and every CC on each usable channel), `renewal_dispatches` rows (migration 039), `dispatch-sender.ts`; email path exercised end to end against a local Respond.io stand-in | WhatsApp waits on Meta approving the templates in `message-templates.ts`; the button parameter shape must be confirmed with `scripts/verify-respondio.mjs` |
| 10 | Partly unreachable PIC gets what it can; fully unreachable blocks | MET | `channel_unreachable` (informational) and `unreachable_renewal_pic` (blocking) in `cycle.ts`; `planDispatches` sends on the usable channels only; contact page warning | |
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
| 21 | Tax invoice follows payment; receipt dispatched | PARTIAL | `ensureTaxInvoice`, `numbering.ts`; receipt to PIC and CCs queued by post-payment (`queueReceiptForInvoice`) | The proforma stays `paid` rather than `superseded` by design (TDD); settle in the PRD |
| 22 | Payer receives documents by email without visiting a page | PARTIAL | `sendPayerDocuments` over SMTP, driven after the callback; held while dispatch is paused | Deliberate deviation: SMTP rather than Respond.io, so no dispatch row, `messageId` or `renewal-payer` tag. Settle in the PRD or move it |
| 23 | Same person not sent duplicate documents | MET | `planDispatches` suppresses the email receipt to the payer's address and any repeated address, keeping the WhatsApp receipt (`dispatch-plan.test.ts`) | WhatsApp half waits on Meta approval |
| 24 | Receipt page confirms the renewal and prints both documents | MET | `receipt/page.tsx`; `buildReceiptDocMeta` shows the payment reference (4.34.0); `pdf?document=receipt\|tax_invoice` | |
| 25 | Redirect ahead of the callback resolves without merchant action | MET | Receipt page polls with `?poll=1` up to `receipt_poll_ceiling_seconds`; `check-payment` route runs at most one Query per link per minute (`cacheAcquire`); never marks paid on the redirect (4.34.0) | |
| 26 | Failed payment returns the merchant to an editable proforma | MET | `processGatewayNotice` `session_closed`; on-demand query resolves a cancel within a minute (4.34.0); switcher unlocked | The invoice returns to `issued`, not `payment_pending`; settle in the PRD |
| 27 | Non-renewal flagged; late payment in grace still renews | PARTIAL | `lapse.ts` sets `lapsed` and `renewal_state = 'non_renewed'` (4.33.0; cutoff tested against `payabilityOf`); grace payability and extension from the original expiry | The PIC notification: PRD 4.24 decision needed |
| 28 | Missing plan or PIC flagged before the window closes; auto-resolves | MET | `cycle.ts` raises both independently with `days_to_expiry`; readiness window; `resolveUnseenActions`; **Check now**; invoiced and reminded on the next offset night once fixed | Live once dispatch is switched on |
| 29 | Opens tracked, repeats counted, staff excluded | MET | `public/renewal/[token]/route.ts`: staff and `?poll=1` excluded (4.34.0); `engagementMetrics` | |
| 30 | Renewal List shows resolved state per subscription | MET | `renewal-list.ts`, `renewal-list-data.ts`; `reminder_sent` from sent reminder rows (`invoicesWithSentReminder`); filters incl. `?month=`/`?state=`/`?opened=` | |
| 31 | Analytics computed per cohort, monthly and annually, reconcilable | MET | `metrics.ts`, `analytics-data.ts`, `analytics-periods.ts` (tested); drill-through to the Renewal List (4.35.0) | |
| 32 | Bukku export complete and not repeatable by accident | MET | `bukku-export-data.ts`: INV- number via `parent_invoice_id`, `Central ID`, `Proforma No`, `includeExported` opt-in (4.35.1); `bukku-export.test.ts` | Column set still to confirm against a real Bukku import (open dependency) |
| 33 | Offline payment runs the same path as a gateway payment | MET | `markPaidOffline` → `confirmPayment(paidVia 'manual')` → post-payment, which queues the PIC receipt like any payment | |
| 34 | Access control gates the module | MET | API 404s; `page-access.ts` and user-management carry every key; invoice detail page `notFound()` (4.31.0) | Detail keyed by id, not invoice number |
| 35 | Third-party failure does not block SIMS | MET | Nightly job calls neither service; `renderInvoicePdfSafely`; per-franchise try/catch; a failed send retries three times then raises informational `dispatch_failed` without blocking invoicing | |
| 36 | Kill switch suspends outbound messaging only | MET | Nothing queued (`queueRenewalMessages`) or sent (`sendDueDispatches`) while `dispatch_enabled` is off; payer email held and released on resume; invoices, PDFs and links unaffected | |

## How to re-walk

1. `npm test`: the pure-module tests cited above.
2. Local database (see `docs/scheduler.md` and the plan's working notes): seed an outlet inside the invoicing window, run `POST /api/renewals/cycle`, and follow it through the proforma page, **Mark paid offline**, the receipt page and the Bukku export.
3. On staging, one real CommercePay payment end to end. It proves the one unit assumption local testing cannot: no `payment_amount_mismatch` on the timeline.
