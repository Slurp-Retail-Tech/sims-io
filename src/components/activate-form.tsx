"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"

import { AuthSuccessDialog } from "@/components/auth-success-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ActivateFormProps = {
  token: string
}

export function ActivateForm({ token }: ActivateFormProps) {
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [successOpen, setSuccessOpen] = React.useState(false)
  const passwordError =
    password.length > 0 && password.length < 6
      ? "Password must be at least 6 characters."
      : null
  const confirmPasswordError =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Passwords must match."
      : null

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      setMessage("This activation link is missing or invalid.")
      return
    }
    if (!password) {
      setMessage("Password is required.")
      return
    }
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.")
      return
    }
    if (!confirmPassword) {
      setMessage("Please confirm your password.")
      return
    }
    if (password !== confirmPassword) {
      setMessage("Passwords must match.")
      return
    }

    setSubmitting(true)
    setMessage(null)

    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setMessage(data.error ?? "Unable to activate account.")
        return
      }
      setSuccessOpen(true)
    } catch (error) {
      console.error(error)
      setMessage("Unable to activate account.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Activate your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="activation-password">New password</Label>
              <div className="relative">
                <Input
                  id="activation-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setMessage(null)
                  }}
                  aria-invalid={passwordError ? true : undefined}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  <span className="sr-only">
                    {showPassword ? "Hide" : "Show"} password
                  </span>
                </Button>
              </div>
              <p
                className={
                  passwordError
                    ? "text-xs text-destructive"
                    : "text-muted-foreground text-xs"
                }
              >
                {passwordError ?? "Minimum 6 characters."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="activation-confirm">Confirm password</Label>
              <div className="relative">
                <Input
                  id="activation-confirm"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    setMessage(null)
                  }}
                  aria-invalid={confirmPasswordError ? true : undefined}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  <span className="sr-only">
                    {showConfirmPassword ? "Hide" : "Show"} password
                  </span>
                </Button>
              </div>
              {confirmPasswordError ? (
                <p className="text-xs text-destructive">{confirmPasswordError}</p>
              ) : null}
            </div>
            {message ? <div className="text-sm text-destructive">{message}</div> : null}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Activating..." : "Activate account"}
            </Button>
            <div className="text-muted-foreground text-center text-xs">
              Already activated? <Link href="/login" className="underline underline-offset-4">Go to login</Link>
            </div>
          </form>
        </CardContent>
      </Card>
      <AuthSuccessDialog open={successOpen} onOpenChange={setSuccessOpen} />
    </div>
  )
}
