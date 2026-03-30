"use client"

import * as React from "react"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"

import { AuthSuccessDialog } from "@/components/auth-success-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ResetPasswordFormProps = {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [requesting, setRequesting] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [requestMessage, setRequestMessage] = React.useState<string | null>(null)
  const [successOpen, setSuccessOpen] = React.useState(false)

  const passwordError =
    password.length > 0 && password.length < 6
      ? "Password must be at least 6 characters."
      : null
  const confirmPasswordError =
    confirmPassword.length > 0 && password !== confirmPassword
      ? "Passwords must match."
      : null

  const handleResetSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      setMessage("Open this page from the reset link in your email.")
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
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) {
        setMessage(data.error ?? "Unable to reset password.")
        return
      }
      setSuccessOpen(true)
    } catch (error) {
      console.error(error)
      setMessage("Unable to reset password.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRequesting(true)
    setRequestMessage(null)

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = (await response.json()) as { message?: string }
      setRequestMessage(
        data.message ??
          "If that email is registered, a password reset link has been sent."
      )
      if (!response.ok) {
        setRequestMessage("We could not process that request right now.")
      }
    } catch (error) {
      console.error(error)
      setRequestMessage("We could not process that request right now.")
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{token ? "Reset your password" : "Request a reset link"}</CardTitle>
          <CardDescription>
            {token
              ? "Create a new password for your account to continue."
              : "Enter your work email and we will send you a password reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <form className="space-y-4" onSubmit={handleResetSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="reset-password">New password</Label>
                <div className="relative">
                  <Input
                    id="reset-password"
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
                <Label htmlFor="reset-confirm">Confirm password</Label>
                <div className="relative">
                  <Input
                    id="reset-confirm"
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
                {submitting ? "Resetting..." : "Reset password"}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleRequestSubmit}>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Work email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  required
                />
              </div>
              {requestMessage ? (
                <div className="text-muted-foreground text-sm">{requestMessage}</div>
              ) : null}
              <Button type="submit" disabled={requesting} className="w-full">
                {requesting ? "Sending..." : "Send reset link"}
              </Button>
            </form>
          )}
          <div className="text-muted-foreground mt-4 text-center text-xs">
            <Link href="/login" className="underline underline-offset-4">
              Back to login
            </Link>
          </div>
        </CardContent>
      </Card>
      <AuthSuccessDialog open={successOpen} onOpenChange={setSuccessOpen} />
    </div>
  )
}
