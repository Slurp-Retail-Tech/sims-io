"use client"

import * as React from "react"
import Image from "next/image"
import { ExternalLink } from "lucide-react"

import { RenewalDocumentCard } from "@/app/renew/[token]/document-card"
import { todayInAppZone } from "@/lib/renewal/app-date"
import { buildDocumentContent } from "@/lib/renewal/document-content"
import type { DocumentKind } from "@/lib/renewal/document-content"
import { buildSampleDocumentSource, SAMPLE_DOCUMENT_KINDS } from "@/lib/renewal/sample-document"
import { previewSellerBlock } from "@/lib/renewal/seller"
import type { SellerBlock, SellerSettings } from "@/lib/renewal/seller"
import { cn } from "@/lib/utils"

const KIND_LABELS: Record<DocumentKind, string> = {
  proforma: "Proforma",
  tax_invoice: "Tax invoice",
  receipt: "Receipt",
}

/**
 * The company details on a sample proforma, tax invoice and receipt, drawn
 * by the same card the merchant's renewal page uses.
 *
 * The on-screen preview follows the form as it is typed. The PDF link prints
 * what is saved, through the same renderer real documents use, so "what is
 * saved" and "what is typed" are never confused: the notice says when they
 * differ.
 */
export function DocumentPreview({
  draft,
  fallback,
  taxRatePercent,
  unsaved,
}: {
  draft: SellerSettings
  fallback: SellerBlock
  /** The rate to show, from the form when it parses, otherwise the saved one. */
  taxRatePercent: number
  /** True when the form differs from what is saved in a way the documents show. */
  unsaved: boolean
}) {
  const [kind, setKind] = React.useState<DocumentKind>("proforma")
  const [today] = React.useState(() => todayInAppZone())

  const seller = previewSellerBlock(draft, fallback)
  const content = buildDocumentContent(buildSampleDocumentSource(kind, { taxRatePercent, today }))

  return (
    <div className="mt-6 flex flex-col gap-3 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Preview</span>
          <span className="text-muted-foreground text-xs text-pretty">
            A made-up merchant, with your company details and tax rate.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Document">
            {SAMPLE_DOCUMENT_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium",
                  kind === option ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                {KIND_LABELS[option]}
              </button>
            ))}
          </div>
          <a
            href={`/api/renewals/settings/document-preview?kind=${kind}`}
            target="_blank"
            rel="noopener"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
          >
            Open PDF
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      {unsaved ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-pretty">
          Showing unsaved changes. The PDF and every new document use the saved details until you save.
        </p>
      ) : null}

      <div className="bg-muted/40 max-h-[44rem] overflow-y-auto rounded-lg border p-3 sm:p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <span className="dark:bg-white inline-flex self-start rounded-[calc(var(--radius)-2px)] dark:px-2 dark:py-1.5">
            <Image src="/slurp-logo-basic-03.png" alt="Slurp!" width={3576} height={1024} className="h-6 w-auto" />
          </span>
          <RenewalDocumentCard seller={seller} {...content} />
        </div>
      </div>
    </div>
  )
}
