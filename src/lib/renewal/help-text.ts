/**
 * The tooltip copy for the Renewal & Retention screens, in one place.
 *
 * Each entry answers the question a person hovering would ask: what does
 * this status mean, how is this figure counted, why is this button greyed
 * out. Kept beside the module rather than inline so the wording is reviewed
 * once and reads the same on every screen.
 *
 * Pure strings; safe to import from client components.
 */

/** What each invoice status means for the merchant and for staff. */
export const INVOICE_STATUS_HELP: Record<string, string> = {
  draft: "Raised but not issued yet. The merchant's link works; issue it to make it a live document.",
  issued: "Live and payable. No reminder has been sent on it yet.",
  sent: "Live and payable, and at least one reminder has gone out.",
  payment_pending: "The merchant opened checkout. The gateway holds a session until it is paid, expires or is reset.",
  paid: "Payment confirmed. The licence extends, and the tax invoice and receipt follow.",
  lapsed: "Unpaid past the due date and the grace window. Its outlets are non-renewed.",
  cancelled: "Voided by staff. Its link no longer opens.",
  superseded: "Replaced by a newer document for the same renewal.",
}

/** What each Renewal List state means. Keys follow `RenewalState`. */
export const RENEWAL_STATE_HELP: Record<string, string> = {
  not_due: "Not inside the invoicing window yet. The nightly check raises a document as the expiry approaches.",
  invoiced: "A document is open and the merchant can pay. No reminder has gone out yet.",
  reminder_sent: "A document is open and the merchant has been reminded.",
  awaiting_payment: "The merchant is at checkout.",
  renewed: "Paid. The new expiry is in SIMS and on its way to the POS.",
  non_renewed: "Expired unpaid, or recorded as not renewing. Record why, so it counts on Analytics.",
  on_hold: "On billing hold: nothing is raised or sent until the hold is lifted.",
  action_required: "Something blocks a document being raised. See Actions Required.",
  reseller: "Billed by the reseller, not by Slurp. SIMS raises nothing for it.",
}

/** How each headline figure is counted. */
export const METRIC_HELP = {
  renewable: "Outlets expiring in the period, less reseller-billed, on billing hold and blocked by Actions Required.",
  renewed: "Renewable outlets paid within the same cohort.",
  retention: "Renewed ÷ renewable, inside one cohort period, so it can never exceed 100%.",
  collected: "The total of paid invoices for outlets expiring in the period.",
  collectionRate: "Collected revenue ÷ the resolved price of every renewable outlet at the default term.",
  openRate: "Invoices with at least one recorded open of the renewal link ÷ invoices raised.",
  expiringIn30: "Live, Slurp-billed outlets whose licence expires in the next 30 days.",
  actions: "Open entries in Actions Required. Blocking ones stop a document being raised.",
} as const

/** What a billing profile status means. */
export const BILLING_PROFILE_HELP = {
  auto: "Matched by the importer: exactly one Bukku contact fits this franchise's name or email. Confirm it once checked.",
  confirmed: "Linked to a Bukku contact by a person. A new import refreshes its details.",
  manual: "Entered by hand. Imports never overwrite it.",
  review: "Several Bukku contacts could be this franchise. Pick the right one.",
  missing: "No billing profile. Documents print the company name alone, with no SSM or TIN.",
} as const
