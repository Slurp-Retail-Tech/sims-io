import type { RowDataPacket } from "mysql2/promise"

export const ACTIVITY_TYPES = [
  "Note",
  "Email",
  "Call",
  "Task",
  "Meeting",
  "WhatsApp Message",
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export const CALL_OUTCOMES = [
  "Busy",
  "Connected",
  "Left Live Message",
  "Left Voicemail",
  "No Answer",
  "Wrong Number",
] as const
export type CallOutcome = (typeof CALL_OUTCOMES)[number]

export const CALL_DIRECTIONS = ["Inbound", "Outbound"] as const
export type CallDirection = (typeof CALL_DIRECTIONS)[number]

export const MEETING_OUTCOMES = [
  "Scheduled",
  "Completed",
  "Rescheduled",
  "No Show",
  "Canceled",
] as const
export type MeetingOutcome = (typeof MEETING_OUTCOMES)[number]

export const LOCATION_TYPES = ["Online", "Onsite"] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export function isActivityType(value: string): value is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(value)
}
export function isCallOutcome(value: string): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value)
}
export function isCallDirection(value: string): value is CallDirection {
  return (CALL_DIRECTIONS as readonly string[]).includes(value)
}
export function isMeetingOutcome(value: string): value is MeetingOutcome {
  return (MEETING_OUTCOMES as readonly string[]).includes(value)
}
export function isLocationType(value: string): value is LocationType {
  return (LOCATION_TYPES as readonly string[]).includes(value)
}

export type ActivityInput = {
  activityType: ActivityType
  activityDate: string | null
  remarks: string | null
  callOutcome: string | null
  callDirection: string | null
  meetingOutcome: string | null
  locationType: string | null
  location: string | null
}

export type NormalizedActivity = {
  activityType: ActivityType
  activityDate: string | null
  remarks: string | null
  callOutcome: CallOutcome | null
  callDirection: CallDirection | null
  meetingOutcome: MeetingOutcome | null
  locationType: LocationType | null
  location: string | null
}

/**
 * Validates an activity submission and force-nulls fields that do not apply to
 * the chosen type. Enforces the PRD rules:
 *  - activity_date required for every type except Note
 *  - Call requires call_outcome + call_direction
 *  - Meeting requires meeting_outcome + location_type, and location when Onsite
 */
export function validateActivityInput(
  input: ActivityInput
): { ok: true; values: NormalizedActivity } | { ok: false; error: string } {
  const { activityType } = input

  if (activityType !== "Note" && !input.activityDate) {
    return { ok: false, error: "Activity date is required." }
  }

  const base: NormalizedActivity = {
    activityType,
    activityDate: activityType === "Note" ? null : input.activityDate,
    remarks: input.remarks,
    callOutcome: null,
    callDirection: null,
    meetingOutcome: null,
    locationType: null,
    location: null,
  }

  if (activityType === "Call") {
    if (!input.callOutcome || !isCallOutcome(input.callOutcome)) {
      return { ok: false, error: "Call outcome is required." }
    }
    if (!input.callDirection || !isCallDirection(input.callDirection)) {
      return { ok: false, error: "Call direction is required." }
    }
    base.callOutcome = input.callOutcome
    base.callDirection = input.callDirection
  }

  if (activityType === "Meeting") {
    if (!input.meetingOutcome || !isMeetingOutcome(input.meetingOutcome)) {
      return { ok: false, error: "Meeting outcome is required." }
    }
    if (!input.locationType || !isLocationType(input.locationType)) {
      return { ok: false, error: "Location type is required." }
    }
    base.meetingOutcome = input.meetingOutcome
    base.locationType = input.locationType
    if (input.locationType === "Onsite") {
      if (!input.location) {
        return { ok: false, error: "Location is required for onsite meetings." }
      }
      base.location = input.location
    }
  }

  return { ok: true, values: base }
}

export type ActivityRow = RowDataPacket & {
  id: string
  lead_id: string
  activity_type: ActivityType
  activity_date: string | null
  remarks: string | null
  call_outcome: CallOutcome | null
  call_direction: CallDirection | null
  meeting_outcome: MeetingOutcome | null
  location_type: LocationType | null
  location: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string | null
  created_by_name: string | null
}

export const activitySelectSql = `
  SELECT
    lead_activities.id,
    lead_activities.lead_id,
    lead_activities.activity_type,
    lead_activities.activity_date,
    lead_activities.remarks,
    lead_activities.call_outcome,
    lead_activities.call_direction,
    lead_activities.meeting_outcome,
    lead_activities.location_type,
    lead_activities.location,
    lead_activities.created_by_user_id,
    lead_activities.created_at,
    lead_activities.updated_at,
    created_by.name AS created_by_name
  FROM lead_activities
  LEFT JOIN users AS created_by
    ON created_by.id = lead_activities.created_by_user_id
`

export type MappedActivity = {
  id: string
  leadId: string
  activityType: ActivityType
  activityDate: string | null
  remarks: string | null
  callOutcome: CallOutcome | null
  callDirection: CallDirection | null
  meetingOutcome: MeetingOutcome | null
  locationType: LocationType | null
  location: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string | null
}

export function mapActivity(row: ActivityRow): MappedActivity {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    activityType: row.activity_type,
    activityDate: row.activity_date,
    remarks: row.remarks,
    callOutcome: row.call_outcome,
    callDirection: row.call_direction,
    meetingOutcome: row.meeting_outcome,
    locationType: row.location_type,
    location: row.location,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
