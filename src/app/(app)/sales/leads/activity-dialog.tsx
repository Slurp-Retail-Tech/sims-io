"use client"

import * as React from "react"

import { useToast } from "@/components/toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { format } from "date-fns"

import {
  GooglePlacePicker,
  type GooglePlaceLocation,
} from "@/components/google-place-picker"
import { Checkbox } from "@/components/ui/checkbox"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TimeSelect } from "@/components/ui/time-select"
import {
  BUSINESS_HOURS_END_HOUR,
  BUSINESS_HOURS_START_HOUR,
} from "@/lib/business-hours"
import { parseDate } from "@/lib/dates"
import type { MappedDeal } from "@/lib/deals"
import {
  ACTIVITY_TYPES,
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  LOCATION_TYPES,
  MEETING_OUTCOMES,
  type ActivityType,
  type MappedActivity,
} from "@/lib/lead-activities"

const NO_DEAL_VALUE = "__none__"

type ActivityDialogProps = {
  leadId: string
  leadEmail?: string | null
  activity?: MappedActivity | null
  deals: MappedDeal[]
  open: boolean
  onClose: () => void
  onSaved: (activity: MappedActivity) => void
}

// Stored UTC datetime ("YYYY-MM-DD HH:MM:SS.mmm" or ISO) -> the local-wall-clock
// "YYYY-MM-DD" + "HH:MM" the user originally entered (app timezone).
function splitActivityDateTime(value: string | null): { date: string; time: string } {
  if (!value) {
    return { date: "", time: "" }
  }
  const parsed = parseDate(value)
  if (!parsed) {
    return { date: "", time: "" }
  }
  return { date: format(parsed, "yyyy-MM-dd"), time: format(parsed, "HH:mm") }
}

// Local-wall-clock date + time -> UTC ISO string for storage, so it round-trips
// back to the same local time on display (matches the onboarding schedule page).
function toUtcIso(dateValue: string, timeValue: string): string | null {
  const date = new Date(`${dateValue}T${timeValue}`)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}

export function ActivityDialog({
  leadId,
  leadEmail,
  activity,
  deals,
  open,
  onClose,
  onSaved,
}: ActivityDialogProps) {
  const { showToast } = useToast()
  const [activityType, setActivityType] = React.useState<ActivityType>("Note")
  const [activityDate, setActivityDate] = React.useState("")
  const [activityTime, setActivityTime] = React.useState("")
  const [dealId, setDealId] = React.useState<string>(NO_DEAL_VALUE)
  const [remarks, setRemarks] = React.useState("")
  const [callOutcome, setCallOutcome] = React.useState("")
  const [callDirection, setCallDirection] = React.useState("")
  const [meetingOutcome, setMeetingOutcome] = React.useState("")
  const [locationType, setLocationType] = React.useState("")
  const [location, setLocation] = React.useState("")
  const [placeLocation, setPlaceLocation] = React.useState<GooglePlaceLocation | null>(null)
  const [createAppointment, setCreateAppointment] = React.useState(false)
  const [participantEmails, setParticipantEmails] = React.useState("")
  const createAppointmentTouched = React.useRef(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      return
    }
    const { date, time } = splitActivityDateTime(activity?.activityDate ?? null)
    setActivityType(activity?.activityType ?? "Note")
    setActivityDate(date)
    setActivityTime(time)
    setDealId(activity?.dealId ?? NO_DEAL_VALUE)
    setRemarks(activity?.remarks ?? "")
    setCallOutcome(activity?.callOutcome ?? "")
    setCallDirection(activity?.callDirection ?? "")
    setMeetingOutcome(activity?.meetingOutcome ?? "")
    setLocationType(activity?.locationType ?? "")
    setLocation(activity?.location ?? "")
    setPlaceLocation(
      activity?.googlePlaceId
        ? {
            googlePlaceId: activity.googlePlaceId,
            locationName: activity.location ?? "",
            locationAddress: "",
            googleMapsUri: activity.googleMapsUri,
            locationLat: activity.locationLat,
            locationLng: activity.locationLng,
          }
        : null
    )
    setCreateAppointment(false)
    setParticipantEmails(leadEmail ?? "")
    createAppointmentTouched.current = false
    setErrors({})
  }, [open, activity, leadEmail])

  const handleTypeChange = (next: ActivityType) => {
    setActivityType(next)
    // Clear type-specific fields when switching type.
    setCallOutcome("")
    setCallDirection("")
    setMeetingOutcome("")
    setLocationType("")
    setLocation("")
    setPlaceLocation(null)
    setCreateAppointment(false)
    createAppointmentTouched.current = false
  }

  const handleMeetingOutcomeChange = (next: string) => {
    setMeetingOutcome(next)
    // Default the appointment toggle to on for scheduled meetings, but keep
    // any explicit choice the user has already made.
    if (!createAppointmentTouched.current) {
      setCreateAppointment(next === "Scheduled")
    }
  }

  const showDate = activityType !== "Note"
  const showCall = activityType === "Call"
  const showMeeting = activityType === "Meeting"
  const showLocation = showMeeting && locationType === "Onsite"
  // The create-appointment toggle only appears on new Meeting activities;
  // edits flow through the persisted link (salesAppointmentId) instead.
  const showCreateAppointment = showMeeting && !activity
  const showParticipantEmails =
    showCreateAppointment && locationType === "Online" && createAppointment
  const linkedAppointmentId = activity?.salesAppointmentId ?? null
  const linkedAppointmentPending = activity?.salesAppointmentStatus === "Pending"

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    if (showDate) {
      if (!activityDate) {
        nextErrors.activityDate = "Activity date is required."
      }
      if (!activityTime) {
        nextErrors.activityTime = "Activity time is required."
      }
    }
    if (showCall) {
      if (!callOutcome) nextErrors.callOutcome = "Call outcome is required."
      if (!callDirection) nextErrors.callDirection = "Call direction is required."
    }
    if (showMeeting) {
      if (!meetingOutcome) nextErrors.meetingOutcome = "Meeting outcome is required."
      if (!locationType) nextErrors.locationType = "Location type is required."
      if (locationType === "Onsite" && !location.trim()) {
        nextErrors.location = "Location is required for onsite meetings."
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    setSubmitting(true)
    try {
      const url = activity
        ? `/api/leads/${leadId}/activities/${activity.id}`
        : `/api/leads/${leadId}/activities`
      const response = await fetch(url, {
        method: activity ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityType,
          activityDate:
            showDate && activityDate && activityTime
              ? toUtcIso(activityDate, activityTime)
              : null,
          remarks: remarks.trim() || null,
          callOutcome: showCall ? callOutcome : null,
          callDirection: showCall ? callDirection : null,
          meetingOutcome: showMeeting ? meetingOutcome : null,
          locationType: showMeeting ? locationType : null,
          location: showLocation ? location.trim() : null,
          googlePlaceId: showLocation ? (placeLocation?.googlePlaceId ?? null) : null,
          googleMapsUri: showLocation ? (placeLocation?.googleMapsUri ?? null) : null,
          locationLat: showLocation
            ? (placeLocation?.locationLat?.toString() ?? null)
            : null,
          locationLng: showLocation
            ? (placeLocation?.locationLng?.toString() ?? null)
            : null,
          dealId: dealId === NO_DEAL_VALUE ? null : dealId,
          createAppointment: showCreateAppointment ? createAppointment : false,
          participantEmails: showParticipantEmails ? participantEmails : null,
        }),
      })
      const data = (await response.json()) as {
        activity?: MappedActivity
        appointmentId?: string | null
        appointmentError?: string | null
        appointmentUpdated?: boolean
        appointmentCanceled?: boolean
        error?: string
      }
      if (!response.ok || !data.activity) {
        throw new Error(data.error || "Unable to save activity.")
      }
      onSaved(data.activity)
      if (data.appointmentError) {
        showToast(data.appointmentError, "error")
      } else if (data.appointmentId) {
        showToast("Activity logged and sales appointment created.")
      } else if (data.appointmentCanceled) {
        showToast("Activity updated and the linked sales appointment canceled.")
      } else if (data.appointmentUpdated) {
        showToast("Activity updated and the linked sales appointment updated.")
      } else {
        showToast(activity ? "Activity updated." : "Activity logged.")
      }
      onClose()
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to save activity.",
        "error"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{activity ? "Edit activity" : "Log activity"}</DialogTitle>
          <DialogDescription>Record an interaction with this lead.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <Field>
            <FieldLabel>Activity type</FieldLabel>
            <Select
              value={activityType}
              onValueChange={(value) => handleTypeChange(value as ActivityType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {deals.length ? (
            <Field>
              <FieldLabel>Linked deal (optional)</FieldLabel>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEAL_VALUE}>No linked deal</SelectItem>
                  {deals.map((deal) => (
                    <SelectItem key={deal.id} value={deal.id}>
                      {deal.dealName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          {showDate ? (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="activity-date">Activity date</FieldLabel>
                <DateTimePicker
                  id="activity-date"
                  mode="date"
                  value={activityDate}
                  onChange={setActivityDate}
                  placeholder="Select date"
                />
                <FieldError
                  errors={errors.activityDate ? [{ message: errors.activityDate }] : undefined}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="activity-time">Activity time</FieldLabel>
                <TimeSelect
                  id="activity-time"
                  value={activityTime}
                  onChange={setActivityTime}
                  placeholder="Select time"
                  startHour={showMeeting ? BUSINESS_HOURS_START_HOUR : undefined}
                  endHour={showMeeting ? BUSINESS_HOURS_END_HOUR : undefined}
                />
                <FieldError
                  errors={errors.activityTime ? [{ message: errors.activityTime }] : undefined}
                />
              </Field>
            </div>
          ) : null}

          {showCall ? (
            <>
              <Field>
                <FieldLabel>Call outcome</FieldLabel>
                <Select value={callOutcome} onValueChange={setCallOutcome}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_OUTCOMES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError
                  errors={errors.callOutcome ? [{ message: errors.callOutcome }] : undefined}
                />
              </Field>
              <Field>
                <FieldLabel>Call direction</FieldLabel>
                <Select value={callDirection} onValueChange={setCallDirection}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a direction" />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_DIRECTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError
                  errors={errors.callDirection ? [{ message: errors.callDirection }] : undefined}
                />
              </Field>
            </>
          ) : null}

          {showMeeting ? (
            <>
              <Field>
                <FieldLabel>Meeting outcome</FieldLabel>
                <Select value={meetingOutcome} onValueChange={handleMeetingOutcomeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEETING_OUTCOMES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError
                  errors={errors.meetingOutcome ? [{ message: errors.meetingOutcome }] : undefined}
                />
              </Field>
              <Field>
                <FieldLabel>Location type</FieldLabel>
                <Select
                  value={locationType}
                  onValueChange={(value) => {
                    setLocationType(value)
                    if (value !== "Onsite") {
                      setLocation("")
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a location type" />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError
                  errors={errors.locationType ? [{ message: errors.locationType }] : undefined}
                />
              </Field>
              {showLocation ? (
                <Field>
                  <FieldLabel htmlFor="activity-location">Location</FieldLabel>
                  <GooglePlacePicker
                    id="activity-location"
                    value={placeLocation}
                    query={location}
                    onQueryChange={setLocation}
                    onSelect={setPlaceLocation}
                    onClear={() => setPlaceLocation(null)}
                    allowFreeTextWhenDisabled
                  />
                  <FieldError
                    errors={errors.location ? [{ message: errors.location }] : undefined}
                  />
                </Field>
              ) : null}
              {showCreateAppointment ? (
                <div className="flex items-start gap-2">
                  <Checkbox
                    id="activity-create-appointment"
                    checked={createAppointment}
                    onCheckedChange={(checked) => {
                      createAppointmentTouched.current = true
                      setCreateAppointment(checked === true)
                    }}
                  />
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor="activity-create-appointment">
                      Create sales appointment
                    </FieldLabel>
                    <p className="text-muted-foreground text-xs">
                      Adds this meeting to the Sales Appointment page using the
                      lead&apos;s details.
                    </p>
                  </div>
                </div>
              ) : null}
              {showParticipantEmails ? (
                <Field>
                  <FieldLabel htmlFor="activity-participant-emails">
                    Participant emails
                  </FieldLabel>
                  <Input
                    id="activity-participant-emails"
                    value={participantEmails}
                    onChange={(event) => setParticipantEmails(event.target.value)}
                    placeholder="customer@example.com, partner@example.com"
                  />
                  <p className="text-muted-foreground text-xs">
                    Comma-separated. Participants receive the calendar invite
                    with a Google Meet link.
                  </p>
                </Field>
              ) : null}
              {activity && linkedAppointmentId ? (
                <p className="text-muted-foreground text-xs">
                  {linkedAppointmentPending
                    ? `Linked to sales appointment #${linkedAppointmentId}. Saving changes updates the appointment; setting the outcome to Canceled or changing the activity type cancels it.`
                    : `Linked to a ${(activity.salesAppointmentStatus ?? "finalized").toLowerCase()} sales appointment; it will not be changed.`}
                </p>
              ) : null}
            </>
          ) : null}

          <Field>
            <FieldLabel htmlFor="activity-remarks">Remarks</FieldLabel>
            <textarea
              id="activity-remarks"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-24 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Saving..." : activity ? "Save activity" : "Log activity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
