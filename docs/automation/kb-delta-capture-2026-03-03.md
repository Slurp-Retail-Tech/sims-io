# KB Delta Capture - 2026-03-03

## Run context
- Automation ID: `kb-delta-capture`
- Run date: `2026-03-03`
- Scope scanned (local only): `docs/PRD.md`, `docs/TDD.md`, `src/app/(app)`, `src/app/api`, `src/components`
- Notion MCP state: configured but not authenticated (`Status=Unsupported` from `codex mcp list`), MCP resources unavailable in this session.

## Existing KB map discovered locally
Source: `src/lib/knowledge-base.ts` and `src/app/(app)/knowledge-base/page.tsx`

- Published: `Create and Track Tickets` (`Tickets`)
- Published: `Linking Messages to Merchant Records` (`Merchants`)
- Queue candidate: `Ticket Statuses Explained` (`Tickets`, Approved)
- Queue candidate: `Renewal Reminder Timeline` (`Renewals`, Draft)

## Delta decisions

### Update existing articles
1. **Create and Track Tickets**
- Action: Update content and re-verify labels/steps against current Ticket UI.
- Why: Current implementation includes status filter, date range, export, CSAT share, and ClickUp sync paths.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/tickets/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/tickets/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/tickets/export/route.ts`

2. **Linking Messages to Merchant Records**
- Action: Update terminology and workflow for merchant/outlet linking and import sync.
- Why: Merchant import, outlet expansion, and renewal proximity labels are reflected in current UI.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchants/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/merchants/[merchantId]/outlets/route.ts`

3. **Ticket Statuses Explained**
- Action: Keep as valid; refresh last verified + app version and ensure labels match page.
- Why: Statuses used in tickets page are explicitly rendered (`Open`, `In Progress`, `Pending Customer`, `Resolved`).
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchant-success/tickets/page.tsx`

4. **Renewal Reminder Timeline**
- Action: Keep as draft and update to match current renewal-due behavior.
- Why: UI currently surfaces expiring outlets and status badge `Expiring Soon`.
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/renewal-retention/renewal-due/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/renewals/expiring/route.ts`

### Create new draft articles
Each draft below follows KB standard sections and includes category/metadata inputs for Notion.

1. **Navigate Workspace and Access Assigned Pages**
- Category: `Getting Started`
- Feature Area: `Workspace`, `Access Control`
- Who this is for: Users opening the app for daily work.
- Prerequisites: Active login and assigned page access.
- Steps:
  1. Log in at `/login`.
  2. Open sidebar and pick your department section.
  3. Use page breadcrumbs in header to navigate.
  4. If a page is missing, contact admin for access updates.
- Expected result: User can reach only permitted pages and understand navigation.
- Troubleshooting: Missing page after login -> verify role/page access in User Management.
- Related features: `User Management`, `Profile`, `Preferences`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Product Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/overview/page.tsx`
  - `/Users/hafiz/sims-io/src/components/app-sidebar.tsx`
  - `/Users/hafiz/sims-io/src/components/app-header.tsx`

2. **Import Merchants and Review Outlet Expiry Status**
- Category: `Merchants`
- Feature Area: `Merchants`, `Renewals`
- Who this is for: Users maintaining merchant and outlet records.
- Prerequisites: Authorized user and merchant import permissions.
- Steps:
  1. Open `/merchants`.
  2. Run import and monitor import status.
  3. Expand a merchant row to load outlets.
  4. Review `Active`, `Expiring Soon`, or `Expired` labels.
- Expected result: Merchant list and outlets are up to date after import.
- Troubleshooting: Import fails -> check API response message and retry with valid user session.
- Related features: `Renewal Due`, `Merchant Success Tickets`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Merchant Success Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/merchants/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/merchants/import/status/route.ts`

3. **Review Renewal Due Outlets**
- Category: `Renewals`
- Feature Area: `Renewal & Retention`
- Who this is for: Renewal team members tracking upcoming expiries.
- Prerequisites: Logged-in user with renewal page access.
- Steps:
  1. Open `/renewal-retention/renewal-due`.
  2. Adjust records-per-page selector.
  3. Review grouped franchises and outlet due dates.
  4. Open maps link when location context is needed.
- Expected result: User can prioritize expiring outlets by due date.
- Troubleshooting: Empty list -> confirm data exists in renewals expiring API and user session is active.
- Related features: `Renewal Retention Overview`, `Merchants`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Renewal Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/renewal-retention/renewal-due/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/renewals/expiring/route.ts`

4. **Submit CSAT Feedback from Secure Link**
- Category: `CSAT`
- Feature Area: `CSAT`
- Who this is for: Merchants submitting ticket feedback.
- Prerequisites: Valid CSAT token URL.
- Steps:
  1. Open CSAT link provided after ticket resolution.
  2. Select score and optional feedback.
  3. Submit before token expiry.
- Expected result: Feedback is recorded against the related ticket.
- Troubleshooting: Token expired/invalid -> request a new CSAT link from support team.
- Related features: `Create and Track Tickets`, `CSAT Insights`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Support Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/csat/[token]/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/csat/[token]/route.ts`

5. **Manage Sales Leads and Archived Leads**
- Category: `Tickets`
- Feature Area: `Sales`, `Leads`
- Who this is for: Sales users working inbound leads.
- Prerequisites: Sales role access.
- Steps:
  1. Open `/sales/leads`.
  2. Filter/search leads.
  3. Archive or restore leads from archived dialog.
  4. Review sync status indicators.
- Expected result: Lead pipeline remains clean and up to date.
- Troubleshooting: Lead action fails -> refresh table and verify session authorization.
- Related features: `Sales Overview`, `Sales Analytics`, `Sales Appointment`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Sales Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/sales/leads/page.tsx`
  - `/Users/hafiz/sims-io/src/app/(app)/sales/leads/leads-table.tsx`
  - `/Users/hafiz/sims-io/src/app/api/leads/route.ts`

6. **Update Profile Details and Password**
- Category: `Profile`
- Feature Area: `Profile`
- Who this is for: Any authenticated user updating personal account details.
- Prerequisites: Active session and current password for password change.
- Steps:
  1. Open `/profile`.
  2. Update name and optional avatar.
  3. Enter current/new password when changing credentials.
  4. Save and confirm profile refresh.
- Expected result: Profile changes persist and session profile is updated.
- Troubleshooting: Save rejected -> confirm current password and avatar size under 2MB.
- Related features: `Preferences`, `User Management`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Security Ops`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/profile/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/profile/route.ts`

7. **Admin: Manage Users, Roles, and Page Access**
- Category: `Troubleshooting`
- Feature Area: `Administration`, `RBAC`
- Who this is for: Admin and super admin users.
- Prerequisites: Admin-level account.
- Steps:
  1. Open `/user-management`.
  2. Create or edit user details.
  3. Assign role/department/page access.
  4. Toggle active/inactive status with guardrails.
- Expected result: Users can access exactly the pages required for their role.
- Troubleshooting: Forbidden errors -> confirm current user role can modify target user/role.
- Related features: `Workspace Overview`, `Profile`.
- App Version: `v1.0.2`
- Last Verified Date: `2026-03-03`
- Owner: `Platform Admin`
- Source refs:
  - `/Users/hafiz/sims-io/src/app/(app)/user-management/page.tsx`
  - `/Users/hafiz/sims-io/src/app/api/users/route.ts`
  - `/Users/hafiz/sims-io/src/app/api/users/[userId]/route.ts`

### Deprecated/Archived actions
- No local evidence of existing KB article mapped to a removed route/feature from the discoverable KB set.
- Result: no deprecations proposed in this run.

## Notion action queue (pending MCP auth)
1. Update existing article: `Create and Track Tickets` -> set `Status=Draft` after content refresh.
2. Update existing article: `Linking Messages to Merchant Records` -> set `Status=Draft` after content refresh.
3. Update existing article: `Ticket Statuses Explained` -> metadata refresh.
4. Update existing article: `Renewal Reminder Timeline` -> draft content refresh.
5. Create 7 draft articles listed above.
6. No archive operations required this run.

## QA gate check (kb-article-standard)
- Required six sections included in all new drafts: PASS
- Source refs present: PASS
- Steps ordered and executable: PASS
- Troubleshooting concrete failure mode included: PASS
- Metadata completeness (category, app version, last verified date, owner): PASS
- Publication readiness status: `Needs Fix` for publication because all proposed items are intentionally `Draft`.
