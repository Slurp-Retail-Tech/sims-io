# Renewals: how the renewal flow works (staff guide)

> **Knowledge-base draft.** Per `docs/knowledge-base-program.md`, paste this into the Notion KB data source as a new page with `Status = Draft`. Only a person moves it to `Approved`; only approved pages are published in-app.
>
> | Property | Value |
> |---|---|
> | Title | Renewals: how the renewal flow works |
> | Audience | External User |
> | Category | Renewals |
> | Feature Area | Renewal & Retention |
> | Status | Draft |
> | App Version | v4.35.1 |
> | Last Verified Date | 2026-09-23 |
> | Source Refs | `src/lib/renewal/setup-checklist.ts`, `src/lib/renewal/cycle.ts`, `src/lib/renewal/readiness.ts`, `src/lib/renewal/settings-timeline.ts`, `src/lib/renewal/lapse.ts`, `src/lib/renewal/pos-drift.ts`, `src/app/(app)/renewal-retention/`, `docs/scheduler.md` |
> | Owner | Renewal Ops |
>
> It replaces the February draft "Renewal Reminder Timeline", which was written from the PRD before the module was built.

## What it does

SIMS raises a renewal invoice (a *proforma*) for each outlet before its licence expires. The merchant opens a link, picks a 1-year or 6-month term, and pays online. SIMS then extends the licence, issues the tax invoice and receipt, and updates the POS.

Your job is mostly to keep the setup complete and to work the **Actions Required** queue.

## 1. Get set up

Open **Renewal & Retention → Overview**. Until setup is complete, a checklist at the top shows each step and ticks it off by itself.

1. **Add your company details.** Go to **Settings → Company details on documents**. The name, registration number, address and contact print on every proforma, tax invoice and receipt.
2. **Create a plan.** Go to **Plan Catalog → New plan**. A plan holds the 1-year and 6-month prices.
3. **Put outlets on a plan.** In the Plan Catalog, use **Assign plan** for one outlet or a whole franchise. An outlet assignment beats a franchise assignment.
4. **Name a renewal PIC.** Open the merchant's contact in **Contacts** and mark them **PIC** for the outlet or the franchise. Each outlet has exactly one PIC; others can be **CC**.
5. **Make sure the PIC can be reached.** On the same contact, enable **Email** or **WhatsApp** *and* make sure it has an address. A contact with an email address but no enabled channel is flagged as unreachable.
6. **Let the nightly check run.** It runs every night. Steps 3 to 5 read "Not checked yet" until it has run once.

## 2. The nightly check

Every night SIMS looks at every outlet expiring soon.

- **Readiness window** (default 30 days before expiry): missing plans and PICs are raised in Actions Required. Nothing is invoiced yet.
- **Invoicing window** (from the furthest reminder, default 15 days, down to expiry day): any eligible outlet without an open proforma gets one, whichever night it is. It is not a separate setting; it comes from the furthest reminder offset.
- **Reminders** (default T-15, T-5, T-1): the days a reminder goes out. The invoice usually already exists by then.
- **Grace window** (default 30 days after expiry): the link stays payable, and a late payment still renews from the original expiry date. After it, an unpaid proforma is closed as **Lapsed**.

**Settings** draws all four on one timeline that updates as you edit.

Actions Required and Invoices show when the check last ran. Admins can press **Check now** on Actions Required to re-run the checks immediately after fixing something. **Check now never raises an invoice**; only the nightly run does.

## 3. Work the Actions Required queue

Each entry says what is wrong, for which outlet, and how soon it expires. The button on the entry takes you to the fix.

- **Blocks invoicing** entries stop an invoice being raised: no plan assigned, a missing term price, an agreed price awaiting approval, no renewal PIC, or an unreachable PIC.
- **Informational** entries never block. Examples: a payment that did not match the invoice, a new expiry that has not reached the POS yet, a proforma billing an expiry date that has since moved, or an outlet **renewed outside SIMS**.

Entries clear by themselves once the gap is fixed, on the next nightly run or on **Check now**. Use **Dismiss** only when an entry is genuinely not a problem; it asks you why.

**Renewed outside SIMS** means the POS shows a later expiry than SIMS. If the renewal really happened, press **Accept POS date** (needs the subscriptions manage access). If the POS is wrong, correct it there. Any open proforma for the old date is then reported so you can void it.

## 4. Prices

- **Agreed price**: set when assigning a plan. It applies every cycle until the assignment changes. A price further from the catalog than the **Price-approval threshold** (Settings) waits for approval.
- **One-off price**: set on one line of one invoice, from the invoice page. That line only; the next invoice goes back to the agreed or catalog price.

## 5. What the merchant sees

The link opens their proforma, with the outlets, the amount and a term switcher. They pay through CommercePay and land on the receipt page. If the payment's confirmation is slow, the page checks with CommercePay itself for up to the **Receipt page wait** set in Settings, then says the documents will follow by email.

## 6. Manual actions on an invoice

Open an invoice from **Invoices**. Every action is recorded on its timeline with your name.

- **Mark paid offline**: for a bank transfer. Give the bank reference.
- **Void invoice**: stops the link working. If the outlet is still inside the invoicing window, the next nightly run raises a fresh proforma.
- **Reset session**: clears a stuck payment session, so the merchant's next **Renew now** opens a fresh one.
- **Re-send payer email**: emails the receipt and tax invoice again, optionally to a corrected address.
- **Retry post-payment steps**: re-runs the licence extension, tax invoice, POS update and email after a failure.
- **Re-print proforma**: redraws an open proforma with the current company details. Issued tax invoices and receipts keep theirs.

## 7. Outbound dispatch

**Settings** has a switch that pauses every outbound message, including the payer's receipt email. Invoices, PDFs and links are still generated while it is paused. Held emails go out when dispatch is resumed.

WhatsApp and email reminders are not live yet: they wait on Meta approving the message templates.
