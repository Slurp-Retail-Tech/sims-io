export const DEFAULT_ONBOARDING_APPOINTMENT_DURATION_MS = 3 * 60 * 60 * 1000

export type OnboardingAppointmentAccessUser = {
  id: string
  role: string
  department: string
}

export type OnboardingAppointmentAccessRecord = {
  created_by_user_id: string
  assigned_ms_user_id?: string | null
}

export type OnboardingAppointmentCancelRecord = OnboardingAppointmentAccessRecord & {
  status: string
}

export function getDefaultScheduledEndAt(start: Date) {
  return new Date(start.getTime() + DEFAULT_ONBOARDING_APPOINTMENT_DURATION_MS)
}

export function validateScheduledRange(start: Date, rawEnd: unknown) {
  if (!(start instanceof Date) || Number.isNaN(start.valueOf())) {
    return { ok: false as const, error: "Invalid start time." }
  }
  if (typeof rawEnd !== "string" || !rawEnd.trim()) {
    return { ok: false as const, error: "End time is required." }
  }

  const end = new Date(rawEnd)
  if (Number.isNaN(end.valueOf())) {
    return { ok: false as const, error: "Invalid end time." }
  }
  if (end <= start) {
    return { ok: false as const, error: "End time must be after the start time." }
  }

  return { ok: true as const, scheduledEndAt: end }
}

export function canEditOnboardingAppointment(
  user: OnboardingAppointmentAccessUser,
  appointment: OnboardingAppointmentAccessRecord
) {
  if (user.role === "Super Admin") {
    return true
  }
  if (
    user.role === "Admin" &&
    (user.department === "Merchant Success" ||
      user.department === "Sales & Marketing")
  ) {
    return true
  }
  if (String(appointment.created_by_user_id) === user.id) {
    return true
  }
  return appointment.assigned_ms_user_id
    ? String(appointment.assigned_ms_user_id) === user.id
    : false
}

export function canCancelOnboardingAppointment(
  user: OnboardingAppointmentAccessUser,
  appointment: OnboardingAppointmentCancelRecord
) {
  if (appointment.status !== "Pending" && appointment.status !== "Approved") {
    return false
  }
  return canEditOnboardingAppointment(user, appointment)
}
