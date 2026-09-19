"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { capitalise, longDate, money, plural, TERM_LABELS } from "./format"
import { InvalidLink, LoadingCard, PublicShell } from "./public-shell"
import { fetchPublicInvoice } from "./types"
import type { BillingTerm, PublicInvoice } from "./types"

/**
 * The merchant's proforma page.
 *
 * Three cards: what is being renewed and for how much; which term; where to
 * send the receipt and the Pay button. The page never marks anything paid.
 * Pay opens a CommercePay session and sends the merchant there; the signed
 * callback and the receipt page do the rest.
 */
export default function RenewalProformaPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""
  const router = useRouter()

  const [view, setView] = React.useState<PublicInvoice | null>(null)
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "invalid" | "error">(
    "loading"
  )
  const [email, setEmail] = React.useState("")
  const [switching, setSwitching] = React.useState<BillingTerm | null>(null)
  const [paying, setPaying] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!token) {
      setLoadState("invalid")
      return
    }
    const result = await fetchPublicInvoice(token)
    if (!result.ok) {
      setLoadState(result.status === 404 ? "invalid" : "error")
      return
    }
    setView(result.view)
    setEmail((current) => current || result.view.paymentEmail || "")
    setLoadState("ready")
  }, [token])

  React.useEffect(() => {
    void load()
  }, [load])

  async function switchTerm(term: BillingTerm) {
    if (!view || view.termLocked || term === view.term) {
      return
    }
    setSwitching(term)
    setNotice(null)
    try {
      const response = await fetch(`/api/public/renewal/${encodeURIComponent(token)}/term`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term }),
      })
      const payload = (await response.json().catch(() => null)) as
        | (PublicInvoice & { error?: string })
        | null
      if (!response.ok) {
        setNotice(payload?.error ?? "The term could not be changed. Please try again.")
        return
      }
      if (payload) {
        setView(payload)
      }
    } catch {
      setNotice("We could not reach the server. Please try again.")
    } finally {
      setSwitching(null)
    }
  }

  async function pay() {
    if (!view) {
      return
    }
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setNotice("Enter the email address the receipt should go to.")
      return
    }
    setPaying(true)
    setNotice(null)
    try {
      const response = await fetch(`/api/public/renewal/${encodeURIComponent(token)}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { redirectUrl?: string; error?: string }
        | null
      if (!response.ok || !payload?.redirectUrl) {
        setNotice(payload?.error ?? "The payment page could not be opened. Please try again shortly.")
        setPaying(false)
        return
      }
      window.location.assign(payload.redirectUrl)
    } catch {
      setNotice("We could not reach the server. Please try again.")
      setPaying(false)
    }
  }

  if (loadState === "loading") {
    return (
      <PublicShell>
        <LoadingCard label="Loading your renewal…" />
      </PublicShell>
    )
  }

  if (loadState === "invalid" || !view) {
    return (
      <PublicShell>
        <InvalidLink
          title="This renewal link is not valid."
          body="The link may have been mistyped or replaced by a newer one. Please use the most recent message from Slurp, or contact us and we will send a fresh link."
        />
      </PublicShell>
    )
  }

  if (loadState === "error") {
    return (
      <PublicShell>
        <InvalidLink
          title="We could not load your renewal."
          body="Something went wrong on our side. Please try again in a moment."
        />
      </PublicShell>
    )
  }

  const pdfHref = `/api/public/renewal/${encodeURIComponent(token)}/pdf`
  const paymentPending = view.payment.state === "pending"
  const currentQuote = view.termQuotes.find((quote) => quote.term === view.term)
  const canPay = view.payability === "payable"

  return (
    <PublicShell>
      {view.payability === "paid" ? (
        <StatusBanner
          tone="good"
          title="This renewal has been paid."
          body="Thank you. Your receipt and the new expiry dates are on the receipt page."
          action={
            <Button size="sm" onClick={() => router.push(`/renew/${token}/receipt`)}>
              View receipt
            </Button>
          }
        />
      ) : null}
      {view.payability === "lapsed" ? (
        <StatusBanner
          tone="warn"
          title="This renewal can no longer be paid online."
          body={`The payment window closed on ${longDate(view.graceEndsOn)}. Please contact Slurp and we will help you renew.`}
        />
      ) : null}
      {view.payability === "closed" ? (
        <StatusBanner
          tone="muted"
          title="This invoice has been replaced."
          body="A newer document covers this renewal. Please use the most recent link from Slurp."
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">
                {view.companyName ?? `Franchise ${view.franchiseId}`}
              </CardTitle>
              <CardDescription>
                {plural(view.outletCount, "outlet")} · FID {view.franchiseId} · licence expires{" "}
                {longDate(view.periodStart)}
              </CardDescription>
            </div>
            <div className="text-muted-foreground text-right text-[0.8125rem]">
              <div className="text-foreground font-mono">{view.invoiceNumber}</div>
              <div className="mt-1">Issued {longDate(view.issueDate)}</div>
              <div>Payment due {longDate(view.dueDate)}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-3 border-b pb-2.5 text-[11px] tracking-[0.05em] uppercase">
            <span>Outlet</span>
            <span className="text-right">New expiry</span>
            <span className="text-right">Amount</span>
          </div>
          {view.lines.map((line) => (
            <div
              key={line.outletId}
              className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-center gap-3 border-b py-2.5"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm">{line.outletName ?? `Outlet ${line.outletId}`}</span>
                <span className="text-muted-foreground text-xs">
                  {line.licensePlan ? `${capitalise(line.licensePlan)} plan · ` : ""}OID {line.outletId}
                </span>
              </span>
              <span className="text-muted-foreground text-right text-[0.8125rem] whitespace-nowrap">
                {longDate(line.newValidUntil)}
              </span>
              <span className="text-right text-sm whitespace-nowrap tabular-nums">
                {money(line.amountMinor, view.currencyCode)}
              </span>
            </div>
          ))}
          <div className="flex flex-col gap-2 pt-3.5 text-sm">
            <div className="text-muted-foreground flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(view.totals.subtotalMinor, view.currencyCode)}</span>
            </div>
            {view.taxRatePercent > 0 ? (
              <div className="text-muted-foreground flex justify-between">
                <span>SST {view.taxRatePercent}% (exclusive)</span>
                <span className="tabular-nums">{money(view.totals.taxMinor, view.currencyCode)}</span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between border-t pt-2.5">
              <span className="font-medium">Total due</span>
              <span className="text-2xl font-semibold tracking-[-0.01em] tabular-nums">
                {money(view.totals.totalMinor, view.currencyCode)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {view.termQuotes.length > 1 || view.termLocked ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose your renewal term</CardTitle>
            <CardDescription>
              The term applies to {view.outletCount === 1 ? "this outlet" : `all ${plural(view.outletCount, "outlet")}`}.
              Your new expiry is calculated from the current one, so nothing is lost by renewing early.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))]">
              {view.termQuotes.map((quote) => {
                const selected = quote.term === view.term
                const disabled = view.termLocked || switching !== null
                return (
                  <button
                    key={quote.term}
                    type="button"
                    disabled={disabled && !selected}
                    aria-pressed={selected}
                    onClick={() => void switchTerm(quote.term)}
                    className={cn(
                      "flex flex-col gap-1 rounded-[var(--radius)] border px-4 py-3.5 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-accent/40",
                      disabled && !selected && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{TERM_LABELS[quote.term]}</span>
                      <span
                        className={cn(
                          "size-4 rounded-full border-[1.5px]",
                          selected ? "border-primary bg-primary" : "border-border bg-transparent"
                        )}
                      />
                    </span>
                    <span className="text-xl font-semibold tabular-nums">
                      {switching === quote.term ? "…" : money(quote.totalMinor, view.currencyCode)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      Valid until {longDate(quote.periodEnd)}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="bg-muted/50 mt-3.5 rounded-[calc(var(--radius)-2px)] px-3.5 py-3 text-[0.8125rem]">
              {view.termLocked && paymentPending
                ? "Your term is locked while a payment session is open. It unlocks again if you cancel or the session expires."
                : `Renewing for ${TERM_LABELS[view.term]} moves every outlet's expiry from ${longDate(view.periodStart)} to ${longDate(currentQuote?.periodEnd ?? view.periodEnd)}.`}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where should we send the receipt?</CardTitle>
          <CardDescription>
            The receipt and tax invoice are emailed here the moment payment clears, whoever settles
            the invoice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="finance@yourcompany.com"
            disabled={!canPay || paying}
            aria-label="Receipt email address"
          />
          {notice ? (
            <p role="alert" className="text-destructive mt-3 flex items-start gap-2 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button variant="outline" className="h-10" asChild>
              <a href={pdfHref} target="_blank" rel="noreferrer">
                <Printer className="size-4" />
                Print proforma
              </a>
            </Button>
            <Button className="h-10 flex-1" onClick={() => void pay()} disabled={!canPay || paying}>
              {paying
                ? "Opening secure payment…"
                : paymentPending
                  ? `Continue to payment · ${money(view.totals.totalMinor, view.currencyCode)}`
                  : `Renew now · ${money(view.totals.totalMinor, view.currencyCode)}`}
            </Button>
          </div>
          <p className="text-muted-foreground mt-3.5 text-xs text-pretty">
            Payment is handled by CommercePay. Your term is locked while the payment session is open,
            and unlocks again if you cancel or it expires.
          </p>
        </CardContent>
      </Card>
    </PublicShell>
  )
}

function StatusBanner({
  tone,
  title,
  body,
  action,
}: {
  tone: "good" | "warn" | "muted"
  title: string
  body: string
  action?: React.ReactNode
}) {
  const styles = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
    muted: "border-border bg-muted/50 text-foreground",
  }[tone]
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)+2px)] border px-4 py-3", styles)}>
      {tone === "good" ? <CheckCircle2 className="size-5 shrink-0" /> : <AlertCircle className="size-5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs opacity-90">{body}</div>
      </div>
      {action}
    </div>
  )
}
