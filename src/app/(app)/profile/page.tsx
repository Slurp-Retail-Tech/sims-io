"use client"

import * as React from "react"
import { BadgeCheck, Camera } from "lucide-react"

import { getSessionState, setSessionUser } from "@/lib/session"
import { uploadFile } from "@/lib/upload-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/toast-provider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ProfileUser = {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
  department: string
  role: string
}

const MAX_AVATAR_SIZE = 2 * 1024 * 1024

export default function ProfilePage() {
  const [open, setOpen] = React.useState(false)
  const [showPasswords, setShowPasswords] = React.useState(false)
  const [profile, setProfile] = React.useState<ProfileUser | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const { showToast } = useToast()

  const [name, setName] = React.useState("")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null)
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)

  const sessionState = React.useMemo(() => getSessionState(), [])

  const loadProfile = React.useCallback(async () => {
    if (!sessionState?.user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await fetch("/api/profile")
      if (!response.ok) {
        showToast("Unable to load profile.", "error")
        return
      }
      const data = (await response.json()) as { user: ProfileUser }
      setProfile(data.user)
      setName(data.user.name)
      setAvatarPreview(data.user.avatarUrl ?? null)
    } catch (error) {
      console.error(error)
      showToast("Unable to load profile.", "error")
    } finally {
      setLoading(false)
    }
  }, [sessionState?.user?.id, showToast])

  React.useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      setAvatarPreview(profile?.avatarUrl ?? null)
      setAvatarFile(null)
      return
    }
    if (file.size > MAX_AVATAR_SIZE) {
      showToast("Profile photo must be under 2MB.", "error")
      return
    }
    setAvatarFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarPreview(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const resetForm = () => {
    setName(profile?.name ?? "")
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setAvatarPreview(profile?.avatarUrl ?? null)
    setAvatarFile(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      resetForm()
    }
  }

  const handleSave = async () => {
    if (!profile || !sessionState?.user?.id) {
      return
    }
    if (!name.trim()) {
      showToast("Name is required.", "error")
      return
    }
    if (newPassword) {
      if (!currentPassword) {
        showToast("Current password is required.", "error")
        return
      }
      if (newPassword !== confirmPassword) {
        showToast("New passwords do not match.", "error")
        return
      }
    }

    setIsSaving(true)
    try {
      let avatarUrl = profile.avatarUrl ?? null
      if (avatarFile) {
        const data = await uploadFile({
          file: avatarFile,
          folder: "avatars",
        })
        avatarUrl = data.url
      }

      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
          avatarUrl,
        }),
      })

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        showToast(data.error ?? "Unable to update profile.", "error")
        return
      }

      const updated = {
        ...sessionState.user,
        name: name.trim(),
        avatarUrl,
      }
      setSessionUser(updated, sessionState.remember)
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              name: updated.name,
              avatarUrl: updated.avatarUrl,
            }
          : prev
      )
      setAvatarPreview(updated.avatarUrl ?? null)
      setAvatarFile(null)
      showToast("Profile updated.")
      setOpen(false)
    } catch (error) {
      console.error(error)
      showToast("Unable to update profile.", "error")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground text-sm">
          Manage your account details and role.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {loading ? (
            <div className="text-muted-foreground">Loading profile...</div>
          ) : null}
          {!loading && !profile ? (
            <div className="text-muted-foreground">No profile loaded.</div>
          ) : null}
          {profile ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Name</span>
                <span>{profile.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{profile.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Role</span>
                <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  <BadgeCheck className="size-3" />
                  {profile.role}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Workspace</span>
                <span>{profile.department}</span>
              </div>
              <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogTrigger asChild>
                  <Button size="sm">Update profile</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Update profile</DialogTitle>
                    <DialogDescription>
                      Change your name, password, or profile photo.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="profile-name">Name</Label>
                      <Input
                        id="profile-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="profile-current-password">
                        Current password
                      </Label>
                      <div className="relative">
                        <Input
                          id="profile-current-password"
                          type={showPasswords ? "text" : "password"}
                          value={currentPassword}
                          onChange={(event) =>
                            setCurrentPassword(event.target.value)
                          }
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords((value) => !value)}
                          className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                        >
                          {showPasswords ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="profile-password">New password</Label>
                      <Input
                        id="profile-password"
                        type={showPasswords ? "text" : "password"}
                        value={newPassword}
                        onChange={(event) =>
                          setNewPassword(event.target.value)
                        }
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="profile-password-confirm">
                        Confirm password
                      </Label>
                      <Input
                        id="profile-password-confirm"
                        type={showPasswords ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="profile-photo">Profile photo</Label>
                      <div className="flex items-center gap-3">
                        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center overflow-hidden rounded-lg">
                          {avatarPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={avatarPreview}
                              alt="Profile preview"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Camera className="size-4" />
                          )}
                        </div>
                        <Input
                          id="profile-photo"
                          type="file"
                          accept="image/*"
                          onChange={handleFileChange}
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? "Saving..." : "Save changes"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
