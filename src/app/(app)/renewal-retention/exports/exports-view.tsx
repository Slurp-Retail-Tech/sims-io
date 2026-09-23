"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/toast-provider"

import { longDate, money, PageHeader, Pill, plural, shortDateTime } from "../ui"

type Preview = {
  invoiceCount: number
  lineCount: number
  totalMinor: number
  alreadyExported: number
  totalPaidInPeriod: number
  awaitingTaxInvoice: number
}

type Batch = {
  id: string
  reference: string
  paidFrom: string
  paidTo: string
  invoiceCount: number
  lineCount: number
  totalMinor: number
  generatedByUserId: string | null
  createdAt: string
  voidedAfterExport: number
}

/**
 * Bukku Export, to the design: pick a paid-date period (defaulting to last
 * month), see what the file would hold, generate it, and download any batch
 * generated before. An invoice voided after export is flagged on its batch
 * because Bukku needs a manual credit note for it.
 */
export function ExportsView({ canManage }: { canManage: boolean }) {
  const { showToast } = useToast()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [includeExported, setIncludeExported] = React.useState(false)
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [batches, setBatches] = React.useState<Batch[]>([])
  const [loading, setLoading] = React.useState(true)
  const [generating, setGenerating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      params.set("includeExported", String(includeExported))
      const response = await fetch(`/api/renewals/exports?${params}`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the exports.")
      }
      const payload = (await response.json()) as {
        period: { from: string; to: string }
        preview: Preview
        batches: Batch[]
      }
      setFrom(payload.period.from)
      setTo(payload.period.to)
      setPreview(payload.preview)
      setBatches(payload.batches)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the exports.")
    } finally {
      setLoading(false)
    }
  }, [from, to, includeExported])

  React.useEffect(() => {
    void load()
    // Reload when the period or the toggle changes; `load` captures them.
  }, [load])

  async function generate() {
    setGenerating(true)
    try {
      const response = await fetch("/api/renewals/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, includeExported }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string; batch?: Batch }
      if (!response.ok) {
        showToast(payload.error ?? "Unable to generate the export.", "error")
        return
      }
      showToast(`${payload.batch?.reference ?? "Export"} generated.`, "success")
      void load()
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Bukku Export"
        description="One row per invoice line item, for manual upload into Bukku. Already-exported invoices are excluded unless you opt in."
      />

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New export</CardTitle>
            <CardDescription>Defaults to the previous calendar month, by the date the payment was confirmed.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground mb-1.5 text-xs">Paid from</div>
                  <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9" />
                </div>
                <div>
                  <div className="text-muted-foreground mb-1.5 text-xs">Paid to</div>
                  <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9" />
                </div>
              </div>
              <label className="flex items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3">
                <Checkbox
                  checked={!includeExported}
                  onCheckedChange={(checked) => setIncludeExported(checked !== true)}
                  className="mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm">Exclude invoices already exported</span>
                  <span className="text-muted-foreground text-xs">
                    {preview
                      ? `${preview.alreadyExported} of the ${plural(preview.totalPaidInPeriod, "paid invoice")} in this period already carry an export reference.`
                      : "Loading…"}
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap gap-6 border-t pt-3.5">
                <Stat label="Invoices in export" value={preview ? String(preview.invoiceCount) : "—"} />
                <Stat label="Line items" value={preview ? String(preview.lineCount) : "—"} />
                <Stat label="Total" value={preview ? money(preview.totalMinor) : "—"} />
              </div>
              {preview && preview.awaitingTaxInvoice > 0 ? (
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {plural(preview.awaitingTaxInvoice, "paid invoice")} in this period{" "}
                  {preview.awaitingTaxInvoice === 1 ? "is" : "are"} left out until the tax invoice is issued. Bukku
                  books the tax invoice number, so {preview.awaitingTaxInvoice === 1 ? "it joins" : "they join"} a later
                  export.
                </p>
              ) : null}
              {error ? <p className="text-destructive text-sm">{error}</p> : null}
              {canManage ? (
                <Button size="sm" className="self-start" disabled={generating || loading || !preview || preview.lineCount === 0} onClick={() => void generate()}>
                  {generating ? "Generating…" : "Generate export file"}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export batches</CardTitle>
            <CardDescription>An invoice voided after export is flagged for a manual correction in Bukku.</CardDescription>
          </CardHeader>
          <CardContent>
            {batches.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">No exports yet. The first batch appears here with its download.</p>
            ) : null}
            {batches.map((batch) => (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-[0.8125rem]">{batch.reference}</span>
                  <span className="text-muted-foreground text-xs">
                    {longDate(batch.paidFrom)} to {longDate(batch.paidTo)} · {plural(batch.invoiceCount, "invoice")} ·{" "}
                    {plural(batch.lineCount, "line item")} · generated {shortDateTime(batch.createdAt)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm tabular-nums">{money(batch.totalMinor)}</span>
                  {batch.voidedAfterExport > 0 ? (
                    <Pill tone="amber" className="font-medium">
                      {batch.voidedAfterExport} voided after export
                    </Pill>
                  ) : null}
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/renewals/exports/${batch.id}/download`}>Download</a>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
