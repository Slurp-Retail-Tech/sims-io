/**
 * How each Actions Required reason reads to the person who has to fix it.
 *
 * Written as an instruction rather than a diagnosis: the queue exists to be
 * worked, and "no plan assigned" is a label whereas "assign a plan" is a task.
 */
export const REASON_LABELS: Record<string, string> = {
  no_plan_assigned: "No plan assigned",
  plan_missing_term_price: "Plan has no price for this term",
  override_pending_approval: "Price override awaiting approval",
  override_rejected: "Price override was rejected",
  no_renewal_pic: "Nobody accountable for the renewal",
  ambiguous_renewal_pic: "Outlets disagree on who is accountable",
  unreachable_renewal_pic: "Renewal contact cannot be reached",
  channel_unreachable: "One channel could not be used",
  missing_valid_until: "No expiry date recorded",
  dispatch_failed: "Message could not be delivered",
  payment_amount_mismatch: "Payment did not match the invoice",
  extension_failed: "Expiry date could not be extended",
  pos_push_failed: "New expiry date not yet in the POS",
  pos_valid_until_drift: "Renewed outside SIMS",
  payer_email_failed: "Documents could not be emailed",
  overpayment: "Paid more than once",
}

export const REASON_FIXES: Record<string, string> = {
  no_plan_assigned: "Assign a plan to this outlet, or to its franchise.",
  plan_missing_term_price: "Add the missing price to the plan.",
  override_pending_approval:
    "Someone with override approval needs to accept or reject the price.",
  override_rejected:
    "Assign the plan again at an acceptable price, or without an override.",
  no_renewal_pic:
    "Mark a contact as renewal PIC for this outlet or its franchise.",
  ambiguous_renewal_pic:
    "Name a franchise-wide renewal PIC, so the grouped invoice has one addressee.",
  unreachable_renewal_pic:
    "Add a phone number or an email address to the renewal contact, or change which channels they use.",
  channel_unreachable:
    "Add the missing detail, or switch that channel off for this contact.",
  missing_valid_until: "This outlet has no expiry date to renew from.",
  dispatch_failed: "Check the contact's details and resend.",
  payment_amount_mismatch: "Review the payment against the invoice before acting.",
  extension_failed:
    "The payment stands. Retry the extension once the cause is understood.",
  pos_push_failed:
    "The renewal is recorded in SIMS. The new date still needs to reach the POS.",
  pos_valid_until_drift:
    "The POS shows a later expiry than SIMS. Decide which is right.",
  payer_email_failed: "Resend the documents to a corrected address.",
  overpayment: "Review both payments before refunding either.",
}
