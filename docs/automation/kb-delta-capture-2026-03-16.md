# KB Delta Capture - 2026-03-16

## Run context
- Automation ID: `kb-delta-capture`
- Run date: `2026-03-16`
- Scan mode: local workspace state only (no git history/diff)
- Scope scanned:
  - `/Users/hafiz/sims-io/docs/PRD.md`
  - `/Users/hafiz/sims-io/docs/TDD.md`
  - `/Users/hafiz/sims-io/src/app/(app)`
  - `/Users/hafiz/sims-io/src/app/api`
  - `/Users/hafiz/sims-io/src/components`
- Skill flow used: `notion-knowledge-capture` -> `kb-article-standard`

## Notion cross-check status
- `list_mcp_resources` and `list_mcp_resource_templates` returned empty in this session.
- Result: existing Notion KB entries cannot be fetched/updated directly from this run.
- Action: queue exact Notion create/update/archive operations below for execution once Notion MCP is available.

## Existing KB map discovered locally
Sources:
- `/Users/hafiz/sims-io/src/lib/knowledge-base.ts`
- `/Users/hafiz/sims-io/src/app/(app)/knowledge-base/page.tsx`

Known existing articles:
- Published: `Create and Track Tickets`
- Published: `Linking Messages to Merchant Records`
- Queue candidate: `Ticket Statuses Explained` (Approved)
- Queue candidate: `Renewal Reminder Timeline` (Draft)

## Update existing articles
1. `Create and Track Tickets`
- Status target: `Draft` (content refresh)
- Why: Tickets flow now includes history panel, category/subcategory selection, export, CSAT share, and ClickUp actions.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/tickets/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/tickets/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/tickets/export/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/tickets/[ticketId]/clickup/create/route.ts`

2. `Linking Messages to Merchant Records`
- Status target: `Draft` (content refresh)
- Why: Merchant lookup and import flow includes branch grouping, outlet expansion, and expiry labels used by users.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchants/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/merchants/lookup/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/route.ts`

3. `Ticket Statuses Explained`
- Status target: keep `Approved`, refresh metadata
- Why: Status labels are explicitly rendered as `Open`, `In Progress`, `Pending Customer`, `Resolved`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/tickets/page.tsx`

4. `Renewal Reminder Timeline`
- Status target: keep `Draft`, refresh content
- Why: Current Renewal Due route shows expiring outlets with paginated review from renewals API.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/renewal-retention/renewal-due/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/renewals/expiring/route.ts`

## Create draft articles (no matching local KB entry)
Metadata for all drafts:
- Audience: `External User`
- App Version: `v2.0.1`
- Last Verified Date: `2026-03-16`

### Draft 1: Navigate Workspace and Access Assigned Pages
- Category: `Getting Started`
- Owner: `Product Ops`
- Who this is for: Users logging in to reach their assigned work areas.
- Prerequisites: Active account and successful login.
- Steps:
  1. Sign in and open the left navigation.
  2. Select your department section.
  3. Open a page and confirm breadcrumb path in the header.
  4. If a page is hidden, request access from an admin.
- Expected result: User can navigate only pages allowed by role/page access.
- Troubleshooting: Missing page after login -> verify `pageAccess` assignment in User Management.
- Related features: `User Management`, `Profile`, `Preferences`.
- Source refs:
  - `/Users/hafiz/sims-io/src/components/app-sidebar.tsx`
  - `/Users/hafiz/sims-io/src/components/app-header.tsx`
  - `/Users/hafiz/sims-io/src/app/(app)/overview/page.tsx`

### Draft 2: Import Merchants and Review Outlet Status
- Category: `Merchants`
- Owner: `Merchant Success Ops`
- Who this is for: Users maintaining merchant/outlet records.
- Prerequisites: Authenticated account with merchants access.
- Steps:
  1. Open `/merchants`.
  2. Start merchant import and monitor latest run status.
  3. Expand a merchant row to load outlets.
  4. Review outlet badges (`Active`, `Expiring Soon`, `Expired`).
- Expected result: Merchant and outlet records are refreshed and reviewable.
- Troubleshooting: Import fails -> check the run error and retry after validating session/API access.
- Related features: `Renewal Due`, `Merchant Coverage Map`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchants/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/status/route.ts`

### Draft 3: Review Renewal Due Outlets
- Category: `Renewals`
- Owner: `Renewal Ops`
- Who this is for: Renewal users tracking near-term expiries.
- Prerequisites: Access to renewal-retention workspace.
- Steps:
  1. Open `/renewal-retention/renewal-due`.
  2. Set records per page.
  3. Review franchises and outlet due dates.
  4. Use map links where location context is required.
- Expected result: Expiring outlets can be prioritized for outreach.
- Troubleshooting: Empty state -> verify data exists from `/api/renewals/expiring` and user session is valid.
- Related features: `Renewal Retention Overview`, `Merchants`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/renewal-retention/renewal-due/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/renewals/expiring/route.ts`

### Draft 4: Submit CSAT Feedback from a Shared Link
- Category: `CSAT`
- Owner: `Support Ops`
- Who this is for: Merchants submitting post-resolution feedback.
- Prerequisites: Valid CSAT token URL.
- Steps:
  1. Open the CSAT URL.
  2. Select score and optional comments.
  3. Submit before token expiry.
- Expected result: Feedback is saved against the ticket.
- Troubleshooting: Invalid/expired token -> request a new CSAT link from support.
- Related features: `Create and Track Tickets`, `CSAT Insights`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/api/csat/[token]/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/tickets/[ticketId]/csat/share/route.ts`

### Draft 5: Manage Sales Leads and Archived Leads
- Category: `Tickets`
- Owner: `Sales Ops`
- Who this is for: Sales users triaging inbound lead records.
- Prerequisites: Sales workspace access.
- Steps:
  1. Open `/sales/leads`.
  2. Search or filter current leads.
  3. Archive or restore records from lead actions.
  4. Confirm list refresh after actions.
- Expected result: Lead list stays current with active/archived segmentation.
- Troubleshooting: Action error -> refresh session and retry; confirm permissions.
- Related features: `Sales Overview`, `Sales Appointment`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/sales/leads/page.tsx`
  - `/Users/hafiz/sims-io/src/app/(app)/sales/leads/leads-table.tsx`
  - `/Users/hafiz/sims-io/src/app/api/leads/route.ts`

### Draft 6: Manage Sales Appointments
- Category: `Tickets`
- Owner: `Sales Ops`
- Who this is for: Sales users scheduling and tracking appointments.
- Prerequisites: Sales appointment page access.
- Steps:
  1. Open `/sales/appointments`.
  2. Create or edit appointment details.
  3. Mark appointment complete or cancel when needed.
  4. Confirm status update on refresh.
- Expected result: Appointment lifecycle is tracked from scheduled to complete/canceled.
- Troubleshooting: Save fails -> validate required fields and user header in API requests.
- Related features: `Sales Leads`, `Onboarding Schedule`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/sales/appointments/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/sales-appointments/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/sales-appointments/[appointmentId]/complete/route.ts`

### Draft 7: Update Profile Details and Password
- Category: `Profile`
- Owner: `Security Ops`
- Who this is for: Authenticated users updating account profile.
- Prerequisites: Active session and current password for password changes.
- Steps:
  1. Open `/profile`.
  2. Edit name and optional avatar.
  3. Enter current/new password for credential change.
  4. Save and verify updated profile.
- Expected result: Profile and optional password updates are persisted.
- Troubleshooting: Password update blocked -> ensure current password is provided and confirmation matches.
- Related features: `Preferences`, `User Management`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/profile/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/profile/route.ts`

### Draft 8: Admin Manage Users Roles and Page Access
- Category: `Troubleshooting`
- Owner: `Platform Admin`
- Who this is for: Admin and super admin users.
- Prerequisites: Admin-level role.
- Steps:
  1. Open `/user-management`.
  2. Create or edit user records.
  3. Assign department, role, and page access.
  4. Set active/inactive status as required.
- Expected result: Access model reflects assigned roles and pages.
- Troubleshooting: Forbidden or failed update -> verify your role and target user constraints.
- Related features: `Workspace Overview`, `Profile`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/user-management/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/users/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/users/[userId]/route.ts`

### Draft 9: Track SLA Breaches
- Category: `Troubleshooting`
- Owner: `Merchant Success Ops`
- Who this is for: Merchant Success users reviewing overdue response tickets.
- Prerequisites: Merchant Success access.
- Steps:
  1. Open `/merchant-success/sla-breaches`.
  2. Review breached ticket rows and timing.
  3. Open related ticket for action.
  4. Recheck list after ticket updates.
- Expected result: SLA breach backlog is visible and actionable.
- Troubleshooting: No records but expected breaches -> verify ticket timestamps and status updates.
- Related features: `Merchant Success Tickets`, `Merchant Success Analytics`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/sla-breaches/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/tickets/route.ts`

### Draft 10: Use CSAT Insights Filters and Trends
- Category: `CSAT`
- Owner: `Merchant Success Ops`
- Who this is for: Users analyzing ticket feedback performance.
- Prerequisites: Access to CSAT Insights page.
- Steps:
  1. Open `/merchant-success/csat-insights`.
  2. Apply header filters for date/agent/segment.
  3. Review score and response trend cards.
  4. Drill into low-score entries for follow-up.
- Expected result: Teams can identify satisfaction trends and problem areas.
- Troubleshooting: Charts appear empty -> confirm filters and ticket CSAT data availability.
- Related features: `Merchant Success Analytics`, `Tickets`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/csat-insights/page.tsx`
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/csat-insights/header-filters.tsx`

### Draft 11: Plan Onboarding Schedule
- Category: `Getting Started`
- Owner: `Merchant Success Ops`
- Who this is for: Teams coordinating onboarding timeslots.
- Prerequisites: Onboarding schedule page access.
- Steps:
  1. Open `/merchant-success/onboarding-schedule`.
  2. Review upcoming onboarding appointments.
  3. Add or update appointment details.
  4. Confirm status and assigned owner.
- Expected result: Onboarding calendar is current and shared across teams.
- Troubleshooting: Appointment change not shown -> refresh and verify API save succeeded.
- Related features: `Sales Appointment`, `Onboarding Appointments`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/onboarding-schedule/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/onboarding-appointments/route.ts`

### Draft 12: Review Merchant Coverage Map
- Category: `Merchants`
- Owner: `Operations`
- Who this is for: Users validating geographic merchant coverage.
- Prerequisites: Access to map page and merchant location data.
- Steps:
  1. Open `/maps`.
  2. Search/filter outlets in the map controls.
  3. Select markers to inspect outlet details.
  4. Open external maps link if needed.
- Expected result: Merchant location coverage is visible by outlet.
- Troubleshooting: Missing markers -> verify outlet latitude/longitude in source data.
- Related features: `Merchants`, `Renewal Due`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/maps/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/maps/outlets/route.ts`

## Deprecated or archived candidates
- No local evidence of a known KB article mapping to a removed route/feature from the discoverable KB set.
- Archive queue: none.

## Notion action queue
When Notion MCP is available, run these in order:
1. Update article `Create and Track Tickets` (set `Status=Draft`, refresh content and source refs).
2. Update article `Linking Messages to Merchant Records` (set `Status=Draft`, refresh content and source refs).
3. Update article `Ticket Statuses Explained` (metadata refresh only).
4. Update article `Renewal Reminder Timeline` (draft refresh).
5. Create the 12 draft articles listed above with required metadata.
6. Archive/deprecate none for this run.

## QA gate (kb-article-standard)
- Six required sections present for every draft: PASS
- Source refs included for every draft: PASS
- Steps executable and ordered: PASS
- Troubleshooting includes concrete failure mode/fix: PASS
- Metadata included (category, app version, last verified date, owner): PASS
- Publication decision: `Needs Fix` for publication, because all new/updated items are intentionally `Draft` pending review.
