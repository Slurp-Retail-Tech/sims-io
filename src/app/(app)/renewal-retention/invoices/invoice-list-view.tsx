"use client"

import * as React from "react"
import Link from "next/link"
import { Receipt } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import {
  ColumnHeadings,
  daysUntil,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  longDate,
  money,
  PageHeader,
  Pill,
  plural,
  TERM_LABEL,
  TONE_TEXT,
} from "../ui"

type Invoice = {
  id: string
  invoiceNumber: string
  documentType: "proforma" | "tax_invoice"
  franchiseId: string
  companyName: string | null
  isGrouped: boolean
  itemCount: number
  billingPlanSelected: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  totalMinor: number
  status: string
  firstOpenedAt: string | null
  openCount: number
  paidAt: string | null
  createdAt: string
}

const ALL = "__all__"
const GRID = "grid-cols-[minmax(0,1fr)_7rem_8.5rem]"

/** One line of engagement per invoice, as the design shows under the status. */
function engagement(invoice: Invoice): { label: string; warn: boolean } {
  if (invoice.status === "paid") {
    return { label: `Paid ${longDate(invoice.paidAt)}`, warn: false }
  }
  if (invoice.status === "payment_pending") {
    return { label: `Opened ${invoice.openCount}× · at gateway`, warn: false }
  }
  if (invoice.status === "lapsed") {
    return { label: "Lapsed unpaid", warn: true }
  }
  if (invoice.status === "draft") {
    return { label: "Not yet issued", warn: true }
  }
  if (invoice.openCount === 0) {
    const days = daysUntil(invoice.issueDate)
    const age = days === null ? "" : ` · ${Math.abs(days)} days`
    return { label: `Never opened${age}`, warn: true }
  }
  return { label: `Opened ${invoice.openCount}×`, warn: false }
}

export function InvoiceListView() {
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  // `?status=paid` from the overview tiles pre-filters the list.
  const [status, setStatus] = React.useState<string>(() => {
    if (typeof window === "undefined") return ALL
    const wanted = new URLSearchParams(window.location.search).get("status")
    return wanted && wanted in INVOICE_STATUS_LABEL ? wanted : ALL
  })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = status === ALL ? "" : `?status=${encodeURIComponent(status)}`
      const response = await fetch(`/api/renewals/invoices${query}`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load invoices.")
      }
      const payload = (await response.json()) as { invoices: Invoice[] }
      setInvoices(payload.invoices ?? [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load invoices.")
    } finally {
      setLoading(false)
    }
  }, [status])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Proformas and tax invoices. One proforma per franchise-and-expiry-date group per cycle; the T-5 and T-1 runs reuse it."
      >
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-muted-foreground py-6 text-sm">Loading…</p>
          ) : error ? (
            <div className="py-6">
              <p className="text-destructive text-sm">{error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex items-center gap-3 py-8">
              <Receipt className="text-muted-foreground size-5" />
              <div>
                <p className="text-sm font-medium">No invoices yet.</p>
                <p className="text-muted-foreground text-sm">
                  The nightly run raises one for each subscription reaching a reminder point.
                </p>
              </div>
            </div>
          ) : (
            <>
              <ColumnHeadings
                grid={GRID}
                columns={[{ label: "Document" }, { label: "Total", align: "right" }, { label: "Status" }]}
              />
              {invoices.map((invoice) => {
                const line = engagement(invoice)
                return (
                  <Link
                    key={invoice.id}
                    href={`/renewal-retention/invoices/${invoice.id}`}
                    className={cn(
                      "hover:bg-accent/40 grid w-full items-center gap-3 border-b px-2 py-3 text-left text-sm transition-colors",
                      GRID
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-[0.8125rem] whitespace-nowrap">{invoice.invoiceNumber}</span>
                      <span className="text-sm">{invoice.companyName ?? `Franchise ${invoice.franchiseId}`}</span>
                      <span className="text-muted-foreground text-xs">
                        {invoice.isGrouped ? `Grouped · ${plural(invoice.itemCount, "outlet")}` : plural(invoice.itemCount, "outlet")} · FID{" "}
                        {invoice.franchiseId}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        Issued {longDate(invoice.issueDate)} ·{" "}
                        {invoice.billingPlanSelected ? `${TERM_LABEL[invoice.billingPlanSelected]} term` : "term not set"}
                      </span>
                    </span>
                    <span className="text-right font-medium whitespace-nowrap tabular-nums">
                      {money(invoice.totalMinor, invoice.currencyCode)}
                    </span>
                    <span className="flex flex-col items-start gap-1">
                      <Pill tone={INVOICE_STATUS_TONE[invoice.status] ?? "gray"}>
                        {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                      </Pill>
                      <span className={cn("text-xs", line.warn ? TONE_TEXT.amber : "text-muted-foreground")}>
                        {line.label}
                      </span>
                    </span>
                  </Link>
                )
              })}
              <div className="text-muted-foreground flex items-center justify-between pt-3.5 text-xs">
                <span>{plural(invoices.length, "document")}</span>
                <span>Voided invoices stay listed; their public links return 404.</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
