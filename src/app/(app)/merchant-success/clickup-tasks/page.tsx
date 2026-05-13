"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { ExternalLink } from "@/components/external-link"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { useToast } from "@/components/toast-provider"
import { formatDateTime } from "@/lib/dates"
import { getSessionUser } from "@/lib/session"
import { uploadFile } from "@/lib/upload-client"
import { cn } from "@/lib/utils"

type TaskRequest = {
  id: string
  ticketId: string | null
  fid: string | null
  oid: string | null
  franchiseName: string | null
  product: string
  departmentRequest: string
  outletName: string
  msPic: string
  priorityLevel: string
  severityLevel: string
  incidentTitle: string
  taskDescription: string
  attachments: string[]
  status: "Pending Approval" | "Approved" | "Rejected"
  createdByUserId: string | null
  createdByEmail: string | null
  createdByName: string | null
  decisionReason: string | null
  decisionByUserId: string | null
  decisionByEmail: string | null
  decisionByName: string | null
  decisionAt: string | null
  clickupTaskId: string | null
  clickupLink: string | null
  createdAt: string
  updatedAt: string
}

type DetailResponse = {
  request: TaskRequest
  ticket: {
    id: string
    status: string
    merchantName: string | null
    franchiseName: string | null
    outletName: string | null
    fid: string | null
    oid: string | null
    category: string | null
    subcategory1: string | null
    subcategory2: string | null
    clickupTaskId: string | null
    clickupLink: string | null
    clickupTaskStatus: string | null
  } | null
}

type RequestFormState = {
  ticketId: string
  fid: string
  oid: string
  franchiseName: string
  product: string
  departmentRequest: string
  outletName: string
  msPic: string
  priorityLevel: string
  severityLevel: string
  incidentTitle: string
  taskDescription: string
  existingAttachments: string[]
  newFiles: File[]
}

type RequiredRequestField =
  | "product"
  | "priorityLevel"
  | "severityLevel"
  | "incidentTitle"
  | "taskDescription"

type SessionUser = NonNullable<ReturnType<typeof getSessionUser>>
type ClickUpDropdownOption = {
  id: string
  name: string
}

const pendingSortOptions = [
  { value: "created_at", label: "Created At" },
  { value: "priority_level", label: "Priority" },
  { value: "severity_level", label: "Severity" },
  { value: "incident_title", label: "Incident Title" },
]

const completedSortOptions = [
  { value: "decision_at", label: "Decision Date" },
  { value: "created_at", label: "Created Date" },
  { value: "status", label: "Status" },
  { value: "priority_level", label: "Priority" },
  { value: "severity_level", label: "Severity" },
]

const rowsPerPageOptions = [10, 25, 50, 100]

function getPaginationItems(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  if (current <= 3) {
    return [1, 2, 3, 4, "ellipsis", total]
  }

  if (current >= total - 2) {
    return [1, "ellipsis", total - 3, total - 2, total - 1, total]
  }

  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total]
}

function getDefaultForm(user: SessionUser | null): RequestFormState {
  return {
    ticketId: "",
    fid: "",
    oid: "",
    franchiseName: "",
    product: "",
    departmentRequest: user?.department?.trim() || "Merchant Success",
    outletName: "",
    msPic: user?.name ?? "",
    priorityLevel: "",
    severityLevel: "",
    incidentTitle: "",
    taskDescription: "",
    existingAttachments: [],
    newFiles: [],
  }
}

function getMissingRequiredFields(formState: RequestFormState) {
  const missing: RequiredRequestField[] = []

  if (!formState.product.trim()) {
    missing.push("product")
  }
  if (!formState.priorityLevel.trim()) {
    missing.push("priorityLevel")
  }
  if (!formState.severityLevel.trim()) {
    missing.push("severityLevel")
  }
  if (!formState.incidentTitle.trim()) {
    missing.push("incidentTitle")
  }
  if (!formState.taskDescription.trim()) {
    missing.push("taskDescription")
  }

  return missing
}

function formatDecisionDate(value: string | null) {
  if (!value) {
    return "--"
  }
  return formatDateTime(value)
}

export default function ClickupTasksPage() {
  const searchParams = useSearchParams()
  const { showToast } = useToast()

  const [sessionUser, setSessionUser] = React.useState<SessionUser | null>(null)
  const [ready, setReady] = React.useState(false)

  const [pendingRows, setPendingRows] = React.useState<TaskRequest[]>([])
  const [completedRows, setCompletedRows] = React.useState<TaskRequest[]>([])

  const [pendingLoading, setPendingLoading] = React.useState(false)
  const [completedLoading, setCompletedLoading] = React.useState(false)

  const [pendingSortBy, setPendingSortBy] = React.useState("created_at")
  const [pendingDirection, setPendingDirection] = React.useState<"asc" | "desc">("desc")

  const [completedSortBy, setCompletedSortBy] = React.useState("decision_at")
  const [completedDirection, setCompletedDirection] = React.useState<"asc" | "desc">("desc")
  const [completedScope, setCompletedScope] = React.useState<"all" | "mine">("mine")
  const [completedPage, setCompletedPage] = React.useState(1)
  const [completedPerPage, setCompletedPerPage] = React.useState(10)
  const [completedTotal, setCompletedTotal] = React.useState(0)

  const [formOpen, setFormOpen] = React.useState(false)
  const [formLoading, setFormLoading] = React.useState(false)
  const [formTicketLookupLoading, setFormTicketLookupLoading] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [formState, setFormState] = React.useState<RequestFormState>(getDefaultForm(null))
  const [missingRequiredFields, setMissingRequiredFields] = React.useState<
    RequiredRequestField[]
  >([])
  const [editingRequestId, setEditingRequestId] = React.useState<string | null>(null)
  const [editingDecision, setEditingDecision] = React.useState<{
    reason: string | null
    byName: string | null
    byEmail: string | null
    at: string | null
  } | null>(null)

  const [detailOpen, setDetailOpen] = React.useState(false)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [detailData, setDetailData] = React.useState<DetailResponse | null>(null)

  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [reviewTarget, setReviewTarget] = React.useState<TaskRequest | null>(null)
  const [reviewAction, setReviewAction] = React.useState<"approve" | "reject">("approve")
  const [reviewReason, setReviewReason] = React.useState("")
  const [reviewLoading, setReviewLoading] = React.useState(false)
  const [queryPrefillHandled, setQueryPrefillHandled] = React.useState(false)
  const [customFieldOptions, setCustomFieldOptions] = React.useState<{
    product: ClickUpDropdownOption[]
    departmentRequest: ClickUpDropdownOption[]
    priorityLevel: ClickUpDropdownOption[]
    severityLevel: ClickUpDropdownOption[]
  }>({
    product: [],
    departmentRequest: [],
    priorityLevel: [],
    severityLevel: [],
  })

  React.useEffect(() => {
    const user = getSessionUser()
    setSessionUser(user)
    setReady(true)
  }, [])

  React.useEffect(() => {
    if (!ready || !sessionUser || queryPrefillHandled) {
      return
    }

    const open = searchParams.get("open")
    if (open !== "create") {
      setQueryPrefillHandled(true)
      return
    }

    const ticketId = searchParams.get("ticket_id")?.trim() ?? ""
    const title = searchParams.get("title")?.trim() ?? ""
    const description = searchParams.get("description")?.trim() ?? ""
    const nextForm = getDefaultForm(sessionUser)
    nextForm.ticketId = ticketId
    nextForm.fid = searchParams.get("fid")?.trim() ?? ""
    nextForm.oid = searchParams.get("oid")?.trim() ?? ""
    nextForm.franchiseName = searchParams.get("franchise_name")?.trim() ?? ""
    nextForm.outletName = searchParams.get("outlet_name")?.trim() ?? ""
    nextForm.msPic = searchParams.get("ms_pic")?.trim() ?? nextForm.msPic
    nextForm.product = searchParams.get("product")?.trim() ?? ""
    nextForm.incidentTitle =
      title || (ticketId ? `Ticket #${ticketId} · Follow-up task` : "")
    nextForm.taskDescription = description

    setEditingRequestId(null)
    setFormError(null)
    setMissingRequiredFields([])
    setFormState(nextForm)
    setFormOpen(true)
    setQueryPrefillHandled(true)
  }, [queryPrefillHandled, ready, searchParams, sessionUser])

  const isAdmin = sessionUser?.role === "Admin" || sessionUser?.role === "Super Admin"
  const workspaceDepartment = sessionUser?.department?.trim() || "Merchant Success"
  const productOptions = React.useMemo(
    () => customFieldOptions.product.map((option) => option.name),
    [customFieldOptions.product]
  )
  const priorityOptions = React.useMemo(
    () => customFieldOptions.priorityLevel.map((option) => option.name),
    [customFieldOptions.priorityLevel]
  )
  const severityOptions = React.useMemo(
    () => customFieldOptions.severityLevel.map((option) => option.name),
    [customFieldOptions.severityLevel]
  )
  const departmentOptions = React.useMemo(() => {
    const values = customFieldOptions.departmentRequest.map((option) => option.name)
    if (workspaceDepartment && !values.includes(workspaceDepartment)) {
      values.unshift(workspaceDepartment)
    }
    return values
  }, [customFieldOptions.departmentRequest, workspaceDepartment])
  const completedTotalPages = Math.max(1, Math.ceil(completedTotal / completedPerPage))
  const completedPaginationItems = React.useMemo(
    () => getPaginationItems(completedPage, completedTotalPages),
    [completedPage, completedTotalPages]
  )

  const fetchPending = React.useCallback(async () => {
    if (!sessionUser) {
      return
    }
    setPendingLoading(true)
    try {
      const params = new URLSearchParams({
        section: "pending",
        sort_by: pendingSortBy,
        direction: pendingDirection,
      })
      const response = await fetch(`/api/clickup-task-requests?${params.toString()}`, {
      })
      const payload = (await response.json()) as { requests?: TaskRequest[]; error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load pending requests.")
      }
      setPendingRows(payload.requests ?? [])
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to load pending requests.",
        "error"
      )
    } finally {
      setPendingLoading(false)
    }
  }, [pendingDirection, pendingSortBy, sessionUser, showToast])

  const fetchCompleted = React.useCallback(async () => {
    if (!sessionUser) {
      return
    }
    setCompletedLoading(true)
    try {
      const params = new URLSearchParams({
        section: "completed",
        sort_by: completedSortBy,
        direction: completedDirection,
        scope: completedScope,
        page: String(completedPage),
        per_page: String(completedPerPage),
      })
      const response = await fetch(`/api/clickup-task-requests?${params.toString()}`, {
      })
      const payload = (await response.json()) as {
        requests?: TaskRequest[]
        total?: number
        error?: string
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load completed requests.")
      }
      setCompletedRows(payload.requests ?? [])
      setCompletedTotal(payload.total ?? 0)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to load completed requests.",
        "error"
      )
    } finally {
      setCompletedLoading(false)
    }
  }, [
    completedDirection,
    completedPage,
    completedPerPage,
    completedScope,
    completedSortBy,
    sessionUser,
    showToast,
  ])

  React.useEffect(() => {
    if (!sessionUser) {
      return
    }
    void fetchPending()
  }, [fetchPending, sessionUser])

  React.useEffect(() => {
    if (!sessionUser) {
      return
    }
    void fetchCompleted()
  }, [fetchCompleted, sessionUser])

  React.useEffect(() => {
    if (!sessionUser) {
      return
    }
    const loadCustomFieldOptions = async () => {
      try {
        const response = await fetch("/api/clickup/custom-fields", {
          headers: {
          },
        })
        const payload = (await response.json()) as {
          error?: string
          options?: {
            product?: ClickUpDropdownOption[]
            departmentRequest?: ClickUpDropdownOption[]
            priorityLevel?: ClickUpDropdownOption[]
            severityLevel?: ClickUpDropdownOption[]
          }
        }
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load ClickUp custom field options.")
        }
        setCustomFieldOptions({
          product: payload.options?.product ?? [],
          departmentRequest: payload.options?.departmentRequest ?? [],
          priorityLevel: payload.options?.priorityLevel ?? [],
          severityLevel: payload.options?.severityLevel ?? [],
        })
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : "Unable to load ClickUp custom field options.",
          "error"
        )
      }
    }
    void loadCustomFieldOptions()
  }, [sessionUser, showToast])

  const openCreateModal = () => {
    setEditingRequestId(null)
    setEditingDecision(null)
    setFormState(getDefaultForm(sessionUser))
    setFormError(null)
    setMissingRequiredFields([])
    setFormOpen(true)
  }

  const openEditModal = (request: TaskRequest) => {
    setEditingRequestId(request.id)
    setEditingDecision({
      reason: request.decisionReason,
      byName: request.decisionByName,
      byEmail: request.decisionByEmail,
      at: request.decisionAt,
    })
    setFormState({
      ticketId: request.ticketId ?? "",
      fid: request.fid ?? "",
      oid: request.oid ?? "",
      franchiseName: request.franchiseName ?? "",
      product: request.product,
      departmentRequest: request.departmentRequest,
      outletName: request.outletName,
      msPic: request.msPic,
      priorityLevel: request.priorityLevel,
      severityLevel: request.severityLevel,
      incidentTitle: request.incidentTitle,
      taskDescription: request.taskDescription,
      existingAttachments: [...request.attachments],
      newFiles: [],
    })
    setFormError(null)
    setMissingRequiredFields([])
    setFormOpen(true)
  }

  const openDetail = async (requestId: string) => {
    if (!sessionUser) {
      return
    }
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailData(null)
    try {
      const response = await fetch(`/api/clickup-task-requests/${requestId}`, {
      })
      const payload = (await response.json()) as DetailResponse & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load request details.")
      }
      setDetailData(payload)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to load request details.",
        "error"
      )
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleTicketLookup = async () => {
    if (!sessionUser) {
      return
    }
    const ticketId = formState.ticketId.trim()
    if (!ticketId) {
      setFormError("Enter a ticket id before lookup.")
      return
    }

    setFormError(null)
    setFormTicketLookupLoading(true)
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
      })
      const payload = (await response.json()) as {
        error?: string
        ticket?: {
          fid: string | null
          oid: string | null
          franchiseName: string | null
          outletName: string | null
          msPicName: string | null
        }
      }
      if (!response.ok || !payload.ticket) {
        throw new Error(payload.error ?? "Ticket lookup failed.")
      }

      setFormState((current) => ({
        ...current,
        fid: payload.ticket?.fid ?? current.fid,
        oid: payload.ticket?.oid ?? current.oid,
        franchiseName: payload.ticket?.franchiseName ?? current.franchiseName,
        outletName: payload.ticket?.outletName ?? current.outletName,
        msPic: payload.ticket?.msPicName ?? current.msPic,
      }))
      showToast("Ticket context loaded.", "success")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Ticket lookup failed.")
    } finally {
      setFormTicketLookupLoading(false)
    }
  }

  const handleFormFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    setFormState((current) => {
      const remaining = Math.max(0, 3 - current.existingAttachments.length - current.newFiles.length)
      if (remaining <= 0) {
        return current
      }
      return {
        ...current,
        newFiles: [...current.newFiles, ...selected.slice(0, remaining)],
      }
    })
    event.target.value = ""
  }

  const removeExistingAttachment = (index: number) => {
    setFormState((current) => ({
      ...current,
      existingAttachments: current.existingAttachments.filter((_, idx) => idx !== index),
    }))
  }

  const removeNewFile = (index: number) => {
    setFormState((current) => ({
      ...current,
      newFiles: current.newFiles.filter((_, idx) => idx !== index),
    }))
  }

  const submitForm = async () => {
    if (!sessionUser) {
      return
    }

    const missingFields = getMissingRequiredFields(formState)
    setMissingRequiredFields(missingFields)
    if (missingFields.length > 0) {
      setFormError("Please fill in the highlighted required fields.")
      return
    }

    setFormLoading(true)
    setFormError(null)

    try {
      const uploadedUrls: string[] = []
      for (const file of formState.newFiles) {
        const uploaded = await uploadFile({
          file,
          userId: sessionUser.id,
          folder: "uploads",
        })
        uploadedUrls.push(uploaded.url)
      }

      const payload = {
        ticketId: formState.ticketId.trim() || null,
        fid: formState.fid.trim() || null,
        oid: formState.oid.trim() || null,
        franchiseName: formState.franchiseName.trim() || null,
        product: formState.product.trim(),
        departmentRequest: formState.departmentRequest.trim(),
        outletName: formState.outletName.trim(),
        msPic: formState.msPic.trim(),
        priorityLevel: formState.priorityLevel,
        severityLevel: formState.severityLevel,
        incidentTitle: formState.incidentTitle.trim(),
        taskDescription: formState.taskDescription.trim(),
        attachments: [...formState.existingAttachments, ...uploadedUrls].slice(0, 3),
      }

      const isEditing = Boolean(editingRequestId)
      const endpoint = isEditing
        ? `/api/clickup-task-requests/${editingRequestId}/resubmit`
        : "/api/clickup-task-requests"
      const method = isEditing ? "PATCH" : "POST"

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to submit request.")
      }

      showToast(
        isEditing
          ? "Request resubmitted for approval."
          : "Request submitted for approval.",
        "success"
      )
      setFormOpen(false)
      setEditingRequestId(null)
      setEditingDecision(null)
      setFormState(getDefaultForm(sessionUser))
      setMissingRequiredFields([])
      setCompletedPage(1)
      await Promise.all([fetchPending(), fetchCompleted()])
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to submit request."
      )
    } finally {
      setFormLoading(false)
    }
  }

  const openReviewModal = (request: TaskRequest) => {
    setReviewTarget(request)
    setReviewReason("")
    setReviewAction("approve")
    setReviewOpen(true)
  }

  const submitReview = async () => {
    if (!sessionUser || !reviewTarget) {
      return
    }

    setReviewLoading(true)
    try {
      const response = await fetch(
        `/api/clickup-task-requests/${reviewTarget.id}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: reviewAction,
            reason: reviewReason,
          }),
        }
      )
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to submit review decision.")
      }

      showToast("Review decision submitted.", "success")
      setReviewOpen(false)
      setReviewTarget(null)
      setCompletedPage(1)
      await Promise.all([fetchPending(), fetchCompleted()])
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to submit review decision.",
        "error"
      )
    } finally {
      setReviewLoading(false)
    }
  }

  const onCompletedScopeChange = (value: "all" | "mine") => {
    setCompletedScope(value)
    setCompletedPage(1)
  }

  const onCompletedPerPageChange = (value: number) => {
    setCompletedPerPage(value)
    setCompletedPage(1)
  }

  const hasMissingRequiredField = (field: RequiredRequestField) =>
    missingRequiredFields.includes(field) && !formState[field].trim()

  if (!ready) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading ClickUp task workflow...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>ClickUp Task Requests</CardTitle>
            <CardDescription>
              Merchant Success queue for task request submission, review, and tracking.
            </CardDescription>
          </div>
          <Button onClick={openCreateModal}>Create Request</Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-base">Pending Approval</CardTitle>
            <CardDescription>
              Requests waiting for admin action.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={pendingSortBy}
              onValueChange={setPendingSortBy}
            >
              <SelectTrigger className="h-9 w-[180px] text-sm">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                {pendingSortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    Sort: {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={pendingDirection}
              onValueChange={(value) =>
                setPendingDirection(value === "asc" ? "asc" : "desc")
              }
            >
              <SelectTrigger className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Newest first</SelectItem>
                <SelectItem value="asc">Oldest first</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void fetchPending()} disabled={pendingLoading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Request</th>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Priority</th>
                  <th className="px-3 py-2 text-left font-medium">Severity</th>
                  <th className="px-3 py-2 text-left font-medium">Requester</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingLoading ? (
                  <tr>
                    <td className="px-3 py-5 text-center text-sm" colSpan={7}>
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading pending requests...
                      </span>
                    </td>
                  </tr>
                ) : pendingRows.length === 0 ? (
                  <tr>
                    <td className="text-muted-foreground px-3 py-5 text-center text-sm" colSpan={7}>
                      No pending requests.
                    </td>
                  </tr>
                ) : (
                  pendingRows.map((row) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">#{row.id} · {row.incidentTitle}</div>
                        <div className="text-muted-foreground text-xs">
                          Outlet: {row.outletName || "--"}
                        </div>
                      </td>
                      <td className="px-3 py-2">{row.product}</td>
                      <td className="px-3 py-2">{row.priorityLevel}</td>
                      <td className="px-3 py-2">{row.severityLevel}</td>
                      <td className="px-3 py-2">
                        {row.createdByName ?? row.createdByEmail ?? "--"}
                      </td>
                      <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => void openDetail(row.id)}>
                            Details
                          </Button>
                          {isAdmin ? (
                            <Button size="sm" onClick={() => openReviewModal(row)}>
                              Review
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-base">Approved & Rejected</CardTitle>
            <CardDescription>
              Decision history with ClickUp linkage and status outcome.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              value={completedScope}
              onValueChange={(value) =>
                onCompletedScopeChange(value === "mine" ? "mine" : "all")
              }
            >
              <SelectTrigger className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All requests</SelectItem>
                <SelectItem value="mine">My requests</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={completedSortBy}
              onValueChange={setCompletedSortBy}
            >
              <SelectTrigger className="h-9 w-[180px] text-sm">
                <SelectValue placeholder="Sort By" />
              </SelectTrigger>
              <SelectContent>
                {completedSortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    Sort: {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={completedDirection}
              onValueChange={(value) =>
                setCompletedDirection(value === "asc" ? "asc" : "desc")
              }
            >
              <SelectTrigger className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Newest first</SelectItem>
                <SelectItem value="asc">Oldest first</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void fetchCompleted()} disabled={completedLoading}>
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Request</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Priority</th>
                  <th className="px-3 py-2 text-left font-medium">Decision Date</th>
                  <th className="px-3 py-2 text-left font-medium">Decision By</th>
                  <th className="px-3 py-2 text-left font-medium">ClickUp</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {completedLoading ? (
                  <tr>
                    <td className="px-3 py-5 text-center text-sm" colSpan={7}>
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading request history...
                      </span>
                    </td>
                  </tr>
                ) : completedRows.length === 0 ? (
                  <tr>
                    <td className="text-muted-foreground px-3 py-5 text-center text-sm" colSpan={7}>
                      No completed requests found.
                    </td>
                  </tr>
                ) : (
                  completedRows.map((row) => {
                    const canResubmit =
                      row.status === "Rejected" && row.createdByUserId === sessionUser?.id
                    return (
                      <tr key={row.id} className="border-t align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">#{row.id} · {row.incidentTitle}</div>
                          <div className="text-muted-foreground text-xs">
                            {row.product} · {row.outletName}
                          </div>
                        </td>
                        <td className="px-3 py-2">{row.status}</td>
                        <td className="px-3 py-2">{row.priorityLevel}</td>
                        <td className="px-3 py-2">{formatDecisionDate(row.decisionAt)}</td>
                        <td className="px-3 py-2">
                          {row.decisionByName ?? row.decisionByEmail ?? "--"}
                        </td>
                        <td className="px-3 py-2">
                          {row.clickupLink ? (
                            <ExternalLink href={row.clickupLink}>Open task</ExternalLink>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void openDetail(row.id)}
                            >
                              Details
                            </Button>
                            {canResubmit ? (
                              <Button size="sm" onClick={() => openEditModal(row)}>
                                Edit & Resubmit
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {completedTotalPages > 1 ? (
            <div className="flex flex-col gap-3 pt-2">
              <Separator />
              <div className="grid w-full grid-cols-1 gap-3 text-xs text-muted-foreground md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="flex items-center gap-3">
                  <Select
                    value={String(completedPerPage)}
                    onValueChange={(value) => onCompletedPerPageChange(Number(value))}
                  >
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {rowsPerPageOptions.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Pagination className="md:justify-self-center">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={completedPage === 1}
                        tabIndex={completedPage === 1 ? -1 : undefined}
                        className={
                          completedPage === 1
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault()
                          setCompletedPage((current) => Math.max(1, current - 1))
                        }}
                      />
                    </PaginationItem>
                    {completedPaginationItems.map((item, index) => (
                      <PaginationItem key={`${item}-${index}`}>
                        {typeof item !== "number" ? (
                          <PaginationEllipsis />
                        ) : (
                          <PaginationLink
                            href="#"
                            isActive={item === completedPage}
                            onClick={(event) => {
                              event.preventDefault()
                              setCompletedPage(item)
                            }}
                          >
                            {item}
                          </PaginationLink>
                        )}
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={completedPage === completedTotalPages}
                        tabIndex={
                          completedPage === completedTotalPages ? -1 : undefined
                        }
                        className={
                          completedPage === completedTotalPages
                            ? "pointer-events-none opacity-50"
                            : undefined
                        }
                        onClick={(event) => {
                          event.preventDefault()
                          setCompletedPage((current) =>
                            Math.min(completedTotalPages, current + 1)
                          )
                        }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
                <div className="text-right">
                  Showing {completedRows.length} of {completedTotal}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs">
              Showing {completedRows.length} of {completedTotal}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setFormError(null)
            setMissingRequiredFields([])
          }
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRequestId ? "Edit & Resubmit Request" : "Create Task Request"}</DialogTitle>
            <DialogDescription>
              Submit a structured request for admin approval before ClickUp task creation.
            </DialogDescription>
          </DialogHeader>

          {editingRequestId && editingDecision ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">Previous Admin Decision</div>
              <div className="mt-1">
                Rejected by{" "}
                {editingDecision.byName ?? editingDecision.byEmail ?? "Admin"}{" "}
                {editingDecision.at ? `on ${formatDateTime(editingDecision.at)}` : ""}.
              </div>
              <div className="mt-1 whitespace-pre-wrap">
                Reason: {editingDecision.reason ?? "--"}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">Ticket ID (optional)</span>
              <div className="flex gap-2">
                <Input
                  value={formState.ticketId}
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, ticketId: event.target.value }))
                  }
                  placeholder="e.g. 12031"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleTicketLookup()}
                  disabled={formTicketLookupLoading}
                >
                  {formTicketLookupLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Lookup
                    </span>
                  ) : (
                    "Lookup"
                  )}
                </Button>
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Product</span>
              <Select
                value={formState.product}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, product: value }))
                }
              >
                <SelectTrigger
                  aria-invalid={hasMissingRequiredField("product") || undefined}
                  className={cn(
                    hasMissingRequiredField("product") &&
                      "border-destructive ring-destructive/20"
                  )}
                >
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {formState.product && !productOptions.includes(formState.product) ? (
                    <SelectItem value={formState.product}>
                      {formState.product}
                    </SelectItem>
                  ) : null}
                  {productOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Priority</span>
              <Select
                value={formState.priorityLevel || undefined}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, priorityLevel: value }))
                }
              >
                <SelectTrigger
                  aria-invalid={hasMissingRequiredField("priorityLevel") || undefined}
                  className={cn(
                    hasMissingRequiredField("priorityLevel") &&
                      "border-destructive ring-destructive/20"
                  )}
                >
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  {formState.priorityLevel &&
                  !priorityOptions.includes(formState.priorityLevel) ? (
                    <SelectItem value={formState.priorityLevel}>
                      {formState.priorityLevel}
                    </SelectItem>
                  ) : null}
                  {priorityOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Severity</span>
              <Select
                value={formState.severityLevel || undefined}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, severityLevel: value }))
                }
              >
                <SelectTrigger
                  aria-invalid={hasMissingRequiredField("severityLevel") || undefined}
                  className={cn(
                    hasMissingRequiredField("severityLevel") &&
                      "border-destructive ring-destructive/20"
                  )}
                >
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  {formState.severityLevel &&
                  !severityOptions.includes(formState.severityLevel) ? (
                    <SelectItem value={formState.severityLevel}>
                      {formState.severityLevel}
                    </SelectItem>
                  ) : null}
                  {severityOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">FID</span>
              <Input
                value={formState.fid}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, fid: event.target.value }))
                }
                placeholder="Franchise ID"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">OID</span>
              <Input
                value={formState.oid}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, oid: event.target.value }))
                }
                placeholder="Outlet ID"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Franchise</span>
              <Input
                value={formState.franchiseName}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, franchiseName: event.target.value }))
                }
                placeholder="Franchise name"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Outlet</span>
              <Input
                value={formState.outletName}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, outletName: event.target.value }))
                }
                placeholder="Outlet name"
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">Department Request</span>
              <Select
                value={formState.departmentRequest}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, departmentRequest: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {formState.departmentRequest &&
                  !departmentOptions.includes(formState.departmentRequest) ? (
                    <SelectItem value={formState.departmentRequest}>
                      {formState.departmentRequest}
                    </SelectItem>
                  ) : null}
                  {departmentOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-sm font-medium">MS PIC</span>
              <Input
                value={formState.msPic}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, msPic: event.target.value }))
                }
                placeholder="Person in charge"
              />
            </label>
          </div>

          <label className="mt-2 block space-y-1">
            <span className="text-sm font-medium">Incident Title</span>
            <Input
              value={formState.incidentTitle}
              aria-invalid={hasMissingRequiredField("incidentTitle") || undefined}
              onChange={(event) =>
                setFormState((current) => ({ ...current, incidentTitle: event.target.value }))
              }
              placeholder="Short summary for admin review"
            />
          </label>

          <label className="mt-2 block space-y-1">
            <span className="text-sm font-medium">Task Description</span>
            <textarea
              aria-invalid={hasMissingRequiredField("taskDescription") || undefined}
              className={cn(
                "border-input bg-background min-h-28 w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow]",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                hasMissingRequiredField("taskDescription") &&
                  "border-destructive ring-destructive/20"
              )}
              value={formState.taskDescription}
              onChange={(event) =>
                setFormState((current) => ({ ...current, taskDescription: event.target.value }))
              }
              placeholder="Provide details, impact, and expected action"
            />
          </label>

          <div className="mt-2 space-y-2">
            <div className="text-sm font-medium">Attachments (max 3)</div>
            <input type="file" multiple onChange={handleFormFileChange} />
            {formState.existingAttachments.length > 0 ? (
              <div className="space-y-1 text-sm">
                {formState.existingAttachments.map((url, index) => (
                  <div key={`${url}-${index}`} className="flex items-center justify-between gap-2">
                    <ExternalLink href={url}>Existing attachment {index + 1}</ExternalLink>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExistingAttachment(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {formState.newFiles.length > 0 ? (
              <div className="space-y-1 text-sm">
                {formState.newFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeNewFile(index)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {formError ? <div className="text-sm text-rose-600">{formError}</div> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={formLoading}>
              Cancel
            </Button>
            <Button onClick={() => void submitForm()} disabled={formLoading}>
              {formLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : editingRequestId ? (
                "Resubmit Request"
              ) : (
                "Submit Request"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailData?.request ? `Request #${detailData.request.id}` : "Request Details"}
            </DialogTitle>
            <DialogDescription>
              Full request context, attachments, linked ticket data, and review outcome.
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detailData ? (
            <div className="text-muted-foreground py-8 text-sm">Loading details...</div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-medium">{detailData.request.status}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Ticket</div>
                  <div>{detailData.request.ticketId ?? "--"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Product</div>
                  <div>{detailData.request.product}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Department Request</div>
                  <div>{detailData.request.departmentRequest}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Priority / Severity</div>
                  <div>
                    {detailData.request.priorityLevel} / {detailData.request.severityLevel}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">MS PIC</div>
                  <div>{detailData.request.msPic || "--"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">FID / Franchise</div>
                  <div>
                    {detailData.request.fid ?? "--"} / {detailData.request.franchiseName ?? "--"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">OID / Outlet</div>
                  <div>
                    {detailData.request.oid ?? "--"} / {detailData.request.outletName || "--"}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">Incident Title</div>
                <div className="font-medium">{detailData.request.incidentTitle}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Task Description</div>
                <div className="whitespace-pre-wrap">{detailData.request.taskDescription}</div>
              </div>

              <div>
                <div className="text-muted-foreground">Attachments</div>
                {detailData.request.attachments.length === 0 ? (
                  <div>--</div>
                ) : (
                  <div className="space-y-1">
                    {detailData.request.attachments.map((url, index) => (
                      <ExternalLink key={`${url}-${index}`} href={url}>
                        Attachment {index + 1}
                      </ExternalLink>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border p-3">
                <div className="mb-2 font-medium">ClickUp Info</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground">Task ID</div>
                    <div>{detailData.request.clickupTaskId ?? "--"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Task Link</div>
                    <div>
                      {detailData.request.clickupLink ? (
                        <ExternalLink href={detailData.request.clickupLink}>Open task</ExternalLink>
                      ) : (
                        "--"
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="mb-2 font-medium">Admin Decision</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground">Decision At</div>
                    <div>{formatDecisionDate(detailData.request.decisionAt)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Decision By</div>
                    <div>
                      {detailData.request.decisionByName ?? detailData.request.decisionByEmail ?? "--"}
                    </div>
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-muted-foreground">Reason</div>
                  <div className="whitespace-pre-wrap">{detailData.request.decisionReason ?? "--"}</div>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="mb-2 font-medium">Linked Ticket</div>
                {!detailData.ticket ? (
                  <div className="text-muted-foreground">No linked ticket context.</div>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <div className="text-muted-foreground">Ticket ID / Status</div>
                      <div>
                        #{detailData.ticket.id} / {detailData.ticket.status}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Merchant</div>
                      <div>{detailData.ticket.merchantName ?? "--"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Franchise / Outlet</div>
                      <div>
                        {detailData.ticket.franchiseName ?? "--"} / {detailData.ticket.outletName ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">FID / OID</div>
                      <div>
                        {detailData.ticket.fid ?? "--"} / {detailData.ticket.oid ?? "--"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Category</div>
                      <div>
                        {detailData.ticket.category ?? "--"}
                        {detailData.ticket.subcategory1
                          ? ` / ${detailData.ticket.subcategory1}`
                          : ""}
                        {detailData.ticket.subcategory2
                          ? ` / ${detailData.ticket.subcategory2}`
                          : ""}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Ticket ClickUp</div>
                      <div>
                        {detailData.ticket.clickupLink ? (
                          <ExternalLink href={detailData.ticket.clickupLink}>Open ticket task</ExternalLink>
                        ) : (
                          "--"
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review Request</DialogTitle>
            <DialogDescription>
              Approve or reject this request. A reason is required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">Request:</span>{" "}
              {reviewTarget ? `#${reviewTarget.id} · ${reviewTarget.incidentTitle}` : "--"}
            </div>
            <label className="space-y-1">
              <span className="text-sm font-medium">Action</span>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={reviewAction}
                onChange={(event) =>
                  setReviewAction(event.target.value === "reject" ? "reject" : "approve")
                }
              >
                <option value="approve">Approve</option>
                <option value="reject">Reject</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Reason</span>
              <textarea
                className="border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm"
                value={reviewReason}
                onChange={(event) => setReviewReason(event.target.value)}
                placeholder="Provide the review reason"
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={reviewLoading}>
              Cancel
            </Button>
            <Button onClick={() => void submitReview()} disabled={reviewLoading}>
              {reviewLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </span>
              ) : (
                "Submit Decision"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
