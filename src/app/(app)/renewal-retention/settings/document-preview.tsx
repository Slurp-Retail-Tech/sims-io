"use client"

import * as React from "react"
import Image from "next/image"
import { ExternalLink, FileText } from "lucide-react"

import { RenewalDocumentCard } from "@/app/renew/[token]/document-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
 * A button that opens the company details on a sample proforma, tax invoice
 * and receipt in a dialog, drawn by the same card the merchant's renewal page
 * uses, with a toggle between the three.
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
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<DocumentKind>("proforma")
  const [today] = React.useState(() => todayInAppZone())

  const seller = previewSellerBlock(draft, fallback)
  const content = buildDocumentContent(buildSampleDocumentSource(kind, { taxRatePercent, today }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" type="button">
          <FileText className="size-3.5" />
          Preview documents
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="gap-3 border-b px-5 pt-5 pb-4 pr-12">
          <div className="flex flex-col gap-1">
            <DialogTitle>Document preview</DialogTitle>
            <DialogDescription className="text-pretty">
              A made-up merchant, with your company details and tax rate.
            </DialogDescription>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="bg-muted inline-flex rounded-full p-0.5" role="group" aria-label="Document">
              {SAMPLE_DOCUMENT_KINDS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={kind === option}
                  onClick={() => setKind(option)}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-medium transition-colors",
                    kind === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
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
          {unsaved ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-pretty">
              Showing unsaved changes. The PDF and every new document use the saved details until you save.
            </p>
          ) : null}
        </DialogHeader>

        <div className="bg-muted/40 min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            <span className="dark:bg-white inline-flex self-start rounded-[calc(var(--radius)-2px)] dark:px-2 dark:py-1.5">
              <Image src="/slurp-logo-basic-03.png" alt="Slurp!" width={3576} height={1024} className="h-6 w-auto" />
            </span>
            <RenewalDocumentCard seller={seller} {...content} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
