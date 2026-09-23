"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  longDate,
  money,
  OutlinePill,
  Pill,
  plural,
  shortDateTime,
  signedMoney,
  TERM_LABEL,
  TONE_DOT,
} from "../../ui"
import type { Tone } from "../../ui"

type Invoice = {
  id: string
  invoiceNumber: string
  documentType: "proforma" | "tax_invoice"
  franchiseId: string
  companyName: string | null
  groupKey: string
  isGrouped: boolean
  itemCount: number
  billingPlanSelected: "annually" | "bi_annually" | null
  termMonths: number | null
  periodStart: string | null
  periodEnd: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  subtotalMinor: number
  adjustmentMinor: number
  taxRatePercent: number
  taxMinor: number
  totalMinor: number
  paymentEmail: string | null
  status: string
  renewalToken: string | null
  pdfObjectKey: string | null
  receiptPdfObjectKey: string | null
  firstOpenedAt: string | null
  openCount: number
  paidAt: string | null
  paidVia: "commercepay" | "manual" | null
  capTransactionNumber: string | null
  paidReference: string | null
  parentInvoiceId: string | null
  extensionStatus: "not_applicable" | "pending" | "applied" | "failed"
  posPushStatus: "not_applicable" | "pending" | "pushed" | "failed"
  payerEmailStatus: "not_applicable" | "pending" | "sent" | "failed"
  payerEmailSentAt: string | null
  payerEmailError: string | null
}

type Extension = {
  id: string
  outletId: string
  previousValidUntil: string | null
  newValidUntil: string
  termMonths: number
  linePreviousValidUntil: string | null
  appliedAt: string
  posPushStatus: "pending" | "pushed" | "failed"
  posPushAttempts: number
  posPushedAt: string | null
  posPushLastError: string | null
}

type Callback = {
  id: string
  receivedAt: string
  referenceCode: string | null
  gatewayStatusCode: number | null
  amountMinor: number | null
  outcome: string | null
  note: string | null
  signatureValid: boolean
}

type Item = {
  id: string
  outletId: string
  centralId: string | null
  outletName: string | null
  licensePlan: string | null
  billingPlan: string
  catalogAmountMinor: number | null
  effectiveAmountMinor: number
  adjustmentAmountMinor: number
  priceSource: string
  cycleOverrideMinor: number | null
  previousValidUntil: string | null
  newValidUntil: string | null
}

type Event = {
  id: string
  eventType: string
  actorUserId: string | null
  payload: unknown
  createdAt: string
}

type LinkEvent = {
  id: string
  eventType: string
  payload: unknown
  createdAt: string
}

type Session = {
  id: string
  sessionSequence: number
  referenceCode: string
  amountMinor: number
  billingPlan: string
  status: string
  capSessionNumber: string | null
  expiresAt: string | null
  createdAt: string
}

const PRICE_SOURCE_LABELS: Record<string, string> = {
  catalog: "Catalog price",
  assignment_override: "Agreed price",
  cycle_override: "One-off price",
}

type TimelineEntry = { key: string; when: string; title: string; actor: string; detail: string; tone: Tone }

function describeEvent(event: Event, invoice: Invoice): TimelineEntry {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const actor = event.actorUserId ? `user ${event.actorUserId}` : "system"
  const base = { key: `e-${event.id}`, when: shortDateTime(event.createdAt), actor }
  switch (event.eventType) {
    case "invoice_created":
      return { ...base, title: "Invoice created", tone: "blue", detail: `Proforma ${invoice.invoiceNumber} · ${plural(Number(payload.outlets ?? invoice.itemCount), "outlet")} · group ${String(payload.groupKey ?? invoice.groupKey)}` }
    case "pdf_rendered":
      return {
        ...base,
        title: payload.forced && event.actorUserId ? "Proforma re-printed" : "PDF rendered",
        tone: "gray",
        detail: String(payload.objectKey ?? ""),
      }
    case "cycle_reused":
      return { ...base, title: "Reminder run reused this invoice", tone: "blue", detail: payload.daysToExpiry !== undefined && payload.daysToExpiry !== null ? `T-${String(payload.daysToExpiry)} run` : "" }
    case "term_changed":
      return { ...base, title: `Term changed to ${TERM_LABEL[String(payload.to)] ?? String(payload.to)}`, actor: payload.by === "merchant" ? "merchant" : actor, tone: "amber", detail: `Total ${money(Number(payload.totalMinor ?? 0), invoice.currencyCode)}` }
    case "payment_session_created":
      return { ...base, title: "Payment session opened", actor: "merchant", tone: "amber", detail: `${String(payload.referenceCode ?? "")} · ${money(Number(payload.amountMinor ?? 0), invoice.currencyCode)} · ${TERM_LABEL[String(payload.term)] ?? ""}` }
    case "payment_session_resumed":
      return { ...base, title: "Payment session resumed", actor: "merchant", tone: "amber", detail: String(payload.referenceCode ?? "") }
    case "payment_session_failed":
      return { ...base, title: "Payment session could not be opened", tone: "red", detail: String(payload.message ?? "") }
    case "payment_confirmed":
      return { ...base, title: "Payment confirmed", tone: "green", detail: [payload.paidVia === "manual" ? "Recorded by staff" : payload.source === "sweep" ? "Found by the hourly gateway query" : "Gateway callback", payload.capTransactionNumber ? `txn ${String(payload.capTransactionNumber)}` : null, payload.reference ? String(payload.reference) : null].filter(Boolean).join(" · ") }
    case "offline_payment_recorded":
      return { ...base, title: "Offline payment recorded", tone: "green", detail: [payload.reference ? `Ref ${String(payload.reference)}` : null, payload.note ? String(payload.note) : null].filter(Boolean).join(" · ") }
    case "extension_applied":
      return { ...base, title: "Licence extended", tone: "green", detail: `${plural(Number(payload.outlets ?? 0), "outlet")} moved to the new expiry${Array.isArray(payload.drifted) && payload.drifted.length ? ` · ${payload.drifted.length} had moved since the invoice was raised` : ""}` }
    case "extension_failed":
      return { ...base, title: "Licence extension failed", tone: "red", detail: String(payload.detail ?? "") }
    case "tax_invoice_issued":
      return { ...base, title: "Tax invoice issued", tone: "green", detail: String(payload.taxInvoiceNumber ?? "") }
    case "receipt_rendered":
      return { ...base, title: "Receipt rendered", tone: "gray", detail: String(payload.objectKey ?? "") }
    case "pos_push_succeeded":
      return { ...base, title: "New expiry pushed to the POS", tone: "green", detail: plural(Number(payload.outlets ?? 0), "outlet") }
    case "pos_push_failed":
      return { ...base, title: "POS did not accept the new expiry", tone: "red", detail: Array.isArray(payload.failures) ? payload.failures.map(String).join("; ") : "" }
    case "payer_email_sent":
      return { ...base, title: "Documents emailed to the payer", tone: "green", detail: String(payload.to ?? "") }
    case "payer_email_failed":
      return { ...base, title: "Payer email failed", tone: "red", detail: `${String(payload.to ?? "")} · ${String(payload.message ?? "")}` }
    case "payer_email_resend_requested":
      return { ...base, title: "Payer email re-send requested", tone: "amber", detail: String(payload.to ?? "") }
    case "post_payment_retry_requested":
      return { ...base, title: "Post-payment steps queued again", tone: "amber", detail: "" }
    case "payment_session_reset":
      return { ...base, title: "Payment session reset", tone: "amber", detail: `${plural(Number(payload.superseded ?? 0), "open session")} superseded` }
    case "payment_session_failed_gateway":
    case "payment_session_cancelled":
    case "payment_session_expired":
      return { ...base, title: `Payment attempt ${event.eventType.slice("payment_session_".length)}`, actor: "gateway", tone: "amber", detail: String(payload.referenceCode ?? "") }
    case "payment_amount_mismatch":
      return { ...base, title: "Payment did not match the invoice", actor: "gateway", tone: "red", detail: `${String(payload.referenceCode ?? "")} · gateway ${money(Number(payload.amount ?? 0), invoice.currencyCode)} vs invoice ${money(Number(payload.invoiceTotalMinor ?? 0), invoice.currencyCode)}` }
    case "payment_overpayment":
      return { ...base, title: "Second payment received", actor: "gateway", tone: "red", detail: String(payload.referenceCode ?? "") }
    case "payment_refunded":
      return { ...base, title: "Refund reported by the gateway", actor: "gateway", tone: "red", detail: String(payload.referenceCode ?? "") }
    case "cycle_override_applied":
      return { ...base, title: payload.amountMinor === null ? "One-off price cleared" : "One-off price applied", tone: "amber", detail: `Outlet ${String(payload.outletId ?? "")} · ${payload.amountMinor === null ? "back to the agreed or catalog price" : money(Number(payload.amountMinor), invoice.currencyCode)}${payload.reason ? ` · ${String(payload.reason)}` : ""}${payload.approved ? " · approved" : ""}` }
    default:
      if (event.eventType.startsWith("status_")) {
        const status = event.eventType.slice("status_".length)
        return { ...base, title: INVOICE_STATUS_LABEL[status] ?? status, tone: INVOICE_STATUS_TONE[status] ?? "gray", detail: String(payload.reason ?? "") }
      }
      return { ...base, title: event.eventType, tone: "gray", detail: "" }
  }
}

function describeLinkEvent(event: LinkEvent): TimelineEntry {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const base = { key: `l-${event.id}`, when: shortDateTime(event.createdAt), actor: "merchant" }
  switch (event.eventType) {
    case "opened":
      return { ...base, title: "Renewal link opened", tone: "blue", detail: "" }
    case "term_changed":
      return { ...base, title: `Switched to ${TERM_LABEL[String(payload.term)] ?? String(payload.term)} on the page`, tone: "amber", detail: "" }
    case "pay_clicked":
      return { ...base, title: "Renew now clicked", tone: "amber", detail: "" }
    case "pdf_downloaded":
      return { ...base, title: "Proforma printed", tone: "gray", detail: "PDF downloaded from the renewal page" }
    case "receipt_viewed":
      return { ...base, title: "Receipt page viewed", tone: "blue", detail: "" }
    default:
      return { ...base, title: event.eventType, tone: "gray", detail: "" }
  }
}

export function InvoiceDetailView({
  invoiceId,
  canManage,
  canApprove,
  varianceThresholdPct,
}: {
  invoiceId: string
  canManage: boolean
  canApprove: boolean
  /** From Renewal Settings; the server enforces the same value. */
  varianceThresholdPct: number
}) {
  const { showToast } = useToast()
  const [invoice, setInvoice] = React.useState<Invoice | null>(null)
  const [items, setItems] = React.useState<Item[]>([])
  const [events, setEvents] = React.useState<Event[]>([])
  const [linkEvents, setLinkEvents] = React.useState<LinkEvent[]>([])
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [extensions, setExtensions] = React.useState<Extension[]>([])
  const [taxInvoice, setTaxInvoice] = React.useState<Invoice | null>(null)
  const [callbacks, setCallbacks] = React.useState<Callback[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [dialog, setDialog] = React.useState<"override" | "term" | "void" | "markPaid" | "resendEmail" | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/renewals/invoices/${invoiceId}`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Invoice not found.")
      }
      const payload = (await response.json()) as {
        invoice: Invoice
        items: Item[]
        events: Event[]
        linkEvents?: LinkEvent[]
        sessions?: Session[]
        extensions?: Extension[]
        taxInvoice?: Invoice | null
        callbacks?: Callback[]
      }
      setInvoice(payload.invoice)
      setItems(payload.items ?? [])
      setEvents(payload.events ?? [])
      setLinkEvents(payload.linkEvents ?? [])
      setSessions(payload.sessions ?? [])
      setExtensions(payload.extensions ?? [])
      setTaxInvoice(payload.taxInvoice ?? null)
      setCallbacks(payload.callbacks ?? [])
      setError(null)
    } catch (loadError) {
      setInvoice(null)
      setError(loadError instanceof Error ? loadError.message : "Invoice not found.")
    } finally {
      setLoading(false)
    }
  }, [invoiceId])

  React.useEffect(() => {
    void load()
  }, [load])

  async function runAction(body: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      const response = await fetch(`/api/renewals/invoices/${invoiceId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        showToast(payload.error ?? "The action could not be applied.", "error")
        return false
      }
      showToast(success, "success")
      setDialog(null)
      void load()
      return true
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading invoice…</p>
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-destructive text-sm">{error ?? "Invoice not found."}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/invoices">Back to invoices</Link>
        </Button>
      </div>
    )
  }

  const term = invoice.billingPlanSelected ?? items[0]?.billingPlan ?? "annually"
  const liveSession = sessions.find((session) => session.status === "created" || session.status === "payment_pending") ?? null
  const isOpen = !["paid", "cancelled", "superseded", "lapsed"].includes(invoice.status)
  const termLocked = Boolean(liveSession) || !isOpen
  const renewalLink = invoice.renewalToken ? `/renew/${invoice.renewalToken}` : null
  const isPaid = invoice.status === "paid"
  const canMarkPaid = canManage && invoice.documentType === "proforma" && !["paid", "cancelled", "superseded"].includes(invoice.status)
  const postPaymentIncomplete =
    isPaid &&
    invoice.documentType === "proforma" &&
    (invoice.extensionStatus !== "applied" || invoice.posPushStatus !== "pushed" || !invoice.receiptPdfObjectKey || !taxInvoice)

  const timeline: TimelineEntry[] = [
    ...events.map((event) => describeEvent(event, invoice)),
    ...linkEvents.map(describeLinkEvent),
  ].sort((a, b) => a.when.localeCompare(b.when))
  // Sorting by the formatted string would be wrong across months; sort by the
  // underlying timestamps instead.
  const timestamps = new Map<string, string>()
  events.forEach((event) => timestamps.set(`e-${event.id}`, event.createdAt))
  linkEvents.forEach((event) => timestamps.set(`l-${event.id}`, event.createdAt))
  timeline.sort((a, b) => (timestamps.get(a.key) ?? "").localeCompare(timestamps.get(b.key) ?? ""))

  const stats = [
    {
      label: isPaid ? "Total paid" : "Total due",
      value: money(invoice.totalMinor, invoice.currencyCode),
      meta: invoice.taxRatePercent > 0 ? `Includes ${invoice.taxRatePercent}% SST` : "Tax suppressed at 0%",
    },
    {
      label: "Term selected",
      value: TERM_LABEL[term] ?? term,
      meta: `Renews to ${longDate(invoice.periodEnd)}`,
    },
    {
      label: "Renewal link",
      value: invoice.openCount === 0 ? "Never opened" : `Opened ${invoice.openCount}×`,
      meta: invoice.firstOpenedAt ? `First opened ${shortDateTime(invoice.firstOpenedAt)}` : "No merchant visit yet",
    },
    {
      label: "Payment",
      value: isPaid ? "Paid" : liveSession ? "At gateway" : sessions.length === 0 ? "Not started" : "No open session",
      meta: isPaid
        ? `${invoice.paidVia === "manual" ? "Bank transfer" : "CommercePay"} · ${shortDateTime(invoice.paidAt)}${invoice.capTransactionNumber ? ` · ${invoice.capTransactionNumber}` : invoice.paidReference ? ` · ${invoice.paidReference}` : ""}`
        : liveSession
          ? `${liveSession.referenceCode} · expires ${shortDateTime(liveSession.expiresAt)}`
          : sessions.length > 0
            ? `${plural(sessions.length, "attempt")} so far`
            : "The merchant has not clicked Renew now",
    },
  ]

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/invoices">
            <ChevronLeft className="size-4" />
            Back to invoices
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          {renewalLink ? (
            <Button variant="outline" size="sm" asChild>
              <a href={renewalLink} target="_blank" rel="noreferrer">
                Open renewal link
              </a>
            </Button>
          ) : null}
          {renewalLink ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const link = `${window.location.origin}${renewalLink}`
                void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))
                window.setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? "Link copied" : "Copy renewal link"}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/renewals/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">
              {invoice.documentType === "tax_invoice" ? "Download tax invoice PDF" : "Download proforma PDF"}
            </a>
          </Button>
          {isPaid && invoice.receiptPdfObjectKey ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/renewals/invoices/${invoice.id}/pdf?document=receipt`} target="_blank" rel="noreferrer">
                Download receipt
              </a>
            </Button>
          ) : null}
          {taxInvoice ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/renewals/invoices/${taxInvoice.id}/pdf`} target="_blank" rel="noreferrer">
                Download tax invoice {taxInvoice.invoiceNumber}
              </a>
            </Button>
          ) : null}
          {canMarkPaid ? (
            <Button size="sm" disabled={busy} onClick={() => setDialog("markPaid")}>
              Mark paid offline
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-mono text-[1.375rem] font-semibold">{invoice.invoiceNumber}</h1>
          <Pill tone={INVOICE_STATUS_TONE[invoice.status] ?? "gray"}>
            {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
          </Pill>
          {invoice.isGrouped ? (
            <Pill tone="blue" className="font-medium">
              Grouped · {plural(invoice.itemCount, "outlet")}
            </Pill>
          ) : null}
          <OutlinePill>{termLocked ? "Term locked" : "Term unlocked"}</OutlinePill>
        </div>
        <p className="text-muted-foreground mt-1.5 text-sm">
          {invoice.companyName ?? `Franchise ${invoice.franchiseId}`} · FID {invoice.franchiseId} · group key{" "}
          <span className="font-mono text-xs">{invoice.groupKey}</span> · issued {longDate(invoice.issueDate)} · due{" "}
          {longDate(invoice.dueDate)}
        </p>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card rounded-[var(--radius)] border px-4 py-3.5">
            <div className="text-muted-foreground text-xs">{stat.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</div>
            <div className="text-muted-foreground mt-0.5 text-xs">{stat.meta}</div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items</CardTitle>
            <CardDescription>
              One line per outlet, each carrying its own plan, catalog price, effective price, and price source.
            </CardDescription>
            {canManage && isOpen ? (
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setDialog("override")}>
                  One-off price
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 border-b py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">{item.outletName ?? `Outlet ${item.outletId}`}</span>
                  <span className="text-muted-foreground text-xs">
                    OID {item.outletId}
                    {item.centralId ? ` · ${item.centralId}` : ""}
                    {item.licensePlan ? ` · ${item.licensePlan.charAt(0).toUpperCase()}${item.licensePlan.slice(1)}` : ""} ·{" "}
                    {TERM_LABEL[item.billingPlan] ?? item.billingPlan} · renews to {longDate(item.newValidUntil ?? null) === "—" ? longDate(item.previousValidUntil) : longDate(item.newValidUntil)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-sm tabular-nums">{money(item.effectiveAmountMinor, invoice.currencyCode)}</span>
                  <span className={cn("text-xs", item.adjustmentAmountMinor !== 0 ? (item.adjustmentAmountMinor < 0 ? "text-amber-700" : "text-sky-700") : "text-muted-foreground")}>
                    {PRICE_SOURCE_LABELS[item.priceSource] ?? item.priceSource}
                    {item.adjustmentAmountMinor !== 0 ? ` · ${signedMoney(item.adjustmentAmountMinor, invoice.currencyCode)}` : ""}
                  </span>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-1.5 pt-3.5 text-sm">
              <div className="text-muted-foreground flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(invoice.subtotalMinor, invoice.currencyCode)}</span>
              </div>
              {invoice.taxRatePercent > 0 ? (
                <div className="text-muted-foreground flex justify-between">
                  <span>SST {invoice.taxRatePercent}% (exclusive)</span>
                  <span className="tabular-nums">{money(invoice.taxMinor, invoice.currencyCode)}</span>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(invoice.totalMinor, invoice.currencyCode)}</span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {invoice.taxRatePercent > 0
                  ? "Tax is calculated on the subtotal and added to it. Plan prices are never treated as tax-inclusive."
                  : "Slurp is not SST-registered, so the rate is 0% and the tax line is suppressed on the document."}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {isPaid && invoice.documentType === "proforma" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">After payment</CardTitle>
                <CardDescription>
                  Each step is recorded on its own. A failure here never touches the payment.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col">
                  <StepRow
                    label="Licence extension"
                    tone={invoice.extensionStatus === "applied" ? "green" : invoice.extensionStatus === "failed" ? "red" : "amber"}
                    value={invoice.extensionStatus === "applied" ? "Applied" : invoice.extensionStatus === "failed" ? "Failed" : "Pending"}
                    detail={
                      extensions.length > 0
                        ? extensions
                            .map((extension) => `${items.find((item) => item.outletId === extension.outletId)?.outletName ?? `Outlet ${extension.outletId}`}: ${longDate(extension.previousValidUntil)} → ${longDate(extension.newValidUntil)}${extension.linePreviousValidUntil ? " (had moved since invoicing)" : ""}`)
                            .join(" · ")
                        : "Every outlet moves from its previous expiry by the paid term."
                    }
                  />
                  <StepRow
                    label="Tax invoice"
                    tone={taxInvoice ? "green" : "amber"}
                    value={taxInvoice ? taxInvoice.invoiceNumber : "Pending"}
                    detail={taxInvoice ? `Issued ${longDate(taxInvoice.issueDate)}${taxInvoice.pdfObjectKey ? " · PDF stored" : " · PDF renders on first download"}` : "Issued by the post-payment job."}
                    href={taxInvoice ? `/renewal-retention/invoices/${taxInvoice.id}` : undefined}
                  />
                  <StepRow
                    label="Receipt"
                    tone={invoice.receiptPdfObjectKey ? "green" : "amber"}
                    value={invoice.receiptPdfObjectKey ? "Rendered" : "Pending"}
                    detail={invoice.receiptPdfObjectKey ?? "Rendered by the post-payment job."}
                  />
                  <StepRow
                    label="POS expiry push"
                    tone={invoice.posPushStatus === "pushed" ? "green" : invoice.posPushStatus === "failed" ? "red" : "amber"}
                    value={invoice.posPushStatus === "pushed" ? "Pushed" : invoice.posPushStatus === "failed" ? "Failed" : "Pending"}
                    detail={
                      extensions.length > 0
                        ? extensions
                            .map((extension) => `${extension.outletId}: ${extension.posPushStatus}${extension.posPushLastError ? ` (${extension.posPushLastError})` : ""}${extension.posPushAttempts > 1 ? ` · ${extension.posPushAttempts} attempts` : ""}`)
                            .join(" · ")
                        : "PATCH /api/outlet-valid-until per outlet, after the extension lands."
                    }
                  />
                  <StepRow
                    label="Payer email"
                    tone={invoice.payerEmailStatus === "sent" ? "green" : invoice.payerEmailStatus === "failed" ? "red" : invoice.payerEmailStatus === "not_applicable" ? "gray" : "amber"}
                    value={invoice.payerEmailStatus === "sent" ? "Sent" : invoice.payerEmailStatus === "failed" ? "Failed" : invoice.payerEmailStatus === "not_applicable" ? "No address" : "Pending"}
                    detail={
                      invoice.payerEmailStatus === "sent"
                        ? `${invoice.paymentEmail ?? ""} · ${shortDateTime(invoice.payerEmailSentAt)}`
                        : invoice.payerEmailStatus === "failed"
                          ? `${invoice.paymentEmail ?? ""} · ${invoice.payerEmailError ?? ""}`
                          : invoice.paymentEmail ?? "No payer email was entered at payment."
                    }
                  />
                  {callbacks.length > 0 ? (
                    <StepRow
                      label="Gateway callbacks"
                      tone={callbacks.some((callback) => callback.outcome === "rejected_signature") ? "red" : "gray"}
                      value={plural(callbacks.length, "callback")}
                      detail={callbacks.map((callback) => `${shortDateTime(callback.receivedAt)} ${callback.outcome ?? "?"}${callback.signatureValid ? "" : " (unsigned)"}`).join(" · ")}
                    />
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Manual actions</CardTitle>
                <CardDescription>Every action is recorded in the timeline with the acting user.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {invoice.status === "draft" ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void runAction({ action: "issue" }, "Invoice issued.")}>
                      Issue invoice
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" disabled={!isOpen || busy} onClick={() => setDialog("term")}>
                    Override term
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!liveSession || busy}
                    title={liveSession ? "Supersede the open gateway session so the merchant starts a fresh one" : "No open payment session"}
                    onClick={() => void runAction({ action: "reset_session" }, "Payment session reset. The merchant's next Renew now opens a fresh one.")}
                  >
                    Reset payment session
                  </Button>
                  <Button variant="outline" size="sm" disabled title="Arrives with Respond.io dispatch">
                    Resend dispatch
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isPaid || busy}
                    title={isPaid ? "Email the receipt and tax invoice again" : "Available once the invoice is paid"}
                    onClick={() => setDialog("resendEmail")}
                  >
                    Re-send payer email
                  </Button>
                  {postPaymentIncomplete ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void runAction({ action: "retry_post_payment" }, "Post-payment steps queued and run.")}
                    >
                      Retry post-payment steps
                    </Button>
                  ) : null}
                  {invoice.documentType === "proforma" && isOpen ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      title="Re-print with the current company details. Issued tax invoices and receipts keep theirs."
                      onClick={() => void runAction({ action: "reprint_proforma" }, "Proforma re-printed with the current details.")}
                    >
                      Re-print proforma
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" className="text-destructive" disabled={!isOpen || busy} onClick={() => setDialog("void")}>
                    Void invoice
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>Invoice events, payment sessions, and link events in one chronology.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col">
                {timeline.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-sm">Nothing recorded yet.</p>
                ) : null}
                {timeline.map((entry) => (
                  <div key={entry.key} className="grid grid-cols-[7.5rem_1fr] gap-3 border-b py-2.5">
                    <span className="text-muted-foreground text-xs">{entry.when}</span>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("size-1.5 rounded-full", TONE_DOT[entry.tone])} />
                        <span className="text-[0.8125rem] font-medium">{entry.title}</span>
                        <span className="text-muted-foreground text-[0.6875rem]">{entry.actor}</span>
                      </span>
                      {entry.detail ? <span className="text-muted-foreground text-xs">{entry.detail}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <CycleOverrideDialog
        open={dialog === "override"}
        onOpenChange={(open) => setDialog(open ? "override" : null)}
        invoice={invoice}
        items={items}
        canApprove={canApprove}
        varianceThresholdPct={varianceThresholdPct}
        onSaved={() => {
          setDialog(null)
          void load()
        }}
      />

      <Dialog open={dialog === "term"} onOpenChange={(open) => setDialog(open ? "term" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override term</DialogTitle>
            <DialogDescription>
              Reprices every line on the chosen term and re-renders the document. An open payment session is
              superseded because the amount changes.
            </DialogDescription>
          </DialogHeader>
          <TermPicker
            current={term}
            currency={invoice.currencyCode}
            disabled={busy}
            onPick={(next) => void runAction({ action: "set_term", term: next }, `Term set to ${TERM_LABEL[next]}.`)}
          />
        </DialogContent>
      </Dialog>

      <MarkPaidDialog
        open={dialog === "markPaid"}
        onOpenChange={(open) => setDialog(open ? "markPaid" : null)}
        invoice={invoice}
        busy={busy}
        onConfirm={(input) => void runAction({ action: "mark_paid_offline", ...input }, "Payment recorded. Extension, tax invoice and documents follow.")}
      />

      <ResendEmailDialog
        open={dialog === "resendEmail"}
        onOpenChange={(open) => setDialog(open ? "resendEmail" : null)}
        currentEmail={invoice.paymentEmail}
        busy={busy}
        onConfirm={(email) => void runAction({ action: "resend_payer_email", ...(email ? { payerEmail: email } : {}) }, "Documents sent.")}
      />

      <VoidDialog
        open={dialog === "void"}
        onOpenChange={(open) => setDialog(open ? "void" : null)}
        invoiceNumber={invoice.invoiceNumber}
        busy={busy}
        onConfirm={(reason) => void runAction({ action: "void", reason }, "Invoice voided.")}
      />
    </div>
  )
}

function TermPicker({
  current,
  disabled,
  onPick,
}: {
  current: string
  currency: string
  disabled: boolean
  onPick: (term: "annually" | "bi_annually") => void
}) {
  const [term, setTerm] = React.useState<"annually" | "bi_annually">(current === "bi_annually" ? "annually" : "bi_annually")
  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-2">
        <Label htmlFor="overrideTerm">New term</Label>
        <Select value={term} onValueChange={(value) => setTerm(value as "annually" | "bi_annually")}>
          <SelectTrigger id="overrideTerm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="annually" disabled={current === "annually"}>1 year{current === "annually" ? " (current)" : ""}</SelectItem>
            <SelectItem value="bi_annually" disabled={current === "bi_annually"}>6 months{current === "bi_annually" ? " (current)" : ""}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          The term is refused if any line has no price on it, or if the repriced line would need override approval.
        </p>
      </div>
      <DialogFooter>
        <Button size="sm" disabled={disabled || term === current} onClick={() => onPick(term)}>
          {disabled ? "Applying…" : `Apply ${TERM_LABEL[term]}`}
        </Button>
      </DialogFooter>
    </div>
  )
}

function VoidDialog({
  open,
  onOpenChange,
  invoiceNumber,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceNumber: string
  busy: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = React.useState("")
  React.useEffect(() => {
    if (open) setReason("")
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void {invoiceNumber}</DialogTitle>
          <DialogDescription>
            The renewal link stops working and any open payment session is superseded. The nightly run raises a
            fresh proforma for these outlets if they are still inside the invoicing window. A paid invoice cannot be voided.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="voidReason">Why</Label>
          <Textarea id="voidReason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Recorded in the timeline" />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {busy ? "Voiding…" : "Void invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CycleOverrideDialog({
  open,
  onOpenChange,
  invoice,
  items,
  canApprove,
  varianceThresholdPct,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: Invoice
  items: Item[]
  canApprove: boolean
  varianceThresholdPct: number
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [itemId, setItemId] = React.useState<string>(items[0]?.id ?? "")
  const [amount, setAmount] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      const first = items[0]
      setItemId(first?.id ?? "")
      setAmount(first?.cycleOverrideMinor !== null && first?.cycleOverrideMinor !== undefined ? (first.cycleOverrideMinor / 100).toFixed(2) : "")
      setReason("")
      setError(null)
    }
  }, [open, items])

  const item = items.find((entry) => entry.id === itemId) ?? null
  const baseline = item?.catalogAmountMinor ?? null
  const parsed = amount.trim() ? Math.round(Number(amount.replace(/,/g, "")) * 100) : null
  const variance =
    baseline && parsed !== null && Number.isFinite(parsed)
      ? { deltaMinor: parsed - baseline, pct: ((parsed - baseline) / baseline) * 100 }
      : null

  async function save(clear: boolean) {
    if (!item) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/renewals/invoices/${invoice.id}/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: clear ? null : amount.trim(), reason: clear ? null : reason.trim() }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? "Unable to apply the one-off price.")
        return
      }
      showToast(clear ? "One-off price cleared." : "One-off price applied.", "success")
      onSaved()
    } catch {
      setError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>One-off price</DialogTitle>
          <DialogDescription>
            Applies to this invoice line only. The outlet&apos;s agreed or catalog price is untouched, so the next invoice prices from it again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="overrideItem">Line item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger id="overrideItem" className="w-full">
                <SelectValue placeholder="Choose an outlet" />
              </SelectTrigger>
              <SelectContent>
                {items.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.outletName ?? `Outlet ${entry.outletId}`} · OID {entry.outletId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="overrideAmount">One-off price (MYR)</Label>
              <Input id="overrideAmount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1150.00" />
              <p className="text-muted-foreground text-xs">
                {baseline !== null ? `Catalog price ${money(baseline, invoice.currencyCode)}` : "No baseline price on this line"}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Adjustment</Label>
              <div
                className={cn(
                  "bg-muted/40 rounded-[calc(var(--radius)-2px)] border px-3 py-2 text-sm",
                  variance === null ? "text-muted-foreground" : Math.abs(variance.pct) > varianceThresholdPct ? "text-red-700" : variance.deltaMinor < 0 ? "text-amber-700" : "text-sky-700"
                )}
              >
                {variance === null
                  ? "—"
                  : variance.deltaMinor === 0
                    ? "Same as catalog"
                    : `${signedMoney(variance.deltaMinor, invoice.currencyCode)} (${variance.pct > 0 ? "+" : "−"}${Math.abs(variance.pct).toFixed(1)}%)`}
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="overrideReason">Reason</Label>
            <Input id="overrideReason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mandatory. Recorded on the line item." />
          </div>
          <p className="text-muted-foreground text-xs">
            {variance && Math.abs(variance.pct) > varianceThresholdPct
              ? canApprove
                ? `This is more than ${varianceThresholdPct}% from the catalog price. Your price-approval access lets you apply it; the approval is recorded against you.`
                : `This is more than ${varianceThresholdPct}% from the catalog price and needs someone with price-approval access.`
              : "The next invoice prices from the agreed or catalog price again, with no manual reset."}
          </p>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          {item?.cycleOverrideMinor !== null && item?.cycleOverrideMinor !== undefined ? (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save(true)}>
              Clear one-off price
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || !item || !amount.trim() || !reason.trim()} onClick={() => void save(false)}>
            {saving ? "Applying…" : "Apply one-off price"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepRow({
  label,
  value,
  tone,
  detail,
  href,
}: {
  label: string
  value: string
  tone: Tone
  detail: string
  href?: string
}) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 border-b py-2.5 last:border-b-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
          {href ? (
            <Link href={href} className="text-[0.8125rem] font-medium underline-offset-2 hover:underline">
              {value}
            </Link>
          ) : (
            <span className="text-[0.8125rem] font-medium">{value}</span>
          )}
        </span>
        <span className="text-muted-foreground text-xs break-words">{detail}</span>
      </span>
    </div>
  )
}

function MarkPaidDialog({
  open,
  onOpenChange,
  invoice,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: Invoice
  busy: boolean
  onConfirm: (input: { reference: string; note?: string; payerEmail?: string }) => void
}) {
  const [reference, setReference] = React.useState("")
  const [note, setNote] = React.useState("")
  const [email, setEmail] = React.useState(invoice.paymentEmail ?? "")
  React.useEffect(() => {
    if (open) {
      setReference("")
      setNote("")
      setEmail(invoice.paymentEmail ?? "")
    }
  }, [open, invoice.paymentEmail])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {invoice.invoiceNumber} paid</DialogTitle>
          <DialogDescription>
            For a bank transfer or other payment made outside the gateway. Settles the invoice for{" "}
            {money(invoice.totalMinor, invoice.currencyCode)}, extends every outlet from its previous expiry, issues the
            tax invoice and pushes the new dates to the POS. Any open gateway session is superseded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="paidReference">Payment reference</Label>
            <Input id="paidReference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank reference or receipt number" maxLength={120} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="paidEmail">Email the documents to</Label>
            <Input id="paidEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" maxLength={255} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="paidNote">Note</Label>
            <Textarea id="paidNote" rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Recorded in the timeline" maxLength={500} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !reference.trim()}
            onClick={() =>
              onConfirm({
                reference: reference.trim(),
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(email.trim() ? { payerEmail: email.trim().toLowerCase() } : {}),
              })
            }
          >
            {busy ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResendEmailDialog({
  open,
  onOpenChange,
  currentEmail,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEmail: string | null
  busy: boolean
  onConfirm: (email: string | null) => void
}) {
  const [email, setEmail] = React.useState(currentEmail ?? "")
  React.useEffect(() => {
    if (open) setEmail(currentEmail ?? "")
  }, [open, currentEmail])
  const changed = email.trim().toLowerCase() !== (currentEmail ?? "")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Re-send the receipt and tax invoice</DialogTitle>
          <DialogDescription>
            Sends both PDFs again. Change the address to correct a typo the merchant made at payment; the new address
            is kept on the invoice.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="resendEmail">Send to</Label>
          <Input id="resendEmail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={255} />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || !email.trim()} onClick={() => onConfirm(changed ? email.trim().toLowerCase() : null)}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
