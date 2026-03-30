"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { getSessionUser, setSessionUser } from "@/lib/session"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const noticeMessages: Record<string, string> = {
  account_activated: "Your account is active. You can sign in now.",
  password_reset: "Your password has been reset. Sign in with your new password.",
}

const errorMessages: Record<string, string> = {
  activation_required:
    "Your account is still pending activation. Use the activation email to finish setting your password.",
  sso_unavailable: "Google Workspace sign-in is not configured right now.",
  sso_failed: "Google sign-in could not be completed. Please try again.",
  sso_not_allowed:
    "That Google Workspace account is not allowed for this SIMS workspace.",
  sso_conflict:
    "This Google account cannot be linked to the matching SIMS user.",
  account_inactive: "This account is inactive. Contact an administrator.",
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.64 12.2c0-.64-.06-1.26-.18-1.85H12v3.51h5.4a4.62 4.62 0 0 1-2 3.03v2.52h3.24c1.9-1.74 3-4.32 3-7.21Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.45l-3.24-2.52c-.9.6-2.05.95-3.38.95-2.6 0-4.8-1.76-5.58-4.12H3.08v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.42 13.86A5.99 5.99 0 0 1 6.1 12c0-.64.11-1.25.32-1.86V7.56H3.08A10 10 0 0 0 2 12c0 1.61.38 3.14 1.08 4.44l3.34-2.58Z"
      />
      <path
        fill="#EA4335"
        d="M12 6.02c1.47 0 2.8.5 3.84 1.5l2.88-2.88C16.95 2.99 14.69 2 12 2a10 10 0 0 0-8.92 5.56l3.34 2.58c.78-2.36 2.98-4.12 5.58-4.12Z"
      />
    </svg>
  )
}

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [showPassword, setShowPassword] = React.useState(false)
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [rememberMe, setRememberMe] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()

  const notice = searchParams.get("notice")
  const error = searchParams.get("error")

  React.useEffect(() => {
    const existing = getSessionUser()
    if (existing) {
      router.replace("/overview")
    }
  }, [router])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: rememberMe }),
      })

      const data = (await response.json()) as {
        error?: string
        code?: string
        user?: {
          id: string
          name: string
          email: string
          department: string
          role: string
          avatarUrl?: string | null
          pageAccess?: string[]
        }
      }

      if (!response.ok || !data.user) {
        if (data.code === "activation_required") {
          setErrorMessage(errorMessages.activation_required)
          return
        }
        setErrorMessage(data.error ?? "Login failed.")
        return
      }

      setSessionUser(data.user, rememberMe)
      router.push("/overview")
    } catch (submitError) {
      console.error(submitError)
      setErrorMessage("Login failed.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="bg-card/90 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in to the SIMS workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice && noticeMessages[notice] ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {noticeMessages[notice]}
            </div>
          ) : null}
          {error && errorMessages[error] ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {errorMessages[error]}
            </div>
          ) : null}
          <Button asChild variant="outline" className="w-full">
            <a href="/api/auth/google/start">
              <GoogleLogo />
              Login with Google
            </a>
          </Button>
          <div className="flex items-center gap-3">
            <div className="bg-border h-px flex-1" />
            <div className="text-muted-foreground text-center text-xs">
              Or continue with
            </div>
            <div className="bg-border h-px flex-1" />
          </div>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <button
                    type="button"
                    className="ml-auto text-sm underline-offset-4 hover:underline"
                    onClick={() => router.push("/reset-password")}
                  >
                    Forgot your password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                    <span className="sr-only">
                      {showPassword ? "Hide" : "Show"} password
                    </span>
                  </button>
                </div>
              </Field>
              <Field>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Signing in..." : "Login"}
                </Button>
                <div className="flex items-center justify-center gap-2 text-sm">
                  <input
                    id="remember"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded border border-input"
                  />
                  <label htmlFor="remember" className="text-muted-foreground">
                    Remember me for 30 days
                  </label>
                </div>
                {errorMessage ? (
                  <FieldDescription className="text-destructive text-center">
                    {errorMessage}
                  </FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
