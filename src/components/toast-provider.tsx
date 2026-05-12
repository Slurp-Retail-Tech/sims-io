"use client"

import * as React from "react"

import { ToastPortal } from "@/components/toast-portal"

export type ToastVariant = "success" | "error" | "info"

type Toast = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const toastStyles: Record<ToastVariant, string> = {
  success:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  info: "border-muted bg-background text-foreground",
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const timeoutRefs = React.useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const removeToast = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timeout = timeoutRefs.current.get(id)
    if (timeout) {
      clearTimeout(timeout)
      timeoutRefs.current.delete(id)
    }
  }, [])

  const showToast = React.useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = Date.now() + Math.floor(Math.random() * 1000)
      setToasts((current) => [...current, { id, message, variant }])
      const timeout = setTimeout(() => {
        removeToast(id)
      }, 3200)
      timeoutRefs.current.set(id, timeout)
    },
    [removeToast]
  )

  React.useEffect(() => {
    const timeouts = timeoutRefs.current
    return () => {
      timeouts.forEach((timeout) => clearTimeout(timeout))
      timeouts.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastPortal>
        <div className="fixed bottom-6 right-6 z-[100] flex max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={[
                "rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur",
                toastStyles[toast.variant],
              ].join(" ")}
            >
              {toast.message}
            </div>
          ))}
        </div>
      </ToastPortal>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.")
  }
  return context
}
