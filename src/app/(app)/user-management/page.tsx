"use client"

import * as React from "react"
import {
  ChevronDown,
  Eye,
  EyeOff,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { getSessionUser } from "@/lib/session"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/toast-provider"

const departments = [
  "Merchant Success",
  "Sales & Marketing",
  "Renewal & Retention",
  "Product & Engineering",
  "General Operation",
] as const
const roles = ["Super Admin", "Admin", "User"] as const

type PageAccessOption = { label: string; value: string }
type PageAccessGroup = { label: string; options: PageAccessOption[] }

const pageAccessGroups: PageAccessGroup[] = [
  {
    label: "Merchant Success",
    options: [
      { label: "Overview", value: "/merchant-success" },
      { label: "Tickets", value: "/tickets" },
      { label: "Ticket Categories", value: "/ticket-categories" },
      { label: "Analytics", value: "/analytics" },
      { label: "Onboarding Schedule", value: "/onboarding-appointments" },
      { label: "SLA Breaches", value: "/sla-breaches" },
    ],
  },
  {
    label: "Sales & Marketing",
    options: [{ label: "Sales Workspace", value: "/sales" }],
  },
  {
    label: "Renewal & Retention",
    options: [
      { label: "Renewal Workspace", value: "/renewal-retention" },
      { label: "Renewals", value: "/renewals" },
    ],
  },
  {
    label: "Product & Engineering",
    options: [
      { label: "Merchants", value: "/merchants" },
      { label: "Knowledge Base", value: "/knowledge-base" },
    ],
  },
  {
    label: "General Operation",
    options: [
      { label: "Dashboard", value: "/dashboard" },
      { label: "Users", value: "/users" },
      { label: "User Management", value: "/user-management" },
      { label: "Settings", value: "/settings" },
      { label: "Preferences", value: "/preferences" },
      { label: "Profile", value: "/profile" },
    ],
  },
]

const pageAccessOptions = pageAccessGroups.flatMap((group) => group.options)

type Department = (typeof departments)[number]
type Role = (typeof roles)[number]
type UserStatus = "active" | "inactive"

type User = {
  id: string
  name: string
  email: string
  department: Department
  role: Role
  status: UserStatus
  pageAccess: string[]
}

type UserForm = {
  name: string
  email: string
  department: Department
  role: Role
  password: string
  pageAccess: string[]
}

type EditForm = UserForm & { status: UserStatus }

type SessionUser = {
  name: string
  email: string
  role: Role
  department: Department
  id?: string
  pageAccess?: string[]
}

const roleDescriptions: Record<Role, string> = {
  "Super Admin": "Full access across all pages.",
  Admin: "Admin access across assigned pages.",
  User: "Non-admin access for assigned pages.",
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function UserManagementPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] =
    React.useState<SessionUser | null>(null)
  const [users, setUsers] = React.useState<User[]>([])
  const [loading, setLoading] = React.useState(true)
  const [showInactive, setShowInactive] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [showCreatePassword, setShowCreatePassword] = React.useState(false)
  const [showEditPassword, setShowEditPassword] = React.useState(false)
  const [editingUserId, setEditingUserId] = React.useState<string | null>(null)
  const [createForm, setCreateForm] = React.useState<UserForm>({
    name: "",
    email: "",
    department: departments[0],
    role: "User",
    password: "",
    pageAccess: [],
  })
  const [editForm, setEditForm] = React.useState<EditForm | null>(null)
  const { showToast } = useToast()

  const canCreateAllDepartments = currentUser?.role === "Super Admin"
  const canCreateSuperAdmin = currentUser?.role === "Super Admin"
  const canCreate = currentUser ? currentUser.role !== "User" : false
  const roleOptions = canCreateSuperAdmin
    ? roles
    : roles.filter((role) => role !== "Super Admin")

  const defaultForm = React.useMemo(
    () => ({
      name: "",
      email: "",
      department: currentUser?.department ?? departments[0],
      role: "User" as Role,
      password: "",
      pageAccess: currentUser?.pageAccess ?? [],
    }),
    [currentUser?.department, currentUser?.pageAccess]
  )

  const authHeaders = React.useMemo(() => {
    if (!currentUser) {
      return null
    }
    return {
      "x-user-id": currentUser.id ?? "",
      "x-user-role": currentUser.role,
      "x-user-department": currentUser.department,
    }
  }, [currentUser])

  React.useEffect(() => {
    const stored = getSessionUser()
    if (stored) {
      const parsedRole = stored.role as Role
      const parsedDepartment = stored.department as Department
      if (
        parsedRole &&
        parsedDepartment &&
        roles.includes(parsedRole) &&
        departments.includes(parsedDepartment)
      ) {
        setCurrentUser({
          name: stored.name,
          email: stored.email,
          role: parsedRole,
          department: parsedDepartment,
          id: stored.id,
          pageAccess: stored.pageAccess,
        })
      }
    }

  }, [])

  const loadUsers = React.useCallback(async () => {
    if (!authHeaders) {
      setUsers([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/users?includeInactive=true", {
        headers: authHeaders,
      })
      if (!response.ok) {
        showToast("Unable to load users.", "error")
        return
      }
      const data = (await response.json()) as { users: User[] }
      setUsers(data.users ?? [])
    } catch (error) {
      console.error(error)
      showToast("Unable to load users.", "error")
    } finally {
      setLoading(false)
    }
  }, [authHeaders, showToast])

  React.useEffect(() => {
    if (!currentUser) {
      setUsers([])
      setLoading(false)
      return
    }
    if (currentUser.role === "User") {
      const fallback = currentUser.pageAccess?.[0] ?? "/login"
      router.replace(fallback)
      return
    }
    void loadUsers()
  }, [currentUser, loadUsers, router])

  const activeCount = users.filter((user) => user.status === "active").length
  const inactiveCount = users.length - activeCount
  const visibleUsers = showInactive
    ? users
    : users.filter((user) => user.status === "active")

  const canManageUser = (user: User) =>
    currentUser?.role === "Super Admin" ||
    (currentUser?.role === "Admin" && user.role !== "Super Admin")

  const togglePageAccess = (
    value: string,
    updater: React.Dispatch<React.SetStateAction<UserForm>>
  ) => {
    updater((prev) => {
      const exists = prev.pageAccess.includes(value)
      const pageAccess = exists
        ? prev.pageAccess.filter((item) => item !== value)
        : [...prev.pageAccess, value]
      return { ...prev, pageAccess }
    })
  }

  const togglePageAccessEdit = (
    value: string,
    updater: React.Dispatch<React.SetStateAction<EditForm | null>>
  ) => {
    updater((prev) => {
      if (!prev) {
        return prev
      }
      const exists = prev.pageAccess.includes(value)
      const pageAccess = exists
        ? prev.pageAccess.filter((item) => item !== value)
        : [...prev.pageAccess, value]
      return { ...prev, pageAccess }
    })
  }

  const toggleGroupAccess = (
    values: string[],
    updater: React.Dispatch<React.SetStateAction<UserForm>>
  ) => {
    updater((prev) => {
      const allSelected = values.every((value) => prev.pageAccess.includes(value))
      const pageAccess = allSelected
        ? prev.pageAccess.filter((item) => !values.includes(item))
        : Array.from(new Set([...prev.pageAccess, ...values]))
      return { ...prev, pageAccess }
    })
  }

  const toggleGroupAccessEdit = (
    values: string[],
    updater: React.Dispatch<React.SetStateAction<EditForm | null>>
  ) => {
    updater((prev) => {
      if (!prev) {
        return prev
      }
      const allSelected = values.every((value) => prev.pageAccess.includes(value))
      const pageAccess = allSelected
        ? prev.pageAccess.filter((item) => !values.includes(item))
        : Array.from(new Set([...prev.pageAccess, ...values]))
      return { ...prev, pageAccess }
    })
  }

  const openCreateDialog = () => {
    setCreateForm(defaultForm)
    setShowCreatePassword(false)
    setCreateOpen(true)
  }

  const closeCreateDialog = () => {
    setCreateOpen(false)
  }

  const openEditDialog = (user: User) => {
    setEditingUserId(user.id)
    setEditForm({
      name: user.name,
      email: user.email,
      department: user.department,
      role: user.role,
      password: "",
      status: user.status,
      pageAccess: user.pageAccess ?? [],
    })
    setShowEditPassword(false)
  }

  const closeEditDialog = () => {
    setEditingUserId(null)
    setEditForm(null)
  }

  const validateCreateForm = () => {
    if (!createForm.name.trim()) {
      showToast("Name is required.", "error")
      return false
    }
    if (!emailPattern.test(createForm.email)) {
      showToast("Enter a valid email address.", "error")
      return false
    }
    if (!createForm.password.trim()) {
      showToast("Initial password is required.", "error")
      return false
    }
    if (createForm.role !== "Super Admin" && createForm.pageAccess.length === 0) {
      showToast("Select at least one page for access.", "error")
      return false
    }
    return true
  }

  const validateEditForm = () => {
    if (!editForm) {
      return false
    }
    if (!editForm.name.trim()) {
      showToast("Name is required.", "error")
      return false
    }
    if (!emailPattern.test(editForm.email)) {
      showToast("Enter a valid email address.", "error")
      return false
    }
    if (editForm.role !== "Super Admin" && editForm.pageAccess.length === 0) {
      showToast("Select at least one page for access.", "error")
      return false
    }
    return true
  }

  const handleCreateSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    if (!canCreate) {
      showToast("You do not have permission to create users.", "error")
      return
    }
    if (!validateCreateForm()) {
      return
    }
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...createForm,
          pageAccess: createForm.role === "Super Admin" ? pageAccessOptions.map((item) => item.value) : createForm.pageAccess,
        }),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        showToast(data?.error ?? "Unable to create user.", "error")
        return
      }
      showToast("User created.")
      closeCreateDialog()
      await loadUsers()
    } catch (error) {
      console.error(error)
      showToast("Unable to create user.", "error")
    }
  }

  const handleEditSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    if (!editingUserId || !editForm) {
      return
    }
    if (!validateEditForm()) {
      return
    }

    const payload: Partial<EditForm> = {
      name: editForm.name.trim(),
      email: editForm.email.trim(),
      department: editForm.department,
      role: editForm.role,
      status: editForm.status,
      pageAccess:
        editForm.role === "Super Admin"
          ? pageAccessOptions.map((item) => item.value)
          : editForm.pageAccess,
    }
    if (editForm.password.trim()) {
      payload.password = editForm.password
    }

    try {
      const response = await fetch(`/api/users/${editingUserId}`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        showToast(data?.error ?? "Unable to update user.", "error")
        return
      }
      showToast("User updated.")
      closeEditDialog()
      await loadUsers()
    } catch (error) {
      console.error(error)
      showToast("Unable to update user.", "error")
    }
  }

  const toggleEditStatus = () => {
    setEditForm((prev) =>
      prev
        ? { ...prev, status: prev.status === "active" ? "inactive" : "active" }
        : prev
    )
  }

  const isEditingSelf =
    Boolean(
      currentUser &&
        editingUserId &&
        currentUser.id &&
        editingUserId === currentUser.id
    ) ||
    Boolean(currentUser && editForm && editForm.email === currentUser.email)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            User Management
          </h1>
          <p className="text-muted-foreground text-sm">
            Control access by page, role, and status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInactive((prev) => !prev)}
            disabled={!currentUser || currentUser.role === "User"}
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={openCreateDialog}
            disabled={!canCreate}
            title={
              canCreate ? "Create user" : "You do not have permission to create"
            }
          >
            <UserPlus className="size-4" />
            Create user
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Users</CardTitle>
          <span className="text-muted-foreground text-xs">
            {activeCount} active
            {inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          {!currentUser ? (
            <div className="rounded-lg border px-4 py-6 text-sm">
              <div className="font-medium">Sign in required</div>
              <p className="text-muted-foreground mt-1">
                Please log in to view and manage users.
              </p>
              <Button asChild size="sm" className="mt-4">
                <a href="/login">Go to login</a>
              </Button>
            </div>
          ) : null}
          {currentUser && currentUser.role !== "User" && loading ? (
            <div className="text-muted-foreground text-sm">
              Loading users...
            </div>
          ) : null}
          {currentUser &&
          currentUser.role !== "User" &&
          !loading &&
          visibleUsers.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              No users to show.
            </div>
          ) : null}
          {currentUser && currentUser.role !== "User"
            ? visibleUsers.map((user, index) => {
                const canManage = canManageUser(user)
                const pageLabels = user.pageAccess
                  .map(
                    (value) =>
                      pageAccessOptions.find((item) => item.value === value)
                        ?.label ?? value
                  )
                  .sort()
                return (
                  <div key={user.id} className="space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold">{user.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {user.email}
                        </div>
                        {pageLabels.length ? (
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {pageLabels.slice(0, 4).map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-border px-2 py-0.5 text-muted-foreground"
                              >
                                {label}
                              </span>
                            ))}
                            {pageLabels.length > 4 ? (
                              <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                                +{pageLabels.length - 4} more
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="text-muted-foreground mt-2 text-xs">
                            No page access assigned.
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                          {user.department}
                        </span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          {user.role}
                        </span>
                        <span
                          className={
                            user.status === "active"
                              ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-300"
                              : "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                          }
                        >
                          {user.status === "active" ? "Active" : "Inactive"}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!canManage}
                          onClick={() => openEditDialog(user)}
                          title={
                            canManage
                              ? "Edit user"
                              : "Admins can only manage their workspace"
                          }
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                    {index < visibleUsers.length - 1 ? <Separator /> : null}
                  </div>
                )
              })
            : null}
          {currentUser && currentUser.role !== "User" ? (
            <div className="rounded-lg border px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-primary size-4" />
                Admins manage users by page access. Super Admins manage all.
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a team member with workspace access and an initial password.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create-name">Name</Label>
                <Input
                  id="create-name"
                  value={createForm.name}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      email: event.target.value,
                    }))
                  }
                  placeholder="name@company.com"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create-department">Workspace</Label>
                <Select
                  value={createForm.department}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      department: value as Department,
                    }))
                  }
                  disabled={!canCreateAllDepartments}
                >
                  <SelectTrigger id="create-department">
                    <SelectValue placeholder="Select workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((department) => (
                      <SelectItem key={department} value={department}>
                        {department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Workspace is used for reporting only.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-role">Role</Label>
                <Select
                  value={createForm.role}
                  onValueChange={(value) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      role: value as Role,
                      pageAccess:
                        value === "Super Admin"
                          ? pageAccessOptions.map((item) => item.value)
                          : prev.pageAccess,
                    }))
                  }
                >
                  <SelectTrigger id="create-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  {roleDescriptions[createForm.role]}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold tracking-wide text-muted-foreground">
                  Page Access
                </Label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Select All Groups
                  <input
                    type="checkbox"
                    checked={
                      createForm.role === "Super Admin"
                        ? true
                        : pageAccessOptions.every((option) =>
                            createForm.pageAccess.includes(option.value)
                          )
                    }
                    ref={(node) => {
                      if (node && createForm.role !== "Super Admin") {
                        const allSelected = pageAccessOptions.every((option) =>
                          createForm.pageAccess.includes(option.value)
                        )
                        const someSelected =
                          !allSelected &&
                          pageAccessOptions.some((option) =>
                            createForm.pageAccess.includes(option.value)
                          )
                        node.indeterminate = someSelected
                      }
                    }}
                    disabled={createForm.role === "Super Admin"}
                    onChange={() =>
                      toggleGroupAccess(
                        pageAccessOptions.map((option) => option.value),
                        setCreateForm
                      )
                    }
                    className="h-4 w-4 rounded-full border border-input"
                  />
                </label>
              </div>
              <div className="space-y-3">
                {pageAccessGroups.map((group) => {
                  const values = group.options.map((option) => option.value)
                  const isDisabled = createForm.role === "Super Admin"
                  const isAllSelected = values.every((value) =>
                    createForm.pageAccess.includes(value)
                  )
                  const isSomeSelected =
                    !isAllSelected &&
                    values.some((value) => createForm.pageAccess.includes(value))
                  return (
                    <details key={group.label} className="group rounded-lg border">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-semibold">
                        <span className="flex items-center gap-2">
                          <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
                          {group.label}
                        </span>
                        <label
                          className={[
                            "flex items-center gap-2 text-xs text-muted-foreground",
                            isDisabled ? "opacity-60" : "",
                          ].join(" ")}
                          onClick={(event) => event.stopPropagation()}
                        >
                          Select all
                          <input
                            type="checkbox"
                            checked={isDisabled ? true : isAllSelected}
                            ref={(node) => {
                              if (node) {
                                node.indeterminate = isSomeSelected
                              }
                            }}
                            disabled={isDisabled}
                            onChange={() => toggleGroupAccess(values, setCreateForm)}
                            className="h-4 w-4 rounded-full border border-input"
                          />
                        </label>
                      </summary>
                      <div className="grid gap-2 border-t bg-muted/30 px-3 py-3 sm:grid-cols-2">
                        {group.options.map((option) => {
                          const isSelected = createForm.pageAccess.includes(option.value)
                          return (
                            <label
                              key={option.value}
                              className={[
                                "flex items-center gap-2 text-sm",
                                isDisabled ? "text-muted-foreground" : "",
                              ].join(" ")}
                            >
                              <input
                                type="checkbox"
                                checked={isDisabled ? true : isSelected}
                                disabled={isDisabled}
                                onChange={() =>
                                  togglePageAccess(option.value, setCreateForm)
                                }
                                className="h-4 w-4 rounded-full border border-input"
                              />
                              {option.label}
                            </label>
                          )
                        })}
                      </div>
                    </details>
                  )
                })}
              </div>
              <p className="text-muted-foreground text-xs">
                Super Admins automatically receive access to all pages.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">Password</Label>
              <div className="relative">
                <Input
                  id="create-password"
                  type={showCreatePassword ? "text" : "password"}
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Set a temporary password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                  onClick={() => setShowCreatePassword((prev) => !prev)}
                >
                  {showCreatePassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  <span className="sr-only">
                    {showCreatePassword ? "Hide" : "Show"} password
                  </span>
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeCreateDialog}
              >
                Cancel
              </Button>
              <Button type="submit">Create user</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingUserId)} onOpenChange={closeEditDialog}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update user</DialogTitle>
            <DialogDescription>
              Update profile details and set a new password if needed.
            </DialogDescription>
          </DialogHeader>
          {editForm ? (
            <form className="space-y-4" onSubmit={handleEditSubmit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editForm.name}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev
                          ? { ...prev, name: event.target.value }
                          : prev
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editForm.email}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev
                          ? { ...prev, email: event.target.value }
                          : prev
                      )
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-department">Workspace</Label>
                <Select
                  value={editForm.department}
                  onValueChange={(value) =>
                    setEditForm((prev) =>
                      prev ? { ...prev, department: value as Department } : prev
                    )
                  }
                  disabled={!canCreateAllDepartments}
                >
                    <SelectTrigger id="edit-department">
                      <SelectValue placeholder="Select workspace" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((department) => (
                        <SelectItem key={department} value={department}>
                          {department}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Workspace is used for reporting only.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select
                    value={editForm.role}
                    onValueChange={(value) =>
                      setEditForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              role: value as Role,
                              pageAccess:
                                value === "Super Admin"
                                  ? pageAccessOptions.map((item) => item.value)
                                  : prev.pageAccess,
                            }
                          : prev
                      )
                    }
                  >
                    <SelectTrigger id="edit-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {roleDescriptions[editForm.role]}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold tracking-wide text-muted-foreground">
                    Page Access
                  </Label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Select All Groups
                    <input
                      type="checkbox"
                      checked={
                        editForm.role === "Super Admin"
                          ? true
                          : pageAccessOptions.every((option) =>
                              editForm.pageAccess.includes(option.value)
                            )
                      }
                      ref={(node) => {
                        if (node && editForm.role !== "Super Admin") {
                          const allSelected = pageAccessOptions.every((option) =>
                            editForm.pageAccess.includes(option.value)
                          )
                          const someSelected =
                            !allSelected &&
                            pageAccessOptions.some((option) =>
                              editForm.pageAccess.includes(option.value)
                            )
                          node.indeterminate = someSelected
                        }
                      }}
                      disabled={editForm.role === "Super Admin"}
                      onChange={() =>
                        toggleGroupAccessEdit(
                          pageAccessOptions.map((option) => option.value),
                          setEditForm
                        )
                      }
                      className="h-4 w-4 rounded-full border border-input"
                    />
                  </label>
                </div>
                <div className="space-y-3">
                  {pageAccessGroups.map((group) => {
                    const values = group.options.map((option) => option.value)
                    const isDisabled = editForm.role === "Super Admin"
                    const isAllSelected = values.every((value) =>
                      editForm.pageAccess.includes(value)
                    )
                    const isSomeSelected =
                      !isAllSelected &&
                      values.some((value) => editForm.pageAccess.includes(value))
                    return (
                      <details key={group.label} className="group rounded-lg border">
                        <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-semibold">
                          <span className="flex items-center gap-2">
                            <ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" />
                            {group.label}
                          </span>
                          <label
                            className={[
                              "flex items-center gap-2 text-xs text-muted-foreground",
                              isDisabled ? "opacity-60" : "",
                            ].join(" ")}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Select all
                            <input
                              type="checkbox"
                              checked={isDisabled ? true : isAllSelected}
                              ref={(node) => {
                                if (node) {
                                  node.indeterminate = isSomeSelected
                                }
                              }}
                              disabled={isDisabled}
                              onChange={() => toggleGroupAccessEdit(values, setEditForm)}
                              className="h-4 w-4 rounded-full border border-input"
                            />
                          </label>
                        </summary>
                        <div className="grid gap-2 border-t bg-muted/30 px-3 py-3 sm:grid-cols-2">
                          {group.options.map((option) => {
                            const isSelected = editForm.pageAccess.includes(option.value)
                            return (
                              <label
                                key={option.value}
                                className={[
                                  "flex items-center gap-2 text-sm",
                                  isDisabled ? "text-muted-foreground" : "",
                                ].join(" ")}
                              >
                                <input
                                  type="checkbox"
                                  checked={isDisabled ? true : isSelected}
                                  disabled={isDisabled}
                                  onChange={() =>
                                    togglePageAccessEdit(option.value, setEditForm)
                                  }
                                  className="h-4 w-4 rounded-full border border-input"
                                />
                                {option.label}
                              </label>
                            )
                          })}
                        </div>
                      </details>
                    )
                  })}
                </div>
                <p className="text-muted-foreground text-xs">
                  Super Admins automatically receive access to all pages.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="edit-password"
                    type={showEditPassword ? "text" : "password"}
                    value={editForm.password}
                    onChange={(event) =>
                      setEditForm((prev) =>
                        prev
                          ? { ...prev, password: event.target.value }
                          : prev
                      )
                    }
                    placeholder="Leave blank to keep current password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                    onClick={() => setShowEditPassword((prev) => !prev)}
                  >
                    {showEditPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                    <span className="sr-only">
                      {showEditPassword ? "Hide" : "Show"} password
                    </span>
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border px-3 py-3 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">Account status</div>
                    <div className="text-muted-foreground text-xs">
                      Inactive users are hidden from the default list.
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={toggleEditStatus}
                    disabled={isEditingSelf}
                    title={
                      isEditingSelf
                        ? "You cannot deactivate your own account."
                        : "Set user status"
                    }
                  >
                    {editForm.status === "active"
                      ? "Set inactive"
                      : "Activate"}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeEditDialog}
                >
                  Cancel
                </Button>
                <Button type="submit">Save changes</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

    </div>
  )
}
