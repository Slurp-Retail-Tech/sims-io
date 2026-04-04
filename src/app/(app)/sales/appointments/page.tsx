"use client"

import * as React from "react"
import {
  endOfMonth,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
} from "date-fns"
import { CalendarDays, CalendarIcon, Loader2, Search } from "lucide-react"

import Calendar04 from "@/components/calendar-04"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/toast-provider"
import { formatDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { cn } from "@/lib/utils"

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>

type Appointment = {
  id: string
  leadId: string | null
  customerName: string
  businessName: string
  businessType: string
  businessLocation: string
  meetingLocation: string | null
  appointmentType: "Online" | "Physical"
  scheduledAt: string
  status: "Pending" | "Completed" | "Canceled"
  createdByUserId: string
  createdByName: string | null
  completedByUserId: string | null
  completedByName: string | null
  completedAt: string | null
  completionNote: string | null
  canceledByUserId: string | null
  canceledByName: string | null
  canceledAt: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  canComplete: boolean
  canCancel: boolean
}

type LeadOption = {
  id: string
  name: string
  telephone: string
  email: string
  businessName: string
  businessType: string
  businessLocation: string
  archived: boolean
}

type FormState = {
  leadId: string | null
  customerName: string
  businessName: string
  businessType: string
  businessLocation: string
  meetingLocation: string
  appointmentType: "Online" | "Physical"
  scheduledDate: string
  scheduledTime: string
}

const appointmentTypeOptions = ["Online", "Physical"] as const

const timeOptions = Array.from({ length: 19 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  const date = new Date(2000, 0, 1, hours, minutes)
  return { id: value, value, label: format(date, "h:mm a") }
})

const statusBadgeStyles: Record<Appointment["status"], string> = {
  Pending: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20",
  Completed: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20",
  Canceled: "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20",
}

function getDefaultFormState(): FormState {
  return {
    leadId: null,
    customerName: "",
    businessName: "",
    businessType: "",
    businessLocation: "",
    meetingLocation: "",
    appointmentType: "Online",
    scheduledDate: format(new Date(), "yyyy-MM-dd"),
    scheduledTime: timeOptions[0].value,
  }
}

function buildIsoDateTime(dateValue: string, timeValue: string) {
  const date = new Date(`${dateValue}T${timeValue}`)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}

function getLocalDatePart(value: string) {
  const date = parseDate(value)
  return date ? format(date, "yyyy-MM-dd") : ""
}

function getLocalTimePart(value: string) {
  const date = parseDate(value)
  return date ? format(date, "HH:mm") : ""
}

function normalizeTimeOption(value: string) {
  return (
    timeOptions.find((option) => option.value === value)?.value ??
    timeOptions[0].value
  )
}

function replaceAppointment(current: Appointment[], nextAppointment: Appointment) {
  const next = current.filter((item) => item.id !== nextAppointment.id)
  next.push(nextAppointment)
  return next.sort((a, b) => {
    const left = parseDate(a.scheduledAt)?.valueOf() ?? 0
    const right = parseDate(b.scheduledAt)?.valueOf() ?? 0
    return left - right
  })
}

export default function SalesAppointmentsPage() {
  const { showToast } = useToast()
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null)
  const [ready, setReady] = React.useState(false)
  const [appointments, setAppointments] = React.useState<Appointment[]>([])
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = React.useState(() =>
    startOfDay(new Date())
  )
  const [loading, setLoading] = React.useState(false)

  const [formOpen, setFormOpen] = React.useState(false)
  const [formLoading, setFormLoading] = React.useState(false)
  const [editingAppointment, setEditingAppointment] =
    React.useState<Appointment | null>(null)
  const [formState, setFormState] = React.useState<FormState>(getDefaultFormState)

  const [leadQuery, setLeadQuery] = React.useState("")
  const deferredLeadQuery = React.useDeferredValue(leadQuery)
  const [leadLoading, setLeadLoading] = React.useState(false)
  const [leadResults, setLeadResults] = React.useState<LeadOption[]>([])
  const [selectedLeadLabel, setSelectedLeadLabel] = React.useState<string | null>(
    null
  )

  const [actionOpen, setActionOpen] = React.useState(false)
  const [actionTarget, setActionTarget] = React.useState<Appointment | null>(null)
  const [actionType, setActionType] = React.useState<"complete" | "cancel">(
    "complete"
  )
  const [actionReason, setActionReason] = React.useState("")
  const [actionLoading, setActionLoading] = React.useState(false)

  React.useEffect(() => {
    const user = getSessionUser()
    setSessionUser(user)
    setReady(true)
  }, [])


  const loadAppointments = React.useCallback(async () => {
    if (!sessionUser) {
      return
    }
    setLoading(true)
    try {
      const start = startOfMonth(month).toISOString()
      const end = endOfMonth(month).toISOString()
      const response = await fetch(
        `/api/sales-appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      )
      const payload = (await response.json()) as {
        appointments?: Appointment[]
        error?: string
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load appointments.")
      }
      setAppointments(payload.appointments ?? [])
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to load appointments.",
        "error"
      )
    } finally {
      setLoading(false)
    }
  }, [sessionUser, month, showToast])

  React.useEffect(() => {
    if (sessionUser) {
      void loadAppointments()
    }
  }, [sessionUser, loadAppointments])

  React.useEffect(() => {
    if (!formOpen || !sessionUser) {
      return
    }

    const query = deferredLeadQuery.trim()
    if (query.length < 2) {
      setLeadResults([])
      return
    }

    const controller = new AbortController()

    void (async () => {
      setLeadLoading(true)
      try {
        const params = new URLSearchParams({
          archived: "false",
          all: "true",
          q: query,
        })
        const response = await fetch(`/api/leads?${params.toString()}`, {
                    signal: controller.signal,
        })
        const payload = (await response.json()) as {
          leads?: LeadOption[]
          error?: string
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to search leads.")
        }
        setLeadResults(payload.leads ?? [])
      } catch (error) {
        if (!controller.signal.aborted) {
          showToast(
            error instanceof Error ? error.message : "Unable to search leads.",
            "error"
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLeadLoading(false)
        }
      }
    })()

    return () => controller.abort()
  }, [sessionUser, deferredLeadQuery, formOpen, showToast])

  const appointmentDays = React.useMemo(
    () =>
      appointments
        .map((appointment) => parseDate(appointment.scheduledAt))
        .filter((value): value is Date => Boolean(value)),
    [appointments]
  )

  const selectedDayAppointments = React.useMemo(
    () =>
      appointments.filter((appointment) => {
        const date = parseDate(appointment.scheduledAt)
        return date ? isSameDay(date, selectedDate) : false
      }),
    [appointments, selectedDate]
  )

  const counts = React.useMemo(
    () => ({
      Pending: appointments.filter((item) => item.status === "Pending").length,
      Completed: appointments.filter((item) => item.status === "Completed").length,
      Canceled: appointments.filter((item) => item.status === "Canceled").length,
    }),
    [appointments]
  )

  const resetFormState = React.useCallback(() => {
    setEditingAppointment(null)
    setFormState(getDefaultFormState())
    setLeadQuery("")
    setLeadResults([])
    setSelectedLeadLabel(null)
  }, [])

  const selectLead = React.useCallback((lead: LeadOption) => {
    setFormState((current) => ({
      ...current,
      leadId: lead.id,
      customerName: lead.name,
      businessName: lead.businessName,
      businessType: lead.businessType,
      businessLocation: lead.businessLocation,
      meetingLocation: "",
    }))
    setSelectedLeadLabel(`${lead.name} • ${lead.businessName}`)
  }, [])

  const openEditDialog = React.useCallback((appointment: Appointment) => {
    setEditingAppointment(appointment)
    setFormState({
      leadId: appointment.leadId,
      customerName: appointment.customerName,
      businessName: appointment.businessName,
      businessType: appointment.businessType,
      businessLocation: appointment.businessLocation,
      meetingLocation: appointment.meetingLocation ?? "",
      appointmentType: appointment.appointmentType,
      scheduledDate: getLocalDatePart(appointment.scheduledAt),
      scheduledTime: normalizeTimeOption(getLocalTimePart(appointment.scheduledAt)),
    })
    setLeadQuery("")
    setLeadResults([])
    setSelectedLeadLabel(null)
    setFormOpen(true)
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!sessionUser) {
      return
    }

    if (
      !formState.customerName.trim() ||
      !formState.businessName.trim() ||
      !formState.businessType.trim() ||
      !formState.businessLocation.trim() ||
      (formState.appointmentType === "Physical" &&
        !formState.meetingLocation.trim())
    ) {
      showToast("Please complete all required appointment fields.", "error")
      return
    }

    const scheduledAt = buildIsoDateTime(
      formState.scheduledDate,
      formState.scheduledTime
    )
    if (!scheduledAt) {
      showToast("Please select a valid date and time.", "error")
      return
    }

    setFormLoading(true)
    try {
      const response = await fetch(
        editingAppointment
          ? `/api/sales-appointments/${editingAppointment.id}`
          : "/api/sales-appointments",
        {
          method: editingAppointment ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: formState.leadId,
            customerName: formState.customerName.trim(),
            businessName: formState.businessName.trim(),
            businessType: formState.businessType.trim(),
            businessLocation: formState.businessLocation.trim(),
            meetingLocation:
              formState.appointmentType === "Physical"
                ? formState.meetingLocation.trim()
                : null,
            appointmentType: formState.appointmentType,
            scheduledAt,
          }),
        }
      )
      const payload = (await response.json()) as {
        appointment?: Appointment
        error?: string
      }
      if (!response.ok || !payload.appointment) {
        throw new Error(payload.error ?? "Unable to save appointment.")
      }
      const nextDate = parseDate(payload.appointment.scheduledAt) ?? new Date()
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setSelectedDate(startOfDay(nextDate))
      setMonth(startOfMonth(nextDate))
      setFormOpen(false)
      resetFormState()
      showToast(
        editingAppointment
          ? "Appointment updated successfully."
          : "Appointment created successfully."
      )
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to save appointment.",
        "error"
      )
    } finally {
      setFormLoading(false)
    }
  }, [sessionUser, editingAppointment, formState, resetFormState, showToast])

  const handleActionSubmit = React.useCallback(async () => {
    if (!sessionUser || !actionTarget) {
      return
    }

    if (!actionReason.trim()) {
      showToast(
        actionType === "complete"
          ? "Completion reason is required."
          : "Cancellation reason is required.",
        "error"
      )
      return
    }

    setActionLoading(true)
    try {
      const response = await fetch(
        `/api/sales-appointments/${actionTarget.id}/${actionType}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: actionReason.trim() }),
        }
      )
      const payload = (await response.json()) as {
        appointment?: Appointment
        error?: string
      }
      if (!response.ok || !payload.appointment) {
        throw new Error(payload.error ?? "Unable to update appointment status.")
      }
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setActionOpen(false)
      setActionTarget(null)
      setActionReason("")
      showToast(
        actionType === "complete"
          ? "Appointment completed."
          : "Appointment canceled."
      )
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to update appointment status.",
        "error"
      )
    } finally {
      setActionLoading(false)
    }
  }, [sessionUser, actionReason, actionTarget, actionType, showToast])

  if (!ready) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">
        Loading sales appointments...
      </div>
    )
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sales Appointment
          </h1>
          <p className="text-muted-foreground text-sm">
            Schedule sales visits, manage follow ups, and track completed or
            canceled appointments.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            resetFormState()
            setFormOpen(true)
          }}
        >
          New appointment
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" />
              Calendar
            </CardTitle>
            <CardDescription>
              Browse appointments by day and review the selected agenda.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="overflow-auto rounded-xl border">
                <Calendar04
                  mode="single"
                  month={month}
                  onMonthChange={setMonth}
                  selected={selectedDate}
                  onSelect={(date: Date | undefined) =>
                    date && setSelectedDate(startOfDay(date))
                  }
                  modifiers={{ hasAppointments: appointmentDays }}
                  modifiersClassNames={{
                    hasAppointments:
                      "bg-primary/8 text-foreground font-semibold ring-1 ring-primary/20",
                  }}
                  className="w-full border-0 shadow-none"
                />
              </div>
              <div className="grid gap-3">
                <Card className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm">This month</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 px-4 text-sm">
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span>Pending</span>
                      <span className="font-semibold">{counts.Pending}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span>Completed</span>
                      <span className="font-semibold">{counts.Completed}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span>Canceled</span>
                      <span className="font-semibold">{counts.Canceled}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="gap-3 py-4">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm">Selected day</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 text-sm">
                    <div className="font-medium">{format(selectedDate, "EEEE")}</div>
                    <div className="text-muted-foreground">
                      {format(selectedDate, "dd MMM yyyy")}
                    </div>
                    <div className="mt-3 text-2xl font-semibold">
                      {selectedDayAppointments.length}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      appointments on the selected day
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[420px]">
          <CardHeader className="border-b">
            <CardTitle className="text-base">
              {format(selectedDate, "dd MMM yyyy")} agenda
            </CardTitle>
            <CardDescription>
              Showing all appointments for the selected day.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-muted-foreground flex min-h-[240px] items-center justify-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading appointments...
              </div>
            ) : selectedDayAppointments.length === 0 ? (
              <div className="text-muted-foreground flex min-h-[240px] items-center justify-center text-sm">
                No appointments for this day.
              </div>
            ) : (
              selectedDayAppointments.map((appointment, index) => (
                <div key={appointment.id} className="space-y-4">
                  <div className="space-y-4 rounded-xl border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold">
                            {appointment.businessName}
                          </div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
                              statusBadgeStyles[appointment.status]
                            )}
                          >
                            {appointment.status}
                          </span>
                        </div>
                        <div className="text-muted-foreground text-sm">
                          {formatDateTime(appointment.scheduledAt)} •{" "}
                          {appointment.appointmentType}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {appointment.canEdit ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(appointment)}
                          >
                            Edit
                          </Button>
                        ) : null}
                        {appointment.canComplete ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setActionTarget(appointment)
                              setActionType("complete")
                              setActionReason("")
                              setActionOpen(true)
                            }}
                          >
                            Complete
                          </Button>
                        ) : null}
                        {appointment.canCancel ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setActionTarget(appointment)
                              setActionType("cancel")
                              setActionReason("")
                              setActionOpen(true)
                            }}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wide">
                          Customer
                        </div>
                        <div className="font-medium">{appointment.customerName}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wide">
                          Business type
                        </div>
                        <div className="font-medium">{appointment.businessType}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wide">
                          Business location
                        </div>
                        <div className="font-medium">
                          {appointment.businessLocation}
                        </div>
                      </div>
                      {appointment.appointmentType === "Physical" ? (
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Meeting location
                          </div>
                          <div className="font-medium">
                            {appointment.meetingLocation ?? "--"}
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <div className="text-muted-foreground text-xs uppercase tracking-wide">
                          Submitter
                        </div>
                        <div className="font-medium">
                          {appointment.createdByName ?? "--"}
                        </div>
                      </div>
                    </div>

                    {appointment.status === "Completed" ? (
                      <div className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm sm:grid-cols-2">
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Completed by
                          </div>
                          <div className="font-medium">
                            {appointment.completedByName ?? "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Completed at
                          </div>
                          <div className="font-medium">
                            {appointment.completedAt
                              ? formatDateTime(appointment.completedAt)
                              : "--"}
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Completion note
                          </div>
                          <div className="font-medium">
                            {appointment.completionNote ?? "--"}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {appointment.status === "Canceled" ? (
                      <div className="grid gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm sm:grid-cols-2">
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Canceled by
                          </div>
                          <div className="font-medium">
                            {appointment.canceledByName ?? "--"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Canceled at
                          </div>
                          <div className="font-medium">
                            {appointment.canceledAt
                              ? formatDateTime(appointment.canceledAt)
                              : "--"}
                          </div>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="text-muted-foreground text-xs uppercase tracking-wide">
                            Cancellation reason
                          </div>
                          <div className="font-medium">
                            {appointment.cancelReason ?? "--"}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {index < selectedDayAppointments.length - 1 ? <Separator /> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false)
            resetFormState()
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAppointment ? "Edit appointment" : "Create appointment"}
            </DialogTitle>
            <DialogDescription>
              Capture the customer and business details for a sales appointment.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6">
            <div className="grid gap-4 rounded-xl border p-4">
              <div className="space-y-2">
                <Label htmlFor="lead-search">Lead lookup</Label>
                <div className="relative">
                  <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                  <Input
                    id="lead-search"
                    value={leadQuery}
                    onChange={(event) => setLeadQuery(event.target.value)}
                    className="pl-9"
                    placeholder="Search customer, business, phone, or email"
                  />
                </div>
                <div className="text-muted-foreground text-xs">
                  Search non-archived leads to prefill customer and business details.
                </div>
              </div>

              {selectedLeadLabel ? (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="font-medium">{selectedLeadLabel}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFormState((current) => ({ ...current, leadId: null }))
                      setSelectedLeadLabel(null)
                    }}
                  >
                    Clear
                  </Button>
                </div>
              ) : null}

              {leadLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Searching leads...
                </div>
              ) : leadResults.length > 0 ? (
                <div className="grid gap-2">
                  {leadResults.map((lead) => (
                    <button
                      key={lead.id}
                      type="button"
                      className="rounded-lg border px-3 py-3 text-left text-sm transition hover:bg-muted/50"
                      onClick={() => selectLead(lead)}
                    >
                      <div className="font-medium">{lead.name}</div>
                      <div className="text-muted-foreground">
                        {lead.businessName} • {lead.businessType}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {lead.businessLocation}
                      </div>
                    </button>
                  ))}
                </div>
              ) : deferredLeadQuery.trim().length >= 2 ? (
                <div className="text-muted-foreground text-sm">
                  No lead matches found.
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customer-name">Customer name</Label>
                <Input
                  id="customer-name"
                  value={formState.customerName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      customerName: event.target.value,
                    }))
                  }
                  placeholder="Enter customer name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  value={formState.businessName}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      businessName: event.target.value,
                    }))
                  }
                  placeholder="Enter business name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business-type">Business type</Label>
                <Input
                  id="business-type"
                  value={formState.businessType}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      businessType: event.target.value,
                    }))
                  }
                  placeholder="e.g. Cafe, Restaurant, Retail"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business-location">Business location</Label>
                <Input
                  id="business-location"
                  value={formState.businessLocation}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      businessLocation: event.target.value,
                    }))
                  }
                  placeholder="Enter business location"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="appointment-type">Appointment type</Label>
                <Select
                  value={formState.appointmentType}
                  onValueChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      appointmentType: value as FormState["appointmentType"],
                      meetingLocation:
                        value === "Physical" ? current.meetingLocation : "",
                    }))
                  }
                >
                  <SelectTrigger id="appointment-type">
                    <SelectValue placeholder="Select appointment type" />
                  </SelectTrigger>
                  <SelectContent>
                    {appointmentTypeOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="meeting-location">Meeting location</Label>
                <Input
                  id="meeting-location"
                  value={formState.meetingLocation}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      meetingLocation: event.target.value,
                    }))
                  }
                  placeholder={
                    formState.appointmentType === "Physical"
                      ? "Enter meeting location"
                      : "Meeting location is only required for physical appointments"
                  }
                  disabled={formState.appointmentType !== "Physical"}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-date">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="scheduled-date"
                      variant="outline"
                      className="w-full justify-between text-left font-normal"
                    >
                      <span className="flex items-center gap-2">
                        <CalendarIcon className="size-4" />
                        {format(
                          formState.scheduledDate
                            ? new Date(`${formState.scheduledDate}T00:00:00`)
                            : new Date(),
                          "dd MMM yyyy"
                        )}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" portalled={false} className="w-auto p-0">
                    <Calendar04
                      mode="single"
                      selected={
                        formState.scheduledDate
                          ? new Date(`${formState.scheduledDate}T00:00:00`)
                          : undefined
                      }
                      onSelect={(date: Date | undefined) =>
                        date &&
                        setFormState((current) => ({
                          ...current,
                          scheduledDate: format(date, "yyyy-MM-dd"),
                        }))
                      }
                      defaultMonth={
                        formState.scheduledDate
                          ? new Date(`${formState.scheduledDate}T00:00:00`)
                          : new Date()
                      }
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-time">Time</Label>
                <Select
                  value={formState.scheduledTime}
                  onValueChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      scheduledTime: value,
                    }))
                  }
                >
                  <SelectTrigger id="scheduled-time">
                    <SelectValue placeholder="Select time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Business hours</SelectLabel>
                      {timeOptions.map((option) => (
                        <SelectItem key={option.id} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFormOpen(false)
                resetFormState()
              }}
              disabled={formLoading}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={formLoading}>
              {formLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              {editingAppointment ? "Save changes" : "Submit appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={actionOpen}
        onOpenChange={(open) => {
          setActionOpen(open)
          if (!open) {
            setActionTarget(null)
            setActionReason("")
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {actionType === "complete"
                ? "Complete appointment"
                : "Cancel appointment"}
            </DialogTitle>
            <DialogDescription>
              {actionTarget
                ? `Update the status for ${actionTarget.businessName}.`
                : "Update this appointment status."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-4 text-sm">
              <div className="font-medium">
                {actionTarget?.businessName ?? "Selected appointment"}
              </div>
              <div className="text-muted-foreground mt-1">
                {actionTarget ? formatDateTime(actionTarget.scheduledAt) : "--"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-reason">
                {actionType === "complete"
                  ? "Completion reason"
                  : "Cancellation reason"}
              </Label>
              <textarea
                id="action-reason"
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                placeholder={
                  actionType === "complete"
                    ? "Add completion context"
                    : "Add cancellation context"
                }
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setActionOpen(false)
                setActionTarget(null)
                setActionReason("")
              }}
              disabled={actionLoading}
            >
              Close
            </Button>
            <Button onClick={() => void handleActionSubmit()} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              {actionType === "complete"
                ? "Complete appointment"
                : "Cancel appointment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
