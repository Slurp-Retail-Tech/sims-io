/**
 * The steps between an empty renewal module and a first invoice, each ticked
 * off from real data.
 *
 * Getting one invoice out spans three screens and a clock nobody can see:
 * company details in Settings, a plan in the Plan Catalog and assigned to
 * outlets, a renewal PIC on Contacts (a different workspace) with a channel
 * enabled, then the nightly check. Nothing used to lay that sequence out, and
 * the person who commissioned the module still had to ask where to assign a
 * plan. This is the sequence, in order, with a link to each screen.
 *
 * The queue-based steps say "not checked yet" until the nightly check has
 * succeeded once, never "done": an empty queue before any check means nothing
 * has been examined, not that nothing is wrong.
 *
 * Pure and runtime-free so the rules are unit-tested.
 */

export type StepState = "done" | "todo" | "not_checked"

export type StepKey = "company" | "plan" | "assigned" | "pic" | "reachable" | "first_check"

export type ChecklistStep = {
  key: StepKey
  title: string
  state: StepState
  /** What to do, or why it cannot be confirmed yet. */
  detail: string
  href: string
  cta: string
}

export type ChecklistInput = {
  sellerConfigured: boolean
  activePlanCount: number
  /** True once the nightly check has succeeded at least once. */
  checkHasSucceeded: boolean
  /** Open blocking Actions Required entries, by reason. */
  open: {
    noPlan: number
    noPic: number
    ambiguousPic: number
    unreachablePic: number
  }
}

export type SetupChecklist = {
  steps: ChecklistStep[]
  doneCount: number
  complete: boolean
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`

export function buildSetupChecklist(input: ChecklistInput): SetupChecklist {
  const { sellerConfigured, activePlanCount, checkHasSucceeded, open } = input

  // A step that depends on the queue cannot be confirmed before a check runs.
  const queueStep = (count: number): StepState =>
    !checkHasSucceeded ? "not_checked" : count === 0 ? "done" : "todo"
  const notCheckedDetail = "Not checked yet. The nightly check confirms this after its first run."

  const picCount = open.noPic + open.ambiguousPic

  const steps: ChecklistStep[] = [
    {
      key: "company",
      title: "Add your company details",
      state: sellerConfigured ? "done" : "todo",
      detail: sellerConfigured
        ? "Printed on every proforma, tax invoice and receipt."
        : "Every proforma, tax invoice and receipt prints them. Without them documents carry only a default name.",
      href: "/renewal-retention/settings",
      cta: "Add company details",
    },
    {
      key: "plan",
      title: "Create a plan",
      state: activePlanCount > 0 ? "done" : "todo",
      detail:
        activePlanCount > 0
          ? `${plural(activePlanCount, "active plan")} in the catalog.`
          : "A plan holds the 1-year and 6-month prices an outlet renews at.",
      href: "/renewal-retention/plans",
      cta: "Create a plan",
    },
    {
      key: "assigned",
      title: "Put outlets on a plan",
      state: queueStep(open.noPlan),
      detail: !checkHasSucceeded
        ? notCheckedDetail
        : open.noPlan === 0
          ? "Every outlet expiring soon resolves to a plan."
          : `${plural(open.noPlan, "outlet")} expiring soon ${open.noPlan === 1 ? "has" : "have"} no plan. Assign one to the outlet or its whole franchise.`,
      href: open.noPlan > 0 ? "/renewal-retention/actions-required" : "/renewal-retention/plans",
      cta: "See which outlets",
    },
    {
      key: "pic",
      title: "Name a renewal PIC",
      state: queueStep(picCount),
      detail: !checkHasSucceeded
        ? notCheckedDetail
        : picCount === 0
          ? "Every outlet expiring soon has someone accountable."
          : `${plural(picCount, "outlet")} ${picCount === 1 ? "has" : "have"} nobody accountable. Mark a contact as renewal PIC on the Contacts page.`,
      href: "/contacts",
      cta: "Open Contacts",
    },
    {
      key: "reachable",
      title: "Make sure the PIC can be reached",
      state: queueStep(open.unreachablePic),
      detail: !checkHasSucceeded
        ? notCheckedDetail
        : open.unreachablePic === 0
          ? "Every renewal PIC has a usable channel."
          : `${plural(open.unreachablePic, "renewal PIC")} ${open.unreachablePic === 1 ? "has" : "have"} no usable channel. Enable Email or WhatsApp with an address on the contact.`,
      href: "/contacts",
      cta: "Fix contacts",
    },
    {
      key: "first_check",
      title: "Let the nightly check run",
      state: checkHasSucceeded ? "done" : "todo",
      detail: checkHasSucceeded
        ? "The check runs every night and raises invoices for eligible outlets."
        : "It runs every night. The steps above are confirmed, and invoices raised, after its first run.",
      href: "/renewal-retention/actions-required",
      cta: "Open Actions Required",
    },
  ]

  const doneCount = steps.filter((step) => step.state === "done").length
  return { steps, doneCount, complete: doneCount === steps.length }
}
