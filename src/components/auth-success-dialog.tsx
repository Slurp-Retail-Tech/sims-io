"use client"

import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type AuthSuccessDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AuthSuccessDialog({
  open,
  onOpenChange,
}: AuthSuccessDialogProps) {
  const router = useRouter()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your account is active. You can sign in now.</DialogTitle>
          <DialogDescription>
            Continue to the login page and sign in with your email and password.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button className="w-full sm:w-auto" onClick={() => router.push("/login")}>
            Login now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
