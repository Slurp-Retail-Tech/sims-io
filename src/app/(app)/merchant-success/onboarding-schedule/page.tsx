"use client"

import * as React from "react"
import {
  addDays,
  addHours,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import {
  Ban,
  CalendarDays,
  CalendarIcon,
  CheckCircle2,
  Clock3,
  Edit3,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Search,
  UserCheck2,
} from "lucide-react"

import Calendar04 from "@/components/calendar-04"
import {
  GooglePlacePicker,
  type GooglePlaceLocation,
} from "@/components/google-place-picker"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/toast-provider"
import { formatDateTime, parseDate } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { uploadFile } from "@/lib/upload-client"
import { cn } from "@/lib/utils"

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>

type AppointmentAttachment = {
  key: string
  name: string
  url: string
}

type Appointment = {
  id: string
  outletName: string
  installationType: "Online" | "On-site" | "Support"
  scheduledAt: string
  scheduledEndAt: string
  paymentStatus: "Pending" | "Paid" | "Unpaid"
  status: "Pending" | "Approved" | "Completed" | "Canceled"
  locationName: string | null
  locationAddress: string | null
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
  createdByUserId: string
  createdByName: string | null
  decisionByUserId: string | null
  decisionByName: string | null
  decisionAt: string | null
  decisionReason: string | null
  assignedMsUserId: string | null
  assignedMsUserName: string | null
  canceledByUserId: string | null
  canceledByName: string | null
  canceledAt: string | null
  cancelReason: string | null
  attachments: string[]
  attachmentFiles: AppointmentAttachment[]
  createdAt: string
  updatedAt: string
  canEdit: boolean
  canReview: boolean
  canAssign: boolean
  canCancel: boolean
}

type MerchantOption = {
  id: string
  name: string
  fid: string | null
  externalId: string
  company: string | null
}

type OutletOption = {
  id: string
  external_id: string
  name: string
}

type MsUser = {
  id: string
  name: string
  email: string
}

type FormState = {
  outletName: string
  installationType: "Online" | "On-site" | "Support"
  scheduledDate: string
  scheduledTime: string
  scheduledEndTime: string
  paymentStatus: "Pending" | "Paid" | "Unpaid"
  locationName: string
  locationAddress: string
  googlePlaceId: string
  googleMapsUri: string
  locationLat: number | null
  locationLng: number | null
  existingAttachments: AppointmentAttachment[]
  newFiles: File[]
}

type AgendaStatusFilter = "all" | Appointment["status"]

const installationTypeOptions = ["Online", "On-site", "Support"] as const
const paymentStatusOptions = ["Pending", "Paid", "Unpaid"] as const
const timeOptions = Array.from({ length: 31 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  const date = new Date(2000, 0, 1, hours, minutes)
  return { id: value, value, label: format(date, "h:mm a") }
})

const statusBadgeStyles: Record<Appointment["status"], string> = {
  Pending: "bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20",
  Approved: "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/20",
  Completed: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20",
  Canceled: "bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/20",
}

const paymentBadgeStyles: Record<Appointment["paymentStatus"], string> = {
  Pending: "bg-sky-500/10 text-sky-700 ring-1 ring-sky-500/20",
  Paid: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20",
  Unpaid: "bg-orange-500/10 text-orange-700 ring-1 ring-orange-500/20",
}

const calendarEventStyles: Record<Appointment["status"], string> = {
  Pending: "bg-amber-500/12 text-amber-800 border-amber-500/20",
  Approved: "bg-sky-500/12 text-sky-800 border-sky-500/20",
  Completed: "bg-emerald-500/12 text-emerald-800 border-emerald-500/20",
  Canceled: "bg-rose-500/12 text-rose-800 border-rose-500/20 line-through",
}

function getDefaultFormState(): FormState {
  const scheduledTime = timeOptions[0].value
  return {
    outletName: "",
    installationType: "Online",
    scheduledDate: format(new Date(), "yyyy-MM-dd"),
    scheduledTime,
    scheduledEndTime: getDefaultEndTime(scheduledTime),
    paymentStatus: "Pending",
    locationName: "",
    locationAddress: "",
    googlePlaceId: "",
    googleMapsUri: "",
    locationLat: null,
    locationLng: null,
    existingAttachments: [],
    newFiles: [],
  }
}

function getDefaultEndTime(startTime: string) {
  const [hours, minutes] = startTime.split(":").map(Number)
  const start = new Date(2000, 0, 1, hours, minutes)
  return format(addHours(start, 3), "HH:mm")
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
  return timeOptions.find((option) => option.value === value)?.value ?? timeOptions[0].value
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

function formatAppointmentRange(appointment: Appointment) {
  const start = parseDate(appointment.scheduledAt)
  const end = parseDate(appointment.scheduledEndAt)
  if (!start || !end) return formatDateTime(appointment.scheduledAt)
  return `${format(start, "dd MMM yyyy, h:mm a")} - ${format(end, "h:mm a")}`
}

function formatCalendarChipLabel(appointment: Appointment) {
  const start = parseDate(appointment.scheduledAt)
  const time = start ? format(start, "ha").toLowerCase() : "--"
  return `${time} ${appointment.installationType}: ${appointment.outletName}`
}

function getMonthGridDays(month: Date) {
  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 0 })
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 0 })
  const days: Date[] = []
  for (let day = first; day <= last; day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

export default function OnboardingSchedulePage() {
  const { showToast } = useToast()
  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null)
  const [ready, setReady] = React.useState(false)
  const [appointments, setAppointments] = React.useState<Appointment[]>([])
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = React.useState(() => startOfDay(new Date()))
  const [agendaStatus, setAgendaStatus] = React.useState<AgendaStatusFilter>("all")
  const [loading, setLoading] = React.useState(false)

  const [formOpen, setFormOpen] = React.useState(false)
  const [formLoading, setFormLoading] = React.useState(false)
  const [editingAppointment, setEditingAppointment] = React.useState<Appointment | null>(null)
  const [formState, setFormState] = React.useState<FormState>(getDefaultFormState)

  const [merchantQuery, setMerchantQuery] = React.useState("")
  const deferredMerchantQuery = React.useDeferredValue(merchantQuery)
  const [merchantLoading, setMerchantLoading] = React.useState(false)
  const [merchantResults, setMerchantResults] = React.useState<MerchantOption[]>([])
  const [selectedMerchantId, setSelectedMerchantId] = React.useState("")
  const [selectedOutletId, setSelectedOutletId] = React.useState("")
  const [outletOptions, setOutletOptions] = React.useState<OutletOption[]>([])
  const [outletLoading, setOutletLoading] = React.useState(false)

  const [locationQuery, setLocationQuery] = React.useState("")
  const [placesEnabled, setPlacesEnabled] = React.useState(true)

  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [reviewTarget, setReviewTarget] = React.useState<Appointment | null>(null)
  const [reviewAction, setReviewAction] = React.useState<"approve" | "complete">("approve")
  const [reviewReason, setReviewReason] = React.useState("")
  const [reviewAssignedMsUserId, setReviewAssignedMsUserId] = React.useState("")
  const [reviewLoading, setReviewLoading] = React.useState(false)

  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [cancelTarget, setCancelTarget] = React.useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = React.useState("")
  const [cancelLoading, setCancelLoading] = React.useState(false)

  const [msUsers, setMsUsers] = React.useState<MsUser[]>([])
  const [msUsersLoading, setMsUsersLoading] = React.useState(false)
  const [assignmentDrafts, setAssignmentDrafts] = React.useState<Record<string, string>>({})
  const [assignmentSavingId, setAssignmentSavingId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const user = getSessionUser()
    setSessionUser(user)
    setReady(true)
  }, [])


  const loadAppointments = React.useCallback(async () => {
    if (!sessionUser) return
    setLoading(true)
    try {
      const start = startOfMonth(month).toISOString()
      const end = endOfMonth(month).toISOString()
      const response = await fetch(
        `/api/onboarding-appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      )
      const payload = (await response.json()) as { appointments?: Appointment[]; error?: string }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load schedules.")
      setAppointments(payload.appointments ?? [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to load schedules.", "error")
    } finally {
      setLoading(false)
    }
  }, [sessionUser, month, showToast])

  const loadMsUsers = React.useCallback(async () => {
    if (!sessionUser) return
    setMsUsersLoading(true)
    try {
      const response = await fetch("/api/users/agents")
      const payload = (await response.json()) as { users?: MsUser[]; error?: string }
      if (!response.ok) throw new Error(payload.error ?? "Unable to load Merchant Success users.")
      setMsUsers(payload.users ?? [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to load Merchant Success users.", "error")
    } finally {
      setMsUsersLoading(false)
    }
  }, [sessionUser, showToast])

  React.useEffect(() => {
    if (sessionUser) void loadAppointments()
  }, [sessionUser, loadAppointments])

  React.useEffect(() => {
    if (sessionUser) void loadMsUsers()
  }, [sessionUser, loadMsUsers])

  React.useEffect(() => {
    if (!formOpen || !sessionUser) return
    const query = deferredMerchantQuery.trim()
    if (query.length < 2) {
      setMerchantResults([])
      return
    }
    const controller = new AbortController()
    void (async () => {
      setMerchantLoading(true)
      try {
        const response = await fetch(`/api/merchants/options?q=${encodeURIComponent(query)}&limit=25`, {
                    signal: controller.signal,
        })
        const payload = (await response.json()) as { merchants?: MerchantOption[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "Unable to search merchants.")
        setMerchantResults(payload.merchants ?? [])
      } catch (error) {
        if (!controller.signal.aborted) {
          showToast(error instanceof Error ? error.message : "Unable to search merchants.", "error")
        }
      } finally {
        if (!controller.signal.aborted) setMerchantLoading(false)
      }
    })()
    return () => controller.abort()
  }, [sessionUser, deferredMerchantQuery, formOpen, showToast])

  React.useEffect(() => {
    if (!selectedMerchantId || !sessionUser || !formOpen) {
      setSelectedOutletId("")
      setOutletOptions([])
      return
    }
    void (async () => {
      setOutletLoading(true)
      try {
        const response = await fetch(`/api/merchants/${selectedMerchantId}/outlets`, {
                  })
        const payload = (await response.json()) as { outlets?: OutletOption[]; error?: string }
        if (!response.ok) throw new Error(payload.error ?? "Unable to load outlets.")
        setOutletOptions(payload.outlets ?? [])
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Unable to load outlets.", "error")
      } finally {
        setOutletLoading(false)
      }
    })()
  }, [sessionUser, formOpen, selectedMerchantId, showToast])

  const calendarDays = React.useMemo(() => getMonthGridDays(month), [month])

  const appointmentsByDate = React.useMemo(() => {
    const grouped = new Map<string, Appointment[]>()
    for (const appointment of appointments) {
      const date = parseDate(appointment.scheduledAt)
      if (!date) continue
      const key = format(date, "yyyy-MM-dd")
      const existing = grouped.get(key)
      if (existing) {
        existing.push(appointment)
      } else {
        grouped.set(key, [appointment])
      }
    }
    for (const dayAppointments of grouped.values()) {
      dayAppointments.sort((a, b) => {
        const left = parseDate(a.scheduledAt)?.valueOf() ?? 0
        const right = parseDate(b.scheduledAt)?.valueOf() ?? 0
        return left - right
      })
    }
    return grouped
  }, [appointments])

  const filteredAgendaAppointments = React.useMemo(
    () =>
      agendaStatus === "all"
        ? appointments
        : appointments.filter((appointment) => appointment.status === agendaStatus),
    [agendaStatus, appointments]
  )

  const counts = React.useMemo(
    () => ({
      Pending: appointments.filter((a) => a.status === "Pending").length,
      Approved: appointments.filter((a) => a.status === "Approved").length,
      Completed: appointments.filter((a) => a.status === "Completed").length,
      Total: appointments.length,
    }),
    [appointments]
  )

  const resetFormState = React.useCallback(() => {
    setEditingAppointment(null)
    setFormState(getDefaultFormState())
    setMerchantQuery("")
    setMerchantResults([])
    setSelectedMerchantId("")
    setSelectedOutletId("")
    setOutletOptions([])
    setLocationQuery("")
  }, [])

  const openEditDialog = React.useCallback((appointment: Appointment) => {
    setEditingAppointment(appointment)
    setFormState({
      outletName: appointment.outletName,
      installationType: appointment.installationType,
      scheduledDate: getLocalDatePart(appointment.scheduledAt),
      scheduledTime: normalizeTimeOption(getLocalTimePart(appointment.scheduledAt)),
      scheduledEndTime: normalizeTimeOption(getLocalTimePart(appointment.scheduledEndAt)),
      paymentStatus: appointment.paymentStatus,
      locationName: appointment.locationName ?? "",
      locationAddress: appointment.locationAddress ?? "",
      googlePlaceId: appointment.googlePlaceId ?? "",
      googleMapsUri: appointment.googleMapsUri ?? "",
      locationLat: appointment.locationLat,
      locationLng: appointment.locationLng,
      existingAttachments: appointment.attachmentFiles,
      newFiles: [],
    })
    setMerchantQuery("")
    setMerchantResults([])
    setSelectedMerchantId("")
    setSelectedOutletId("")
    setOutletOptions([])
    setLocationQuery(
      appointment.locationName && appointment.locationAddress
        ? `${appointment.locationName}, ${appointment.locationAddress}`
        : appointment.locationAddress ?? appointment.locationName ?? ""
    )
    setFormOpen(true)
  }, [])

  const handleLocationSelect = React.useCallback(
    (location: GooglePlaceLocation) => {
      setFormState((current) => ({
        ...current,
        locationName: location.locationName,
        locationAddress: location.locationAddress,
        googlePlaceId: location.googlePlaceId,
        googleMapsUri: location.googleMapsUri ?? "",
        locationLat: location.locationLat,
        locationLng: location.locationLng,
      }))
    },
    []
  )

  const clearLocation = React.useCallback(() => {
    setFormState((current) => ({
      ...current,
      locationName: "",
      locationAddress: "",
      googlePlaceId: "",
      googleMapsUri: "",
      locationLat: null,
      locationLng: null,
    }))
  }, [])

  const selectedPlaceLocation = React.useMemo<GooglePlaceLocation | null>(
    () =>
      formState.googlePlaceId
        ? {
            googlePlaceId: formState.googlePlaceId,
            locationName: formState.locationName,
            locationAddress: formState.locationAddress,
            googleMapsUri: formState.googleMapsUri || null,
            locationLat: formState.locationLat,
            locationLng: formState.locationLng,
          }
        : null,
    [formState]
  )

  const handleSubmit = React.useCallback(async () => {
    if (!sessionUser) return
    if (!formState.outletName.trim()) {
      showToast("Outlet name is required.", "error")
      return
    }
    if (placesEnabled && formState.installationType === "On-site" && !formState.googlePlaceId) {
      showToast("Location is required for on-site onboarding.", "error")
      return
    }
    const scheduledAt = buildIsoDateTime(formState.scheduledDate, formState.scheduledTime)
    if (!scheduledAt) {
      showToast("Please select a valid date and time.", "error")
      return
    }
    const scheduledEndAt = buildIsoDateTime(
      formState.scheduledDate,
      formState.scheduledEndTime
    )
    if (!scheduledEndAt || new Date(scheduledEndAt) <= new Date(scheduledAt)) {
      showToast("Please select an end time after the start time.", "error")
      return
    }
    setFormLoading(true)
    try {
      const uploadedAttachments: AppointmentAttachment[] = []
      for (const file of formState.newFiles) {
        const upload = await uploadFile({ file, userId: sessionUser.id })
        uploadedAttachments.push({ key: upload.key, name: file.name, url: upload.url })
      }
      const response = await fetch(
        editingAppointment ? `/api/onboarding-appointments/${editingAppointment.id}` : "/api/onboarding-appointments",
        {
          method: editingAppointment ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingAppointment
              ? {
                  outletName: formState.outletName.trim(),
                  installationType: formState.installationType,
                  scheduledAt,
                  scheduledEndAt,
                  paymentStatus: formState.paymentStatus,
                  locationName: formState.locationName,
                  locationAddress: formState.locationAddress,
                  googlePlaceId: formState.googlePlaceId,
                  googleMapsUri: formState.googleMapsUri,
                  locationLat: formState.locationLat,
                  locationLng: formState.locationLng,
                  existingAttachmentKeys: formState.existingAttachments.map((a) => a.key),
                  newAttachmentKeys: uploadedAttachments.map((a) => a.key),
                  newAttachmentNames: uploadedAttachments.map((a) => a.name),
                }
              : {
                  outletName: formState.outletName.trim(),
                  installationType: formState.installationType,
                  scheduledAt,
                  scheduledEndAt,
                  paymentStatus: formState.paymentStatus,
                  locationName: formState.locationName,
                  locationAddress: formState.locationAddress,
                  googlePlaceId: formState.googlePlaceId,
                  googleMapsUri: formState.googleMapsUri,
                  locationLat: formState.locationLat,
                  locationLng: formState.locationLng,
                  attachmentKeys: uploadedAttachments.map((a) => a.key),
                  attachmentNames: uploadedAttachments.map((a) => a.name),
                }
          ),
        }
      )
      const payload = (await response.json()) as { appointment?: Appointment; error?: string }
      if (!response.ok || !payload.appointment) throw new Error(payload.error ?? "Unable to save schedule.")
      const nextDate = parseDate(payload.appointment.scheduledAt) ?? new Date()
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setSelectedDate(startOfDay(nextDate))
      setMonth(startOfMonth(nextDate))
      setFormOpen(false)
      resetFormState()
      showToast(editingAppointment ? "Schedule updated successfully." : "Schedule created successfully.")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to save schedule.", "error")
    } finally {
      setFormLoading(false)
    }
  }, [editingAppointment, formState, placesEnabled, resetFormState, sessionUser, showToast])

  const handleReviewSubmit = React.useCallback(async () => {
    if (!sessionUser || !reviewTarget) return
    setReviewLoading(true)
    try {
      const response = await fetch(`/api/onboarding-appointments/${reviewTarget.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: reviewAction,
          reason: reviewReason.trim() || undefined,
          ...(reviewAction === "approve" ? { assignedMsUserId: reviewAssignedMsUserId } : {}),
        }),
      })
      const payload = (await response.json()) as { appointment?: Appointment; error?: string }
      if (!response.ok || !payload.appointment) throw new Error(payload.error ?? "Unable to update status.")
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setReviewOpen(false)
      setReviewTarget(null)
      setReviewReason("")
      setReviewAssignedMsUserId("")
      showToast(reviewAction === "approve" ? "Schedule approved." : "Schedule completed.")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to update status.", "error")
    } finally {
      setReviewLoading(false)
    }
  }, [sessionUser, reviewAction, reviewAssignedMsUserId, reviewReason, reviewTarget, showToast])

  const openCancelDialog = React.useCallback((appointment: Appointment) => {
    setCancelTarget(appointment)
    setCancelReason("")
    setCancelOpen(true)
  }, [])

  const handleCancelSubmit = React.useCallback(async () => {
    if (!sessionUser || !cancelTarget) return
    const reason = cancelReason.trim()
    if (!reason) {
      showToast("Please enter a cancellation reason.", "error")
      return
    }
    setCancelLoading(true)
    try {
      const response = await fetch(`/api/onboarding-appointments/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      })
      const payload = (await response.json()) as { appointment?: Appointment; error?: string }
      if (!response.ok || !payload.appointment) throw new Error(payload.error ?? "Unable to cancel schedule.")
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setCancelOpen(false)
      setCancelTarget(null)
      setCancelReason("")
      showToast("Schedule canceled.")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to cancel schedule.", "error")
    } finally {
      setCancelLoading(false)
    }
  }, [sessionUser, cancelTarget, cancelReason, showToast])

  const handleAssignmentSave = React.useCallback(async (appointment: Appointment) => {
    if (!sessionUser) return
    const assignedMsUserId =
      assignmentDrafts[appointment.id] === "__none__"
        ? null
        : assignmentDrafts[appointment.id] ?? appointment.assignedMsUserId ?? null
    setAssignmentSavingId(appointment.id)
    try {
      const response = await fetch(`/api/onboarding-appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedMsUserId }),
      })
      const payload = (await response.json()) as { appointment?: Appointment; error?: string }
      if (!response.ok || !payload.appointment) throw new Error(payload.error ?? "Unable to update assignee.")
      setAppointments((current) => replaceAppointment(current, payload.appointment!))
      setAssignmentDrafts((current) => {
        const next = { ...current }
        delete next[appointment.id]
        return next
      })
      showToast("Assignment updated.")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to update assignee.", "error")
    } finally {
      setAssignmentSavingId(null)
    }
  }, [sessionUser, assignmentDrafts, showToast])

  if (!ready) {
    return <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center text-sm">Loading onboarding schedule...</div>
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding Schedule</h1>
          <p className="text-muted-foreground text-sm">
            Schedule onboarding installs, track progress, and assign approved visits to Merchant Success.
          </p>
        </div>
        <Button size="sm" onClick={() => { resetFormState(); setFormOpen(true) }}>New onboarding</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total", value: counts.Total, icon: CalendarDays },
          { label: "Pending", value: counts.Pending, icon: Clock3 },
          { label: "Approved", value: counts.Approved, icon: UserCheck2 },
          { label: "Completed", value: counts.Completed, icon: CheckCircle2 },
        ].map((metric) => {
          const Icon = metric.icon
          return (
            <Card key={metric.label}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="text-muted-foreground text-sm">{metric.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{metric.value}</div>
                </div>
                <div className="bg-muted flex size-10 items-center justify-center rounded-md">
                  <Icon className="text-muted-foreground size-5" />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <div className="min-w-0 self-start">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="size-4" />Calendar</CardTitle>
                  <CardDescription>{format(month, "MMMM yyyy")} onboarding appointments.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(addMonths(month, -1)))}>Previous</Button>
                  <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
                  <Button size="sm" variant="outline" onClick={() => setMonth(startOfMonth(addMonths(month, 1)))}>Next</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <div className="min-w-[860px]">
                  <div className="grid grid-cols-7 border-b bg-muted/40">
                    {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((day) => (
                      <div key={day} className="border-r px-3 py-2 text-center text-xs font-medium text-muted-foreground last:border-r-0">{day}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day) => {
                      const key = format(day, "yyyy-MM-dd")
                      const dayAppointments = appointmentsByDate.get(key) ?? []
                      return (
                        <div
                          key={key}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            "min-h-32 border-r border-b p-2 text-left align-top last:border-r-0",
                            !isSameMonth(day, month) && "bg-muted/30 text-muted-foreground",
                            isSameDay(day, selectedDate) && "bg-primary/5"
                          )}
                          onClick={() => setSelectedDate(startOfDay(day))}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              setSelectedDate(startOfDay(day))
                            }
                          }}
                        >
                          <div className={cn("mb-2 flex justify-center text-xs", isToday(day) && "font-semibold text-primary")}>
                            <span className={cn("flex size-6 items-center justify-center rounded-full", isToday(day) && "bg-primary text-primary-foreground")}>{format(day, "d")}</span>
                          </div>
                          <div className="space-y-1">
                            {dayAppointments.slice(0, 4).map((appointment) => (
                              <Popover key={appointment.id}>
                                <PopoverTrigger asChild>
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className={cn(
                                      "flex w-full cursor-pointer items-center gap-1 truncate rounded-md border px-2 py-1 text-xs font-medium hover:brightness-95",
                                      calendarEventStyles[appointment.status]
                                    )}
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    <span className="size-1.5 shrink-0 rounded-full bg-current" />
                                    <span className="truncate">{formatCalendarChipLabel(appointment)}</span>
                                  </span>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-[360px] p-0">
                                  <div className="space-y-4 p-4">
                                    <div className="flex items-start gap-3">
                                      <span className={cn("mt-1 size-3 rounded-sm", appointment.status === "Pending" ? "bg-amber-500" : appointment.status === "Approved" ? "bg-sky-500" : appointment.status === "Canceled" ? "bg-rose-500" : "bg-emerald-500")} />
                                      <div className="min-w-0 flex-1">
                                        <div className="text-base font-semibold leading-snug">{appointment.installationType}: {appointment.outletName}</div>
                                        <div className="text-muted-foreground mt-1 text-sm">{formatAppointmentRange(appointment)}</div>
                                      </div>
                                      {appointment.canEdit ? (
                                        <Button size="icon" variant="ghost" className="size-8" onClick={() => openEditDialog(appointment)} aria-label="Edit appointment">
                                          <Edit3 className="size-4" />
                                        </Button>
                                      ) : null}
                                    </div>
                                    <div className="grid gap-3 text-sm">
                                      <div className="flex items-start gap-3"><FileText className="text-muted-foreground mt-0.5 size-4" /><div>SIMS appointment: {appointment.id}<br />Status: {appointment.status}<br />Payment: {appointment.paymentStatus}<br />Created by: {appointment.createdByName ?? "--"}<br />Assigned MS: {appointment.assignedMsUserName ?? "--"}{appointment.decisionByName ? <><br />Decision by: {appointment.decisionByName}</> : null}{appointment.decisionAt ? <><br />Decision at: {formatDateTime(appointment.decisionAt)}</> : null}</div></div>
                                      {appointment.locationAddress ? (
                                        <div className="flex items-start gap-3">
                                          <MapPin className="text-muted-foreground mt-0.5 size-4" />
                                          <div className="min-w-0">
                                            <div>{appointment.locationName ? `${appointment.locationName}, ${appointment.locationAddress}` : appointment.locationAddress}</div>
                                            {appointment.googleMapsUri ? <a href={appointment.googleMapsUri} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">Google Maps <ExternalLink className="size-3" /></a> : null}
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                    {appointment.status === "Canceled" ? (
                                      <div className="rounded-md bg-rose-500/5 p-3 text-sm">
                                        <div className="text-rose-700 font-medium">Canceled{appointment.canceledByName ? ` by ${appointment.canceledByName}` : ""}{appointment.canceledAt ? ` • ${formatDateTime(appointment.canceledAt)}` : ""}</div>
                                        <div className="text-muted-foreground mt-1 whitespace-pre-line">{appointment.cancelReason ?? "--"}</div>
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                      {appointment.canReview && appointment.status === "Pending" ? <Button size="sm" variant="outline" onClick={() => { setReviewTarget(appointment); setReviewAction("approve"); setReviewReason(""); setReviewAssignedMsUserId(appointment.assignedMsUserId ?? ""); setReviewOpen(true) }}>Approve</Button> : null}
                                      {appointment.canReview && appointment.status === "Approved" ? <Button size="sm" onClick={() => { setReviewTarget(appointment); setReviewAction("complete"); setReviewReason(""); setReviewAssignedMsUserId(""); setReviewOpen(true) }}>Complete</Button> : null}
                                      {appointment.canCancel ? <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-700" onClick={() => openCancelDialog(appointment)}><Ban className="size-3.5" />Cancel</Button> : null}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            ))}
                            {dayAppointments.length > 4 ? <div className="text-muted-foreground px-2 text-xs">+{dayAppointments.length - 4} more</div> : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="h-[720px] min-h-0 overflow-hidden">
          <Card className="flex h-full min-h-0 flex-col gap-0 overflow-hidden py-0">
            <CardHeader className="shrink-0 gap-4 border-b">
              <div className="space-y-2">
                <CardTitle className="text-base">{format(month, "MMMM yyyy")} agenda</CardTitle>
                <CardDescription>Showing schedules for the displayed month.</CardDescription>
              </div>
              <Tabs value={agendaStatus} onValueChange={(value) => setAgendaStatus(value as AgendaStatusFilter)}>
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="Pending">Pending</TabsTrigger>
                  <TabsTrigger value="Approved">Approved</TabsTrigger>
                  <TabsTrigger value="Completed">Completed</TabsTrigger>
                  <TabsTrigger value="Canceled">Canceled</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-6 pr-3"
            >
            {loading ? (
              <div className="text-muted-foreground flex min-h-[240px] items-center justify-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Loading schedules...</div>
            ) : filteredAgendaAppointments.length === 0 ? (
              <div className="text-muted-foreground flex min-h-[240px] items-center justify-center text-sm">No schedules match this filter.</div>
            ) : filteredAgendaAppointments.map((appointment, index) => {
              const assignmentValue = assignmentDrafts[appointment.id] ?? appointment.assignedMsUserId ?? "__none__"
              return (
                <div key={appointment.id} className="space-y-4">
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-base font-semibold">{appointment.outletName}</div>
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium", statusBadgeStyles[appointment.status])}>{appointment.status}</span>
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium", paymentBadgeStyles[appointment.paymentStatus])}>Payment {appointment.paymentStatus}</span>
                        </div>
                        <div className="text-muted-foreground text-sm">{formatAppointmentRange(appointment)} • {appointment.installationType}</div>
                        {appointment.locationAddress ? (
                          <div className="text-muted-foreground flex items-start gap-2 text-sm">
                            <MapPin className="mt-0.5 size-4 shrink-0" />
                            <span>{appointment.locationName ? `${appointment.locationName}, ${appointment.locationAddress}` : appointment.locationAddress}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {appointment.canEdit ? <Button size="sm" variant="outline" onClick={() => openEditDialog(appointment)}>Edit</Button> : null}
                        {appointment.canReview && appointment.status === "Pending" ? <Button size="sm" variant="outline" onClick={() => { setReviewTarget(appointment); setReviewAction("approve"); setReviewReason(""); setReviewAssignedMsUserId(appointment.assignedMsUserId ?? ""); setReviewOpen(true) }}>Approve</Button> : null}
                        {appointment.canReview && appointment.status === "Approved" ? <Button size="sm" onClick={() => { setReviewTarget(appointment); setReviewAction("complete"); setReviewReason(""); setReviewAssignedMsUserId(""); setReviewOpen(true) }}>Complete</Button> : null}
                        {appointment.canCancel ? <Button size="sm" variant="outline" className="text-rose-700 hover:text-rose-700" onClick={() => openCancelDialog(appointment)}><Ban className="size-4" />Cancel</Button> : null}
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <div><div className="text-muted-foreground text-xs uppercase tracking-wide">Submitter</div><div className="font-medium">{appointment.createdByName ?? "--"}</div></div>
                      <div><div className="text-muted-foreground text-xs uppercase tracking-wide">Updated by</div><div className="font-medium">{appointment.status === "Pending" ? "--" : appointment.decisionByName ?? "--"}</div></div>
                      <div><div className="text-muted-foreground text-xs uppercase tracking-wide">Status updated</div><div className="font-medium">{appointment.decisionAt ? formatDateTime(appointment.decisionAt) : "--"}</div></div>
                      <div><div className="text-muted-foreground text-xs uppercase tracking-wide">Status note</div><div className="font-medium">{appointment.decisionReason ?? "--"}</div></div>
                    </div>

                    {appointment.status === "Canceled" ? (
                      <div className="space-y-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm">
                        <div className="flex items-center gap-2 font-medium text-rose-700"><Ban className="size-4" />Canceled{appointment.canceledByName ? ` by ${appointment.canceledByName}` : ""}{appointment.canceledAt ? ` • ${formatDateTime(appointment.canceledAt)}` : ""}</div>
                        <div className="text-muted-foreground whitespace-pre-line">{appointment.cancelReason ?? "--"}</div>
                      </div>
                    ) : null}

                    <div className="space-y-2">
                      <div className="text-muted-foreground text-xs uppercase tracking-wide">Reference files</div>
                      {appointment.attachmentFiles.length === 0 ? (
                        <div className="text-muted-foreground text-sm">No reference files uploaded.</div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {appointment.attachmentFiles.map((attachment) => (
                            <a key={attachment.key} href={attachment.url} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium hover:underline">{attachment.name}</a>
                          ))}
                        </div>
                      )}
                    </div>

                    {appointment.canAssign && appointment.status === "Approved" ? (
                      <div className="space-y-3 rounded-xl border border-dashed p-3">
                        <div className="flex items-center gap-2 text-sm font-medium"><UserCheck2 className="size-4" />Assign Merchant Success owner</div>
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                          <div className="space-y-2">
                            <Label htmlFor={`assign-${appointment.id}`}>MS PIC</Label>
                            <Select value={assignmentValue} onValueChange={(value) => setAssignmentDrafts((current) => ({ ...current, [appointment.id]: value }))}>
                              <SelectTrigger id={`assign-${appointment.id}`}><SelectValue placeholder={msUsersLoading ? "Loading users..." : "Select Merchant Success user"} /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Unassigned</SelectItem>
                                {msUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <Button size="sm" onClick={() => void handleAssignmentSave(appointment)} disabled={assignmentSavingId === appointment.id || msUsersLoading}>
                            {assignmentSavingId === appointment.id ? <Loader2 className="size-4 animate-spin" /> : null}
                            Save assignee
                          </Button>
                        </div>
                        <div className="text-muted-foreground text-xs">Current assignee: <span className="font-medium">{appointment.assignedMsUserName ?? "--"}</span></div>
                      </div>
                    ) : appointment.status === "Approved" || appointment.status === "Completed" ? (
                      <div className="text-muted-foreground text-sm">Assigned MS PIC: <span className="font-medium">{appointment.assignedMsUserName ?? "--"}</span></div>
                    ) : null}
                  </div>
                  {index < filteredAgendaAppointments.length - 1 ? <Separator /> : null}
                </div>
              )
            })}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={(open) => { if (!open) { setFormOpen(false); resetFormState() } }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAppointment ? "Edit schedule" : "Create schedule"}</DialogTitle>
            <DialogDescription>Capture outlet, installation type, payment status, and reference files for the onboarding schedule.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-6">
            <div className="grid gap-4 rounded-xl border p-4">
              <div className="space-y-2">
                <Label htmlFor="merchant-search">Merchant lookup</Label>
                <div className="relative">
                  <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                  <Input id="merchant-search" value={merchantQuery} onChange={(event) => setMerchantQuery(event.target.value)} className="pl-9" placeholder="Search FID, franchise name, or company name" />
                </div>
                <div className="text-muted-foreground text-xs">Optional helper to populate outlet names from the merchant directory.</div>
              </div>

              {merchantLoading ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Searching merchants...</div>
              ) : merchantResults.length > 0 ? (
                <div className="grid gap-2">
                  <Label htmlFor="merchant-select">Merchant</Label>
                  <Select value={selectedMerchantId} onValueChange={setSelectedMerchantId}>
                    <SelectTrigger id="merchant-select"><SelectValue placeholder="Select merchant" /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Available merchants</SelectLabel>
                        {merchantResults.map((merchant) => (
                          <SelectItem key={merchant.id} value={merchant.id}>
                            {merchant.name}
                            {merchant.fid ? ` • FID ${merchant.fid}` : ""}
                            {merchant.company ? ` • ${merchant.company}` : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : deferredMerchantQuery.trim().length >= 2 ? (
                <div className="text-muted-foreground text-sm">No merchant matches found.</div>
              ) : null}

              {selectedMerchantId ? (
                <div className="grid gap-2">
                  <Label htmlFor="outlet-select">Outlet from selected merchant</Label>
                  <Select value={selectedOutletId} onValueChange={(value) => {
                    setSelectedOutletId(value)
                    const outlet = outletOptions.find((item) => item.id === value)
                    if (outlet) setFormState((current) => ({ ...current, outletName: outlet.name }))
                  }} disabled={outletLoading}>
                    <SelectTrigger id="outlet-select"><SelectValue placeholder={outletLoading ? "Loading outlets..." : "Select outlet"} /></SelectTrigger>
                    <SelectContent>{outletOptions.map((outlet) => <SelectItem key={outlet.id} value={outlet.id}>{outlet.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="outlet-name">Outlet name</Label>
                <Input id="outlet-name" value={formState.outletName} onChange={(event) => setFormState((current) => ({ ...current, outletName: event.target.value }))} placeholder="Enter outlet name" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="appointment-location">Google Maps location</Label>
                <GooglePlacePicker
                  id="appointment-location"
                  value={selectedPlaceLocation}
                  query={locationQuery}
                  onQueryChange={setLocationQuery}
                  onSelect={handleLocationSelect}
                  onClear={clearLocation}
                  onEnabledChange={setPlacesEnabled}
                  helperText={
                    formState.installationType === "On-site"
                      ? "Required for on-site onboarding."
                      : "Optional for online and support appointments."
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="installation-type">Installation type</Label>
                <Select value={formState.installationType} onValueChange={(value) => setFormState((current) => ({ ...current, installationType: value as FormState["installationType"] }))}>
                  <SelectTrigger id="installation-type"><SelectValue placeholder="Select installation type" /></SelectTrigger>
                  <SelectContent>{installationTypeOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment-status">Payment status</Label>
                <Select value={formState.paymentStatus} onValueChange={(value) => setFormState((current) => ({ ...current, paymentStatus: value as FormState["paymentStatus"] }))}>
                  <SelectTrigger id="payment-status"><SelectValue placeholder="Select payment status" /></SelectTrigger>
                  <SelectContent>{paymentStatusOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-date">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button id="scheduled-date" variant="outline" className="w-full justify-between text-left font-normal">
                      <span className="flex items-center gap-2"><CalendarIcon className="size-4" />{format(formState.scheduledDate ? new Date(`${formState.scheduledDate}T00:00:00`) : new Date(), "dd MMM yyyy")}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" portalled={false} className="w-auto p-0">
                    <Calendar04
                      mode="single"
                      selected={formState.scheduledDate ? new Date(`${formState.scheduledDate}T00:00:00`) : undefined}
                      onSelect={(date: Date | undefined) => date && setFormState((current) => ({ ...current, scheduledDate: format(date, "yyyy-MM-dd") }))}
                      defaultMonth={formState.scheduledDate ? new Date(`${formState.scheduledDate}T00:00:00`) : new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-time">Start time</Label>
                <Select value={formState.scheduledTime} onValueChange={(value) => setFormState((current) => ({ ...current, scheduledTime: value, scheduledEndTime: getDefaultEndTime(value) }))}>
                  <SelectTrigger id="scheduled-time"><SelectValue placeholder="Select time" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Available times</SelectLabel>
                      {timeOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled-end-time">End time</Label>
                <Select value={formState.scheduledEndTime} onValueChange={(value) => setFormState((current) => ({ ...current, scheduledEndTime: value }))}>
                  <SelectTrigger id="scheduled-end-time"><SelectValue placeholder="Select end time" /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Available times</SelectLabel>
                      {timeOptions.map((option) => <SelectItem key={option.id} value={option.value}>{option.label}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="attachments">Reference files</Label>
                <Input id="attachments" type="file" multiple onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  setFormState((current) => ({ ...current, newFiles: [...current.newFiles, ...files] }))
                  event.target.value = ""
                }} />
                <div className="text-muted-foreground text-xs">Upload screenshots, forms, or booking evidence. Files are optional.</div>
                {formState.existingAttachments.length > 0 ? (
                  <div className="grid gap-2">
                    {formState.existingAttachments.map((attachment) => (
                      <div key={attachment.key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <a href={attachment.url} target="_blank" rel="noreferrer" className="text-primary truncate hover:underline">{attachment.name}</a>
                        <Button size="sm" variant="ghost" onClick={() => setFormState((current) => ({ ...current, existingAttachments: current.existingAttachments.filter((item) => item.key !== attachment.key) }))}>Remove</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {formState.newFiles.length > 0 ? (
                  <div className="grid gap-2">
                    {formState.newFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span className="truncate">{file.name}</span>
                        <Button size="sm" variant="ghost" onClick={() => setFormState((current) => ({ ...current, newFiles: current.newFiles.filter((_, fileIndex) => fileIndex !== index) }))}>Remove</Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); resetFormState() }} disabled={formLoading}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={formLoading}>{formLoading ? <Loader2 className="size-4 animate-spin" /> : null}{editingAppointment ? "Save changes" : "Submit appointment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={(open) => { setReviewOpen(open); if (!open) { setReviewTarget(null); setReviewReason(""); setReviewAssignedMsUserId("") } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{reviewAction === "approve" ? "Approve schedule" : "Complete schedule"}</DialogTitle>
            <DialogDescription>{reviewTarget ? `Update onboarding schedule status for ${reviewTarget.outletName}.` : "Update this onboarding schedule status."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-4 text-sm">
              <div className="font-medium">{reviewTarget?.outletName ?? "Selected schedule"}</div>
              <div className="text-muted-foreground mt-1">{reviewTarget ? formatAppointmentRange(reviewTarget) : "--"}</div>
            </div>
            {reviewAction === "approve" ? (
              <div className="space-y-2">
                <Label htmlFor="review-assigned-ms">MS PIC</Label>
                <Select value={reviewAssignedMsUserId} onValueChange={setReviewAssignedMsUserId}>
                  <SelectTrigger id="review-assigned-ms">
                    <SelectValue placeholder={msUsersLoading ? "Loading users..." : "Select Merchant Success user"} />
                  </SelectTrigger>
                  <SelectContent>
                    {msUsers.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="review-reason">Reason</Label>
              <textarea id="review-reason" className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]" placeholder="Add context for approval or completion" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReviewOpen(false); setReviewTarget(null); setReviewReason(""); setReviewAssignedMsUserId("") }} disabled={reviewLoading}>Cancel</Button>
            <Button onClick={() => void handleReviewSubmit()} disabled={reviewLoading || (reviewAction === "approve" && !reviewAssignedMsUserId)}>{reviewLoading ? <Loader2 className="size-4 animate-spin" /> : null}{reviewAction === "approve" ? "Approve schedule" : "Complete schedule"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={(open) => { setCancelOpen(open); if (!open) { setCancelTarget(null); setCancelReason("") } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel schedule</DialogTitle>
            <DialogDescription>{cancelTarget ? `Cancel the onboarding schedule for ${cancelTarget.outletName}. The assigned MS PIC will be notified by email.` : "Cancel this onboarding schedule."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border p-4 text-sm">
              <div className="font-medium">{cancelTarget?.outletName ?? "Selected schedule"}</div>
              <div className="text-muted-foreground mt-1">{cancelTarget ? formatAppointmentRange(cancelTarget) : "--"}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancel-reason">Cancellation reason <span className="text-rose-600">*</span></Label>
              <textarea id="cancel-reason" className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]" placeholder="Explain why this schedule is being canceled. This will be visible to other users." value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelOpen(false); setCancelTarget(null); setCancelReason("") }} disabled={cancelLoading}>Keep schedule</Button>
            <Button variant="destructive" onClick={() => void handleCancelSubmit()} disabled={cancelLoading || !cancelReason.trim()}>{cancelLoading ? <Loader2 className="size-4 animate-spin" /> : null}Cancel schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
