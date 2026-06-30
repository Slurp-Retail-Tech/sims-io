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
import {
  ACTIVITY_TYPES,
  CALL_DIRECTIONS,
  CALL_OUTCOMES,
  LOCATION_TYPES,
  MEETING_OUTCOMES,
  type ActivityType,
  type MappedActivity,
} from "@/lib/lead-activities"

type ActivityDialogProps = {
  leadId: string
  activity?: MappedActivity | null
  open: boolean
  onClose: () => void
  onSaved: (activity: MappedActivity) => void
}

// DB datetime ("YYYY-MM-DD HH:MM:SS.mmm" or ISO) -> picker value "YYYY-MM-DDTHH:MM".
function toPickerDateTime(value: string | null): string {
  if (!value) {
    return ""
  }
  return value.replace(" ", "T").slice(0, 16)
}

export function ActivityDialog({
  leadId,
  activity,
  open,
  onClose,
  onSaved,
}: ActivityDialogProps) {
  const { showToast } = useToast()
  const [activityType, setActivityType] = React.useState<ActivityType>("Note")
  const [activityDate, setActivityDate] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [callOutcome, setCallOutcome] = React.useState("")
  const [callDirection, setCallDirection] = React.useState("")
  const [meetingOutcome, setMeetingOutcome] = React.useState("")
  const [locationType, setLocationType] = React.useState("")
  const [location, setLocation] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      return
    }
    setActivityType(activity?.activityType ?? "Note")
    setActivityDate(toPickerDateTime(activity?.activityDate ?? null))
    setRemarks(activity?.remarks ?? "")
    setCallOutcome(activity?.callOutcome ?? "")
    setCallDirection(activity?.callDirection ?? "")
    setMeetingOutcome(activity?.meetingOutcome ?? "")
    setLocationType(activity?.locationType ?? "")
    setLocation(activity?.location ?? "")
    setErrors({})
  }, [open, activity])

  const handleTypeChange = (next: ActivityType) => {
    setActivityType(next)
    // Clear type-specific fields when switching type.
    setCallOutcome("")
    setCallDirection("")
    setMeetingOutcome("")
    setLocationType("")
    setLocation("")
  }

  const showDate = activityType !== "Note"
  const showCall = activityType === "Call"
  const showMeeting = activityType === "Meeting"
  const showLocation = showMeeting && locationType === "Onsite"

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {}
    if (showDate && !activityDate) {
      nextErrors.activityDate = "Activity date is required."
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
          activityDate: showDate && activityDate ? activityDate : null,
          remarks: remarks.trim() || null,
          callOutcome: showCall ? callOutcome : null,
          callDirection: showCall ? callDirection : null,
          meetingOutcome: showMeeting ? meetingOutcome : null,
          locationType: showMeeting ? locationType : null,
          location: showLocation ? location.trim() : null,
        }),
      })
      const data = (await response.json()) as {
        activity?: MappedActivity
        error?: string
      }
      if (!response.ok || !data.activity) {
        throw new Error(data.error || "Unable to save activity.")
      }
      onSaved(data.activity)
      showToast(activity ? "Activity updated." : "Activity logged.")
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

          {showDate ? (
            <Field>
              <FieldLabel htmlFor="activity-date">Activity date</FieldLabel>
              <DateTimePicker
                id="activity-date"
                mode="datetime"
                value={activityDate}
                onChange={setActivityDate}
                placeholder="Select date and time"
              />
              <FieldError
                errors={errors.activityDate ? [{ message: errors.activityDate }] : undefined}
              />
            </Field>
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
                <Select value={meetingOutcome} onValueChange={setMeetingOutcome}>
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
                  <Input
                    id="activity-location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                  />
                  <FieldError
                    errors={errors.location ? [{ message: errors.location }] : undefined}
                  />
                </Field>
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
