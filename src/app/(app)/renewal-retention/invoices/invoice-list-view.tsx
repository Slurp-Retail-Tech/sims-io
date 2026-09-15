"use client"

import * as React from "react"
import Link from "next/link"
import { Receipt } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

import {
  formatDateOnly,
  formatMinor,
  STATUS_CLASSES,
  STATUS_LABELS,
  TERM_LABELS,
} from "./invoice-format"

type Invoice = {
  id: string
  invoiceNumber: string
  documentType: "proforma" | "tax_invoice"
  franchiseId: string
  companyName: string | null
  isGrouped: boolean
  billingPlanSelected: string | null
  periodStart: string | null
  periodEnd: string | null
  dueDate: string | null
  currencyCode: string
  totalMinor: number
  status: string
  firstOpenedAt: string | null
  openCount: number
  paidAt: string | null
}

const ALL = "__all__"

export function InvoiceListView() {
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [status, setStatus] = React.useState<string>(ALL)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = status === ALL ? "" : `?status=${encodeURIComponent(status)}`
      const response = await fetch(`/api/renewals/invoices${query}`, {
        cache: "no-store",
      })
      if (!response.ok) {
        throw new Error("Unable to load invoices.")
      }
      const payload = (await response.json()) as { invoices: Invoice[] }
      setInvoices(payload.invoices ?? [])
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load invoices."
      )
    } finally {
      setLoading(false)
    }
  }, [status])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Renewal Invoices
          </h1>
          <p className="text-muted-foreground text-sm">
            Proformas raised by the nightly run, and the tax invoices that settle
            them.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Invoices" : `${invoices.length} invoices`}
          </CardTitle>
          <CardDescription>
            Newest first. An invoice is raised once per franchise and expiry
            date, and reused at each later reminder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-6 text-sm">Loading…</p>
          ) : error ? (
            <div className="py-6">
              <p className="text-destructive text-sm">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void load()}
              >
                Try again
              </Button>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex items-center gap-3 py-8">
              <Receipt className="text-muted-foreground size-5" />
              <div>
                <p className="text-sm font-medium">No invoices yet.</p>
                <p className="text-muted-foreground text-sm">
                  The nightly run raises one for each subscription reaching a
                  reminder point.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="text-muted-foreground grid grid-cols-[1.3fr_1.6fr_0.9fr_0.8fr_0.9fr_0.9fr] gap-3 px-1 pb-2 text-xs font-medium">
                <span>Number</span>
                <span>Merchant</span>
                <span>Due</span>
                <span>Term</span>
                <span className="text-right">Total</span>
                <span className="text-right">Status</span>
              </div>
              <Separator />
              {invoices.map((invoice) => (
                <div key={invoice.id}>
                  <Link
                    href={`/renewal-retention/invoices/${invoice.id}`}
                    className="hover:bg-muted/50 grid grid-cols-[1.3fr_1.6fr_0.9fr_0.8fr_0.9fr_0.9fr] items-center gap-3 rounded-sm px-1 py-3 text-sm"
                  >
                    <span className="font-mono text-xs">
                      {invoice.invoiceNumber}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">
                        {invoice.companyName ?? `Franchise ${invoice.franchiseId}`}
                      </span>
                      {invoice.isGrouped ? (
                        <span className="text-muted-foreground text-xs">
                          Grouped invoice
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateOnly(invoice.dueDate)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {invoice.billingPlanSelected
                        ? TERM_LABELS[invoice.billingPlanSelected]
                        : "—"}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatMinor(invoice.totalMinor, invoice.currencyCode)}
                    </span>
                    <span className="text-right">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          STATUS_CLASSES[invoice.status] ??
                            "bg-muted text-muted-foreground"
                        )}
                      >
                        {STATUS_LABELS[invoice.status] ?? invoice.status}
                      </span>
                    </span>
                  </Link>
                  <Separator />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
