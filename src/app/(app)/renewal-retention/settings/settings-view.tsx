"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/toast-provider"
import { cn } from "@/lib/utils"

import { PageHeader } from "../ui"

type Settings = {
  reminderOffsets: number[]
  readinessWindowDays: number
  defaultBillingPlan: "annually" | "bi_annually"
  taxRatePercent: number
  overrideVarianceThresholdPct: number
  graceWindowDays: number
  dispatchEnabled: boolean
  sendWindowStart: string
  sendWindowEnd: string
  sessionExpiryMinutes: number
  maxSessionRetries: number
  receiptPollCeilingSeconds: number
  respondioWhatsappChannelId: string | null
  bukkuDescriptionFormat: string | null
  sellerName: string | null
  sellerRegistrationNo: string | null
  sellerAddress: string | null
  sellerContact: string | null
  updatedAt: string | null
}

type Draft = {
  readinessWindowDays: string
  taxRatePercent: string
  overrideVarianceThresholdPct: string
  graceWindowDays: string
  defaultBillingPlan: "annually" | "bi_annually"
  sendWindowStart: string
  sendWindowEnd: string
  sessionExpiryMinutes: string
  maxSessionRetries: string
  respondioWhatsappChannelId: string
  bukkuDescriptionFormat: string
  sellerName: string
  sellerRegistrationNo: string
  sellerAddress: string
  sellerContact: string
}

function toDraft(settings: Settings): Draft {
  return {
    readinessWindowDays: String(settings.readinessWindowDays),
    taxRatePercent: String(settings.taxRatePercent),
    overrideVarianceThresholdPct: String(settings.overrideVarianceThresholdPct),
    graceWindowDays: String(settings.graceWindowDays),
    defaultBillingPlan: settings.defaultBillingPlan,
    sendWindowStart: settings.sendWindowStart.slice(0, 5),
    sendWindowEnd: settings.sendWindowEnd.slice(0, 5),
    sessionExpiryMinutes: String(settings.sessionExpiryMinutes),
    maxSessionRetries: String(settings.maxSessionRetries),
    respondioWhatsappChannelId: settings.respondioWhatsappChannelId ?? "",
    bukkuDescriptionFormat: settings.bukkuDescriptionFormat ?? "",
    sellerName: settings.sellerName ?? "",
    sellerRegistrationNo: settings.sellerRegistrationNo ?? "",
    sellerAddress: settings.sellerAddress ?? "",
    sellerContact: settings.sellerContact ?? "",
  }
}

/**
 * Renewal Settings, to the design: the kill switch first, then cadence and
 * dispatch, then pricing, tax and grace.
 *
 * The kill switch saves on its own click. Everything else is a form with one
 * Save, so a half-edited page never reaches the database.
 */
export function SettingsView({ canManage }: { canManage: boolean }) {
  const { showToast } = useToast()
  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [offsets, setOffsets] = React.useState<number[]>([])
  const [newOffset, setNewOffset] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [toggling, setToggling] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/renewals/settings", { cache: "no-store" })
      if (!response.ok) {
        throw new Error("Unable to load the settings.")
      }
      const payload = (await response.json()) as { settings: Settings }
      setSettings(payload.settings)
      setDraft(toDraft(payload.settings))
      setOffsets(payload.settings.reminderOffsets)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load the settings.")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const response = await fetch("/api/renewals/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => ({}))) as {
      settings?: Settings
      error?: string
      errors?: Array<{ field: string; message: string }>
    }
    if (!response.ok) {
      const map: Record<string, string> = {}
      for (const entry of payload.errors ?? []) {
        map[entry.field] = entry.message
      }
      setFieldErrors(map)
      showToast(payload.error ?? "Unable to save the settings.", "error")
      return false
    }
    if (payload.settings) {
      setSettings(payload.settings)
      setDraft(toDraft(payload.settings))
      setOffsets(payload.settings.reminderOffsets)
    }
    setFieldErrors({})
    return true
  }

  async function toggleDispatch() {
    if (!settings) return
    setToggling(true)
    try {
      const ok = await patch({ dispatchEnabled: !settings.dispatchEnabled })
      if (ok) {
        showToast(settings.dispatchEnabled ? "Outbound dispatch paused." : "Outbound dispatch resumed.", "success")
      }
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setToggling(false)
    }
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const ok = await patch({
        reminderOffsets: offsets,
        readinessWindowDays: draft.readinessWindowDays,
        taxRatePercent: draft.taxRatePercent,
        overrideVarianceThresholdPct: draft.overrideVarianceThresholdPct,
        graceWindowDays: draft.graceWindowDays,
        defaultBillingPlan: draft.defaultBillingPlan,
        sendWindowStart: draft.sendWindowStart,
        sendWindowEnd: draft.sendWindowEnd,
        sessionExpiryMinutes: draft.sessionExpiryMinutes,
        maxSessionRetries: draft.maxSessionRetries,
        respondioWhatsappChannelId: draft.respondioWhatsappChannelId,
        bukkuDescriptionFormat: draft.bukkuDescriptionFormat,
        sellerName: draft.sellerName,
        sellerRegistrationNo: draft.sellerRegistrationNo,
        sellerAddress: draft.sellerAddress,
        sellerContact: draft.sellerContact,
      })
      if (ok) {
        showToast("Settings saved.", "success")
      }
    } catch {
      showToast("Unable to reach the server. Try again.", "error")
    } finally {
      setSaving(false)
    }
  }

  function addOffset() {
    const value = Number(newOffset.trim())
    if (!Number.isInteger(value) || value < 0 || value > 365) {
      setFieldErrors((current) => ({ ...current, reminderOffsets: "Offsets are whole days, 0 to 365." }))
      return
    }
    setOffsets((current) => [...new Set([...current, value])].sort((a, b) => b - a))
    setNewOffset("")
    setFieldErrors((current) => ({ ...current, reminderOffsets: "" }))
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading settings…</p>
  }
  if (error || !settings || !draft) {
    return (
      <div>
        <p className="text-destructive text-sm">{error ?? "Unable to load the settings."}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    )
  }

  const field = (key: keyof Draft, label: string, hint: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="flex items-center justify-between gap-4 border-b pb-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-muted-foreground text-xs text-pretty">{hint}</span>
        {fieldErrors[key] ? <span className="text-destructive text-xs">{fieldErrors[key]}</span> : null}
      </span>
      <Input
        className="h-8 w-32 shrink-0 text-right tabular-nums"
        value={draft[key]}
        onChange={(event) => setDraft((current) => (current ? { ...current, [key]: event.target.value } : current))}
        disabled={!canManage}
        aria-invalid={Boolean(fieldErrors[key])}
        {...extra}
      />
    </div>
  )

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-5">
      <PageHeader
        title="Renewal Settings"
        description="Cadence, readiness window, dispatch window, tax, grace window and override threshold. Changes need the settings manage key."
      />

      <div
        className={cn(
          "flex items-start gap-4 rounded-[calc(var(--radius)+2px)] border px-5 py-4",
          settings.dispatchEnabled ? "bg-card" : "border-amber-500/40 bg-amber-500/10"
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("text-[0.9375rem] font-semibold", !settings.dispatchEnabled && "text-amber-800 dark:text-amber-200")}>
            {settings.dispatchEnabled ? "Outbound dispatch is on" : "Outbound dispatch is paused"}
          </span>
          <span className="text-muted-foreground text-[0.8125rem] text-pretty">
            Invoices, PDFs and renewal links are generated either way. The switch only suspends outbound WhatsApp
            and email dispatch.
          </span>
        </div>
        {canManage ? (
          <Button variant={settings.dispatchEnabled ? "outline" : "default"} size="sm" disabled={toggling} onClick={() => void toggleDispatch()}>
            {toggling ? "Saving…" : settings.dispatchEnabled ? "Pause dispatch" : "Resume dispatch"}
          </Button>
        ) : null}
      </div>

      <div className="grid items-start gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadence and dispatch</CardTitle>
            <CardDescription>The cadence ends at T-1. There is no post-expiry chase.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3.5">
              <div>
                <div className="text-muted-foreground mb-1.5 text-xs">Reminder offsets before expiry</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {offsets.map((offset) => (
                    <span key={offset} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8125rem]">
                      T-{offset}
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={`Remove T-${offset}`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setOffsets((current) => current.filter((entry) => entry !== offset))}
                        >
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {canManage ? (
                    <span className="inline-flex items-center gap-1">
                      <Input
                        className="h-7 w-16 text-xs"
                        inputMode="numeric"
                        placeholder="days"
                        value={newOffset}
                        onChange={(event) => setNewOffset(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault()
                            addOffset()
                          }
                        }}
                      />
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addOffset}>
                        Add offset
                      </Button>
                    </span>
                  ) : null}
                </div>
                {fieldErrors.reminderOffsets ? <p className="text-destructive mt-1 text-xs">{fieldErrors.reminderOffsets}</p> : null}
              </div>
              {field("readinessWindowDays", "Readiness window", "Days ahead the nightly run checks plan and PIC without invoicing", { inputMode: "numeric" })}
              <div className="flex items-center justify-between gap-4 border-b pb-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm">Send window</span>
                  <span className="text-muted-foreground text-xs">Dispatches outside the window defer to the next one, Kuala Lumpur time</span>
                  {fieldErrors.sendWindowStart || fieldErrors.sendWindowEnd ? (
                    <span className="text-destructive text-xs">{fieldErrors.sendWindowStart ?? fieldErrors.sendWindowEnd}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Input type="time" className="h-8 w-28" value={draft.sendWindowStart} disabled={!canManage} onChange={(event) => setDraft({ ...draft, sendWindowStart: event.target.value })} />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input type="time" className="h-8 w-28" value={draft.sendWindowEnd} disabled={!canManage} onChange={(event) => setDraft({ ...draft, sendWindowEnd: event.target.value })} />
                </span>
              </div>
              {field("respondioWhatsappChannelId", "WhatsApp channel id", "Respond.io channel used for every template send; blank falls back to the environment", { className: "h-8 w-40 shrink-0" })}
              {field("maxSessionRetries", "Max session retries", "Failed payment session attempts before the renewal PIC is notified", { inputMode: "numeric" })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing, tax and grace</CardTitle>
            <CardDescription>Tax is exclusive. At 0% the tax line is suppressed on every document.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3.5">
              {field("taxRatePercent", "Tax rate (%)", "Exclusive. Slurp is not SST-registered, so the line is suppressed at 0", { inputMode: "decimal" })}
              {field("overrideVarianceThresholdPct", "Override variance threshold (%)", "Applies to increases and reductions alike", { inputMode: "decimal" })}
              {field("graceWindowDays", "Grace window after expiry (days)", "The link stays payable; a payment inside it still renews from the original expiry", { inputMode: "numeric" })}
              <div className="flex items-center justify-between gap-4 border-b pb-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm">Default billing term</span>
                  <span className="text-muted-foreground text-xs">The term the nightly job prices the proforma at</span>
                </span>
                <div className="flex shrink-0 gap-1">
                  {(["annually", "bi_annually"] as const).map((term) => (
                    <button
                      key={term}
                      type="button"
                      disabled={!canManage}
                      aria-pressed={draft.defaultBillingPlan === term}
                      onClick={() => setDraft({ ...draft, defaultBillingPlan: term })}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium",
                        draft.defaultBillingPlan === term ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"
                      )}
                    >
                      {term === "annually" ? "1 year" : "6 months"}
                    </button>
                  ))}
                </div>
              </div>
              {field("sessionExpiryMinutes", "Payment session expiry (minutes)", "CommercePay expiredInMinutes. 1440 is a day", { inputMode: "numeric" })}
              {field("bukkuDescriptionFormat", "Bukku line description", "Composed from {plan}, {outlet} and {period}", { className: "h-8 w-44 shrink-0" })}
              {canManage ? (
                <Button size="sm" className="self-start" disabled={saving} onClick={() => void save()}>
                  {saving ? "Saving…" : "Save settings"}
                </Button>
              ) : null}
              {settings.updatedAt ? (
                <p className="text-muted-foreground text-xs">Last saved {settings.updatedAt.slice(0, 16).replace("T", " ")} UTC</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company details on documents</CardTitle>
          <CardDescription className="text-pretty">
            Printed at the top of every proforma, tax invoice and receipt, and on the merchant&rsquo;s renewal page.
            Documents already issued keep the details they were printed with; an open proforma can be re-printed
            from its invoice page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))]">
            <div className="flex flex-col gap-3.5">
              <SellerField
                label="Company name"
                hint="The legal entity, as it should appear on a tax invoice"
                error={fieldErrors.sellerName}
              >
                <Input
                  value={draft.sellerName}
                  onChange={(event) => setDraft({ ...draft, sellerName: event.target.value })}
                  placeholder="Slurp Retail Tech Sdn Bhd"
                  disabled={!canManage}
                  maxLength={255}
                />
              </SellerField>
              <SellerField
                label="Registration number"
                hint="Printed as “Reg No:” beneath the name"
                error={fieldErrors.sellerRegistrationNo}
              >
                <Input
                  value={draft.sellerRegistrationNo}
                  onChange={(event) => setDraft({ ...draft, sellerRegistrationNo: event.target.value })}
                  placeholder="202101045205 / 1445505-V"
                  disabled={!canManage}
                  maxLength={120}
                />
              </SellerField>
            </div>
            <div className="flex flex-col gap-3.5">
              <SellerField
                label="Address"
                hint="One line per printed line, up to 6. Long lines wrap on the document."
                error={fieldErrors.sellerAddress}
              >
                <Textarea
                  rows={4}
                  value={draft.sellerAddress}
                  onChange={(event) => setDraft({ ...draft, sellerAddress: event.target.value })}
                  placeholder={"Unit 807A, Kompleks Diamond, Bangi Business Park\nJalan Medan Bangi, Off Persiaran Bandar\n43650 Bandar Baru Bangi, Selangor, Malaysia"}
                  disabled={!canManage}
                />
              </SellerField>
              <SellerField
                label="Contact"
                hint="Phone, email, website. One per line, up to 4."
                error={fieldErrors.sellerContact}
              >
                <Textarea
                  rows={3}
                  value={draft.sellerContact}
                  onChange={(event) => setDraft({ ...draft, sellerContact: event.target.value })}
                  placeholder={"60387442331\nhello@getslurp.com\ngetslurp.com"}
                  disabled={!canManage}
                />
              </SellerField>
            </div>
          </div>
          {canManage ? (
            <Button size="sm" className="mt-4" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function SellerField({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      {children}
      <span className="text-muted-foreground text-xs text-pretty">{hint}</span>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </label>
  )
}
