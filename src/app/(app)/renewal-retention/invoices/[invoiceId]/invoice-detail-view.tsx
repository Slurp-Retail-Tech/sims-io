"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import {
  formatDateOnly,
  formatMinor,
  STATUS_CLASSES,
  STATUS_LABELS,
  TERM_LABELS,
} from "../invoice-format"

type Invoice = {
  id: string
  invoiceNumber: string
  documentType: "proforma" | "tax_invoice"
  franchiseId: string
  companyName: string | null
  groupKey: string
  isGrouped: boolean
  billingPlanSelected: string | null
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
  status: string
  firstOpenedAt: string | null
  openCount: number
  paidAt: string | null
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
  previousValidUntil: string | null
}

type Event = {
  id: string
  eventType: string
  actorUserId: string | null
  payload: unknown
  createdAt: string
}

const PRICE_SOURCE_LABELS: Record<string, string> = {
  catalog: "Catalog price",
  assignment_override: "Agreed price",
  cycle_override: "One-off price",
}

export function InvoiceDetailView({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = React.useState<Invoice | null>(null)
  const [items, setItems] = React.useState<Item[]>([])
  const [events, setEvents] = React.useState<Event[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/renewals/invoices/${invoiceId}`, {
          cache: "no-store",
        })
        if (!response.ok) {
          throw new Error("Invoice not found.")
        }
        const payload = (await response.json()) as {
          invoice: Invoice
          items: Item[]
          events: Event[]
        }
        if (cancelled) return
        setInvoice(payload.invoice)
        setItems(payload.items ?? [])
        setEvents(payload.events ?? [])
        setError(null)
      } catch (loadError) {
        if (cancelled) return
        setInvoice(null)
        setError(
          loadError instanceof Error ? loadError.message : "Invoice not found."
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [invoiceId])

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

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/renewal-retention/invoices">
            <ChevronLeft className="size-4" />
            Back to invoices
          </Link>
        </Button>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs",
            STATUS_CLASSES[invoice.status] ?? "bg-muted text-muted-foreground"
          )}
        >
          {STATUS_LABELS[invoice.status] ?? invoice.status}
        </span>
      </div>

      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {invoice.invoiceNumber}
        </h1>
        <p className="text-muted-foreground text-sm">
          {invoice.companyName ?? `Franchise ${invoice.franchiseId}`}
          {invoice.isGrouped
            ? ` · grouped, ${items.length} ${items.length === 1 ? "outlet" : "outlets"}`
            : ""}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outlets billed</CardTitle>
              <CardDescription>
                Every line records the list price, what is actually charged, and
                which rule produced it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col">
                <div className="text-muted-foreground grid grid-cols-[1.6fr_1fr_0.9fr_0.9fr] gap-3 px-1 pb-2 text-xs font-medium">
                  <span>Outlet</span>
                  <span>Renews from</span>
                  <span className="text-right">List</span>
                  <span className="text-right">Charged</span>
                </div>
                <Separator />
                {items.map((item) => (
                  <div key={item.id}>
                    <div className="grid grid-cols-[1.6fr_1fr_0.9fr_0.9fr] items-center gap-3 px-1 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">
                          {item.outletName ?? `Outlet ${item.outletId}`}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          OID {item.outletId}
                          {item.priceSource !== "catalog"
                            ? ` · ${PRICE_SOURCE_LABELS[item.priceSource] ?? item.priceSource}`
                            : ""}
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateOnly(item.previousValidUntil)}
                      </span>
                      <span className="text-muted-foreground text-right text-xs tabular-nums">
                        {formatMinor(item.catalogAmountMinor)}
                      </span>
                      <span className="text-right tabular-nums">
                        {formatMinor(item.effectiveAmountMinor)}
                      </span>
                    </div>
                    <Separator />
                  </div>
                ))}

                <div className="flex flex-col items-end gap-1 pt-4 text-sm">
                  <Row label="Subtotal" value={formatMinor(invoice.subtotalMinor)} />
                  {invoice.taxRatePercent > 0 ? (
                    <Row
                      label={`Tax (${invoice.taxRatePercent}%)`}
                      value={formatMinor(invoice.taxMinor)}
                    />
                  ) : null}
                  <Row
                    label="Total"
                    value={formatMinor(invoice.totalMinor, invoice.currencyCode)}
                    emphasis
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>
                Everything that has happened to this invoice, in order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm">No events yet.</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {events.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="text-muted-foreground w-40 shrink-0 text-xs">
                        {event.createdAt.slice(0, 19).replace("T", " ")}
                      </span>
                      <span>
                        {humaniseEvent(event.eventType)}
                        {event.actorUserId ? null : (
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            · automatic
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Detail label="Issued" value={formatDateOnly(invoice.issueDate)} />
            <Detail label="Due" value={formatDateOnly(invoice.dueDate)} />
            <Detail
              label="Term"
              value={
                invoice.billingPlanSelected
                  ? TERM_LABELS[invoice.billingPlanSelected]
                  : "Not chosen"
              }
            />
            <Detail
              label="Renewal period"
              value={`${formatDateOnly(invoice.periodStart)} → ${formatDateOnly(invoice.periodEnd)}`}
            />
            <Detail
              label="Link opened"
              value={
                invoice.firstOpenedAt
                  ? `${invoice.openCount} ${invoice.openCount === 1 ? "time" : "times"}, first ${formatDateOnly(invoice.firstOpenedAt)}`
                  : "Not opened"
              }
            />
            <Detail label="Paid" value={formatDateOnly(invoice.paidAt)} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex w-56 justify-between gap-4">
      <span className={cn("text-muted-foreground", emphasis && "font-medium")}>
        {label}
      </span>
      <span className={cn("tabular-nums", emphasis && "font-semibold")}>
        {value}
      </span>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div>{value}</div>
    </div>
  )
}

/** Event types are stored as machine names; this is the reader's version. */
function humaniseEvent(eventType: string): string {
  const known: Record<string, string> = {
    invoice_created: "Invoice raised by the nightly run",
    cycle_reused: "Reminder cycle reached this invoice again",
    status_issued: "Marked issued",
    status_sent: "Sent to the merchant",
    status_payment_pending: "Awaiting payment at the gateway",
    status_paid: "Payment confirmed",
    status_cancelled: "Cancelled",
    status_superseded: "Superseded by its tax invoice",
    status_lapsed: "Lapsed",
  }
  return known[eventType] ?? eventType.replace(/_/g, " ")
}
