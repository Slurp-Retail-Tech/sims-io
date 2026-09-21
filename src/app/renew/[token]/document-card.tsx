"use client"

import * as React from "react"

import {
  Card,
  CardContent,
} from "@/components/ui/card"

/**
 * The renewal document itself: letterhead, a doc-meta table, Bill To / Ship
 * To, the line-item table and totals, then terms & conditions.
 *
 * Shared by the proforma and the receipt so a merchant recognises the second
 * document from the first, and rendered from the same fields the PDF and the
 * staff invoice page read — nothing here is computed a second time.
 */

export type DocMetaRow = { label: string; value: string; mono?: boolean }

export type DocumentLineRow = {
  key: string
  no: string
  description: string
  outlet: string
  duration: string
  adjustmentNote: string | null
  qty: string
  unitPrice: string
  amount: string
}

export function RenewalDocumentCard({
  seller,
  docTypeTitle,
  docMeta,
  billTo,
  shipTo,
  docTitle,
  lines,
  subtotal,
  taxVisible,
  taxLabel,
  tax,
  totalLabel,
  total,
  termsLines,
  footer,
}: {
  seller: { name: string; lines: readonly string[] }
  docTypeTitle: string
  docMeta: DocMetaRow[]
  billTo: { name: string; lines: readonly string[] }
  shipTo: { name: string; lines: readonly string[] }
  docTitle: string
  lines: DocumentLineRow[]
  subtotal: string
  taxVisible: boolean
  taxLabel: string
  tax: string
  totalLabel: string
  total: string
  termsLines: readonly string[]
  /** Buttons, notices or anything else appended after the terms block. */
  footer?: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="grid gap-5 border-b pb-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
          <div>
            <div className="text-[0.9375rem] font-semibold">{seller.name}</div>
            {seller.lines.map((line, index) => (
              <div key={index} className="text-muted-foreground text-xs leading-relaxed">
                {line}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[0.9375rem] font-semibold tracking-[0.04em]">{docTypeTitle}</div>
            {docMeta.map((row) => (
              <div key={row.label} className="flex justify-between gap-4 text-[0.8125rem]">
                <span className="text-muted-foreground">{row.label}</span>
                <span className={row.mono ? "font-mono" : undefined}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-5 border-b py-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr))]">
          <div>
            <div className="text-muted-foreground text-[11px] tracking-[0.05em] uppercase">Bill To</div>
            <div className="mt-1.5 text-sm font-medium">{billTo.name}</div>
            {billTo.lines.map((line, index) => (
              <div key={index} className="text-muted-foreground text-[0.8125rem] leading-relaxed">
                {line}
              </div>
            ))}
          </div>
          <div>
            <div className="text-muted-foreground text-[11px] tracking-[0.05em] uppercase">Ship To</div>
            <div className="mt-1.5 text-sm font-medium">{shipTo.name}</div>
            {shipTo.lines.map((line, index) => (
              <div key={index} className="text-muted-foreground text-[0.8125rem] leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="pt-5 pb-3 text-[0.8125rem] font-semibold tracking-[0.02em] text-pretty">{docTitle}</div>

        <div className="text-muted-foreground hidden border-b pb-2 text-[11px] tracking-[0.05em] uppercase sm:grid sm:grid-cols-[1.75rem_minmax(0,1fr)_2rem_5rem_5rem] sm:gap-2.5">
          <span>No.</span>
          <span>Description</span>
          <span className="text-right">Qty</span>
          <span className="text-right">U/Price</span>
          <span className="text-right">Amt</span>
        </div>
        {lines.map((line) => (
          <div key={line.key} className="border-b py-3 text-[0.8125rem]">
            {/* Below sm: everything stacks in one block, with qty/unit price
                folded into a summary line rather than fighting for columns
                a 320px screen does not have. */}
            <div className="flex flex-col gap-0.5 sm:hidden">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-pretty">{line.description}</span>
                <span className="shrink-0 tabular-nums">{line.amount}</span>
              </span>
              <span className="text-muted-foreground text-xs">{line.outlet}</span>
              <span className="text-muted-foreground text-xs">{line.duration}</span>
              {line.adjustmentNote ? (
                <span className="text-muted-foreground text-xs">{line.adjustmentNote}</span>
              ) : null}
              <span className="text-muted-foreground text-xs">
                Qty {line.qty} · U/Price {line.unitPrice}
              </span>
            </div>
            <div className="hidden sm:grid sm:grid-cols-[1.75rem_minmax(0,1fr)_2rem_5rem_5rem] sm:gap-2.5">
              <span className="text-muted-foreground tabular-nums">{line.no}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-pretty">{line.description}</span>
                <span className="text-muted-foreground text-xs">{line.outlet}</span>
                <span className="text-muted-foreground text-xs">{line.duration}</span>
                {line.adjustmentNote ? (
                  <span className="text-muted-foreground text-xs">{line.adjustmentNote}</span>
                ) : null}
              </span>
              <span className="text-right tabular-nums">{line.qty}</span>
              <span className="text-right tabular-nums whitespace-nowrap">{line.unitPrice}</span>
              <span className="text-right tabular-nums whitespace-nowrap">{line.amount}</span>
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-2 pt-3.5 text-sm">
          <div className="text-muted-foreground flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{subtotal}</span>
          </div>
          {taxVisible ? (
            <div className="text-muted-foreground flex justify-between">
              <span>{taxLabel}</span>
              <span className="tabular-nums">{tax}</span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between border-t pt-2.5">
            <span className="font-medium">{totalLabel}</span>
            <span className="text-2xl font-semibold tracking-[-0.01em] tabular-nums">{total}</span>
          </div>
        </div>

        <div className="mt-5 border-t pt-5">
          <div className="text-muted-foreground text-[11px] tracking-[0.05em] uppercase">Terms &amp; conditions</div>
          {termsLines.map((line, index) => (
            <p key={index} className="text-muted-foreground mt-1 text-xs text-pretty">
              {line}
            </p>
          ))}
        </div>

        {footer}
      </CardContent>
    </Card>
  )
}

/** The three legal lines every renewal document carries. */
export const RENEWAL_TERMS_LINES: readonly string[] = [
  "Slurp! POS System is a cloud-based system with bi-annual/yearly subscription basis. Renewal is required to ensure the system is active and functional.",
  "Once renewed, payments are non-refundable.",
  "Accounts that are not renewed for more than 6 months will be permanently removed from our database and can not be recovered.",
]
