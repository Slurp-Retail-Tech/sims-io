"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import { Check, Clock, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { capitalise, longDate, longDateTime, money, plural, TERM_LABELS } from "../format"
import { InvalidLink, LoadingCard, PublicShell } from "../public-shell"
import { fetchPublicInvoice } from "../types"
import type { PublicInvoice } from "../types"

/** How often to ask again while the gateway's confirmation is in flight. */
const POLL_INTERVAL_MS = 4_000
/** Give up polling after this long and tell the merchant the documents will follow. */
const POLL_CEILING_MS = 90_000

/**
 * Where CommercePay sends the merchant back to.
 *
 * Three honest states. Paid: the callback landed and the licence moved.
 * Pending: the merchant is back but the confirmation is not, so the page
 * polls for a bounded time and then promises the documents by message.
 * Failed or expired: nothing was charged and the proforma is open again.
 * This page never marks anything paid; it only reads.
 */
export default function RenewalReceiptPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === "string" ? params.token : ""
  const router = useRouter()

  const [view, setView] = React.useState<PublicInvoice | null>(null)
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "invalid" | "error">(
    "loading"
  )
  const [waitedMs, setWaitedMs] = React.useState(0)

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
    setLoadState("ready")
  }, [token])

  React.useEffect(() => {
    void load()
  }, [load])

  const pending = view?.payment.state === "pending" && view.payability !== "paid"

  // Bounded polling while the confirmation is in flight.
  React.useEffect(() => {
    if (!pending || waitedMs >= POLL_CEILING_MS) {
      return
    }
    const handle = window.setTimeout(async () => {
      await load()
      setWaitedMs((current) => current + POLL_INTERVAL_MS)
    }, POLL_INTERVAL_MS)
    return () => window.clearTimeout(handle)
  }, [pending, waitedMs, load])

  if (loadState === "loading") {
    return (
      <PublicShell maxWidth="40rem">
        <LoadingCard label="Checking your payment…" />
      </PublicShell>
    )
  }

  if (loadState === "invalid" || !view) {
    return (
      <PublicShell maxWidth="40rem">
        <InvalidLink
          title="This renewal link is not valid."
          body="Please use the most recent message from Slurp, or contact us and we will send a fresh link."
        />
      </PublicShell>
    )
  }

  if (loadState === "error") {
    return (
      <PublicShell maxWidth="40rem">
        <InvalidLink
          title="We could not check your payment."
          body="Nothing is lost. Please reload in a moment, or wait for the receipt to arrive by email."
        />
      </PublicShell>
    )
  }

  const paid = view.payability === "paid"
  const timedOut = pending && waitedMs >= POLL_CEILING_MS
  const email = view.paymentEmail
  const pdfHref = `/api/public/renewal/${encodeURIComponent(token)}/pdf`

  return (
    <PublicShell maxWidth="40rem">
      {paid ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center border-b pb-5 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                <Check className="size-5" />
              </span>
              <div className="mt-3 text-xl font-semibold tracking-[-0.01em]">Payment received</div>
              <p className="text-muted-foreground mx-auto mt-1.5 max-w-[26rem] text-sm text-pretty">
                {view.outletCount === 1
                  ? `${view.companyName ?? "Your outlet"} is renewed for ${TERM_LABELS[view.term]}.`
                  : `All ${plural(view.outletCount, "outlet")} of ${view.companyName ?? `franchise ${view.franchiseId}`} are renewed for ${TERM_LABELS[view.term]}.`}
                {email ? ` Your receipt and tax invoice have been emailed to ${email}.` : ""}
              </p>
              <div className="mt-3.5 text-3xl font-semibold tracking-[-0.02em] tabular-nums">
                {money(view.totals.totalMinor, view.currencyCode)}
              </div>
            </div>

            <div className="grid gap-4 border-b py-4.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
              <Meta label="Paid on" value={longDateTime(view.payment.paidAt)} />
              <Meta label="Method" value="CommercePay" />
              <Meta label="Reference" value={view.invoiceNumber} mono />
              <Meta label="Term" value={TERM_LABELS[view.term]} />
            </div>

            <div className="pt-4.5">
              <div className="text-muted-foreground text-[11px] tracking-[0.05em] uppercase">
                Outlets renewed
              </div>
              {view.lines.map((line) => (
                <div
                  key={line.outletId}
                  className="flex items-center justify-between gap-3 border-b py-2.5"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm">{line.outletName ?? `Outlet ${line.outletId}`}</span>
                    <span className="text-muted-foreground text-xs">
                      {line.licensePlan ? `${capitalise(line.licensePlan)} plan · ` : ""}OID {line.outletId}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-right text-[0.8125rem] whitespace-nowrap">
                    Valid until {longDate(line.newValidUntil)}
                  </span>
                </div>
              ))}
              <div className="mt-4.5 flex flex-wrap gap-2.5">
                {view.documents.receipt ? (
                  <Button variant="outline" className="h-10 flex-1" asChild>
                    <a href={`${pdfHref}?document=receipt`} target="_blank" rel="noreferrer">
                      Print receipt
                    </a>
                  </Button>
                ) : null}
                {view.documents.taxInvoice ? (
                  <Button variant="outline" className="h-10 flex-1" asChild>
                    <a href={`${pdfHref}?document=tax_invoice`} target="_blank" rel="noreferrer">
                      Print tax invoice
                    </a>
                  </Button>
                ) : null}
                {!view.documents.receipt && !view.documents.taxInvoice ? (
                  <Button variant="outline" className="h-10 flex-1" asChild>
                    <a href={pdfHref} target="_blank" rel="noreferrer">
                      Print proforma
                    </a>
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-3.5 text-xs text-pretty">
                This link stays available as your permanent record. The renewal covers{" "}
                {longDate(view.periodStart)} to {longDate(view.periodEnd)}.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {pending ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center py-5 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
                <Clock className="size-5" />
              </span>
              <div className="mt-3 text-xl font-semibold tracking-[-0.01em]">
                {timedOut ? "Still confirming your payment" : "Confirming your payment"}
              </div>
              <p className="text-muted-foreground mx-auto mt-1.5 max-w-[28rem] text-sm text-pretty">
                {timedOut
                  ? "The confirmation is taking longer than usual. It will land on its own; you do not need to pay again."
                  : "Your bank has sent you back to us and we are waiting for the confirmation to land. This usually takes a few seconds. You do not need to do anything or reload the page."}
              </p>
              <div className="bg-muted/50 mx-auto mt-4.5 max-w-[26rem] rounded-[calc(var(--radius)-2px)] px-3.5 py-3 text-[0.8125rem] text-pretty">
                {email
                  ? `If it takes longer than expected we will email the receipt and tax invoice to ${email}. Nothing is lost if you close this page.`
                  : "If it takes longer than expected we will send the receipt and tax invoice to your renewal contact. Nothing is lost if you close this page."}
              </div>
              <p className="text-muted-foreground mt-3.5 text-xs">
                Reference {view.invoiceNumber} · {money(view.totals.totalMinor, view.currencyCode)} ·{" "}
                {TERM_LABELS[view.term]} term
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!paid && !pending ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center py-5 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-red-500/15 text-red-700">
                <X className="size-5" />
              </span>
              <div className="mt-3 text-xl font-semibold tracking-[-0.01em]">
                {view.payability === "payable"
                  ? "The payment did not complete"
                  : "This renewal is no longer payable online"}
              </div>
              <p className="text-muted-foreground mx-auto mt-1.5 max-w-[28rem] text-sm text-pretty">
                {view.payability === "payable"
                  ? "Nothing has been charged and your renewal is still open. You can go back to the proforma, change the term if you want to, and try again."
                  : "Nothing has been charged. Please contact Slurp and we will help you complete the renewal."}
              </p>
              {view.payability === "payable" ? (
                <div className="mt-4.5">
                  <Button className="h-10" onClick={() => router.push(`/renew/${token}`)}>
                    Back to the proforma
                  </Button>
                </div>
              ) : null}
              <p className="text-muted-foreground mt-3.5 text-xs">
                Reference {view.invoiceNumber}
                {view.payability === "payable" ? " · the term switcher is unlocked again." : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </PublicShell>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground text-[11px] tracking-[0.05em] uppercase">{label}</div>
      <div className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm"}>{value}</div>
    </div>
  )
}
