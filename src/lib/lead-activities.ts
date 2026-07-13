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
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: string | null
  locationLng: string | null
  dealId: string | null
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
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
  dealId: string | null
}

function parseCoordinate(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
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
    googlePlaceId: null,
    googleMapsUri: null,
    locationLat: null,
    locationLng: null,
    // The link is optional; the route verifies the deal belongs to this lead.
    dealId: input.dealId ? input.dealId : null,
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
      // Place fields are all-or-nothing keyed on the place id, so a free-text
      // overwrite never leaves stale coordinates behind.
      if (input.googlePlaceId) {
        base.googlePlaceId = input.googlePlaceId
        base.googleMapsUri = input.googleMapsUri
        base.locationLat = parseCoordinate(input.locationLat)
        base.locationLng = parseCoordinate(input.locationLng)
      }
    }
  }

  return { ok: true, values: base }
}

export type ActivityRow = RowDataPacket & {
  id: string
  lead_id: string
  deal_id: string | null
  deal_name: string | null
  sales_appointment_id: string | null
  sales_appointment_status: string | null
  activity_type: ActivityType
  activity_date: string | null
  remarks: string | null
  call_outcome: CallOutcome | null
  call_direction: CallDirection | null
  meeting_outcome: MeetingOutcome | null
  location_type: LocationType | null
  location: string | null
  google_place_id: string | null
  google_maps_uri: string | null
  location_lat: string | null
  location_lng: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string | null
  created_by_name: string | null
}

export const activitySelectSql = `
  SELECT
    lead_activities.id,
    lead_activities.lead_id,
    lead_activities.deal_id,
    deals.deal_name AS deal_name,
    lead_activities.sales_appointment_id,
    linked_appointment.status AS sales_appointment_status,
    lead_activities.activity_type,
    lead_activities.activity_date,
    lead_activities.remarks,
    lead_activities.call_outcome,
    lead_activities.call_direction,
    lead_activities.meeting_outcome,
    lead_activities.location_type,
    lead_activities.location,
    lead_activities.google_place_id,
    lead_activities.google_maps_uri,
    lead_activities.location_lat,
    lead_activities.location_lng,
    lead_activities.created_by_user_id,
    lead_activities.created_at,
    lead_activities.updated_at,
    created_by.name AS created_by_name
  FROM lead_activities
  LEFT JOIN users AS created_by
    ON created_by.id = lead_activities.created_by_user_id
  LEFT JOIN deals
    ON deals.id = lead_activities.deal_id
  LEFT JOIN sales_appointments AS linked_appointment
    ON linked_appointment.id = lead_activities.sales_appointment_id
`

export type MappedActivity = {
  id: string
  leadId: string
  dealId: string | null
  dealName: string | null
  salesAppointmentId: string | null
  salesAppointmentStatus: string | null
  activityType: ActivityType
  activityDate: string | null
  remarks: string | null
  callOutcome: CallOutcome | null
  callDirection: CallDirection | null
  meetingOutcome: MeetingOutcome | null
  locationType: LocationType | null
  location: string | null
  googlePlaceId: string | null
  googleMapsUri: string | null
  locationLat: number | null
  locationLng: number | null
  createdByName: string | null
  createdAt: string
  updatedAt: string | null
}

export function mapActivity(row: ActivityRow): MappedActivity {
  return {
    id: String(row.id),
    leadId: String(row.lead_id),
    dealId: row.deal_id === null ? null : String(row.deal_id),
    dealName: row.deal_name,
    salesAppointmentId:
      row.sales_appointment_id === null ? null : String(row.sales_appointment_id),
    salesAppointmentStatus: row.sales_appointment_status,
    activityType: row.activity_type,
    activityDate: row.activity_date,
    remarks: row.remarks,
    callOutcome: row.call_outcome,
    callDirection: row.call_direction,
    meetingOutcome: row.meeting_outcome,
    locationType: row.location_type,
    location: row.location,
    googlePlaceId: row.google_place_id,
    googleMapsUri: row.google_maps_uri,
    locationLat: parseCoordinate(row.location_lat),
    locationLng: parseCoordinate(row.location_lng),
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
