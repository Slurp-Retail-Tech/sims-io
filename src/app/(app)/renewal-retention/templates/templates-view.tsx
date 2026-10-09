"use client"

import * as React from "react"
import { FileText } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { PageHeader, PillTabs } from "../ui"

type Template = {
  key: string
  label: string
  whatsappTemplate: string | null
  whatsappBody: string | null
  whatsappButton: string | null
  whatsappNote: string
  emailSubject: string
  emailBody: string
  emailNote: string
  emailAttachments: boolean
}

/**
 * Message Templates, to the design: the copy each dispatch type sends, on
 * each channel, rendered with sample values exactly as a merchant would read
 * it. Read-only. The copy lives in code beside the dispatch job, so what is
 * previewed here is what is sent.
 */
export function TemplatesView({
  templates,
  whatsappChannelId,
  senderEmail,
}: {
  templates: Template[]
  whatsappChannelId: string | null
  senderEmail: string
}) {
  const [active, setActive] = React.useState(templates[0]?.key ?? "")
  const template = templates.find((entry) => entry.key === active) ?? templates[0]

  if (!template) {
    return null
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Message Templates"
        description="Both channels dispatch through Respond.io. WhatsApp templates need Meta approval before release; the URL button takes a fixed base plus the renewal token as its suffix."
      />

      <PillTabs
        value={active}
        onChange={setActive}
        tabs={templates.map((entry) => ({ key: entry.key, label: entry.label }))}
      />

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              WhatsApp · {template.whatsappTemplate ?? "not applicable"}
            </CardTitle>
            <CardDescription>{template.whatsappNote}</CardDescription>
          </CardHeader>
          <CardContent>
            {template.whatsappBody ? (
              <>
                <div className="rounded-[calc(var(--radius)+2px)] bg-[#e7ded4] p-4">
                  <div className="max-w-[20rem] rounded-[12px_12px_12px_4px] bg-white px-3.5 py-3 text-[0.8125rem] leading-[1.55] text-[#111b21] shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                    <div className="whitespace-pre-line">{template.whatsappBody}</div>
                    <div className="mt-2.5 border-t border-[#e9edef] pt-2 text-center text-[0.8125rem] font-medium text-[#027eb5]">
                      {template.whatsappButton}
                    </div>
                    <div className="mt-1 text-right text-[0.6875rem] text-[#667781]">09:04</div>
                  </div>
                </div>
                <p className="text-muted-foreground mt-3 text-xs">
                  Sent with message.type whatsapp_template against phone:{"{e164}"}, on channel{" "}
                  {whatsappChannelId ?? "(not configured)"}.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-pretty">
                This dispatch type has no WhatsApp template. It is sent to the address captured on the
                proforma page, which may not be a WhatsApp contact at all.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email</CardTitle>
            <CardDescription>{template.emailNote}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-[calc(var(--radius)+2px)] border">
              <div className="bg-muted/40 flex flex-col gap-1 border-b px-4 py-3">
                <span className="text-[0.8125rem] font-semibold">{template.emailSubject}</span>
                <span className="text-muted-foreground text-xs">
                  Slurp Renewals &lt;{senderEmail}&gt; → {template.key === "payer_documents" ? "the payer's email" : "the renewal PIC"}
                </span>
              </div>
              <div className="px-4 py-4 text-[0.8125rem] leading-[1.6] whitespace-pre-line">{template.emailBody}</div>
              {template.emailAttachments ? (
                <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                  {["receipt-INV-2026-09-014.pdf", "tax-invoice-INV-2026-09-014.pdf"].map((name) => (
                    <span key={name} className="inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] border px-2.5 py-1.5 text-xs">
                      <FileText className="size-3.5" />
                      {name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Preview uses sample values. Every {"{placeholder}"} is filled from the invoice at send time.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
