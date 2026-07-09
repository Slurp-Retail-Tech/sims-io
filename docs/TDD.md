# SPEC-001 – Unified Engagement Platform for Support, Sales & Renewal Teams

## Background

**Context.** Support, Sales, and Renewal teams currently juggle fragmented tools (separate Messaging inboxes, email, forms, spreadsheets, ad‑hoc calendars). This creates repetitive work, slow first responses, inconsistent lead qualification, reactive renewal handling, and no unified customer history. The result is merchant friction, higher churn risk, and operational inefficiency.

**Vision.** A single Engagement Platform that centralizes multi‑channel conversations (Messaging first; email & forms), turns inbound messages into structured tickets/leads, links every contact to the correct POS account, schedules onboarding, and automates renewals/failed‑payment recovery—while logging CSAT and surfacing actionable insights.

**Primary users.**

* **Support Agents** – triage/resolve tickets, use canned replies/KB, collect CSAT.
* **Sales** – capture/qualify inbound leads, view history, book onboarding with Merchant Success.
* **Renewal/Retention** – proactive reminders, failed‑payment recovery, winback flows, outcome logging.
* **Ops/Analytics** – dashboard on CSAT, top issues, high‑risk merchants.

**Business goals (from PRD).** Reduce manual workload ~40%, achieve <5‑minute first response, +20% CSAT, 60% failed‑renewal recovery, 10% winback, and clear visibility of top ticket categories and high‑ticket merchants.

**Non‑goals (MVP).** Replace human agents; support every channel globally from day one (sequence Messaging → email → forms); build a full CRM.

**Constraints.** External messaging channel APIs are not integrated in the current app implementation; integrate securely with back‑office POS to fetch account context; role‑based access; real‑time scheduling; PDPA compliance (Malaysia); scalable ticket/lead infrastructure and analytics by agent/merchant/category.

**Implementation note.** Channel integration in this spec is design-only and not part of the current app release.

**Ticket creation rule (current).** Tickets are created and managed inside the app workflow.

## Current Implementation Snapshot

The current repository does not yet implement the full service split described below. Today, the live codebase is a single Next.js App Router application with:

* UI routes in `src/app/`
* API handlers in `src/app/api/`
* Shared server and integration logic in `src/lib/`
* MySQL access through `mysql2`
* MinIO-backed uploads
* POS and ClickUp integrations invoked from route handlers and shared library code

The current app already supports internal ticket workflows, merchant import/browsing, sales leads, onboarding appointments, user management, public forms, and selected analytics surfaces.

The Sales lead module now covers the full lead lifecycle: lead assignment (`leads.assigned_user_id`), manual lead creation, post-submission editing, per-lead **deals** (`deals` table — stage, amount, closed date, close lost reason, and an optional free-text `close_lost_remarks` kept only while the deal is Closed Lost) and **activity logging** (`lead_activities` table — Note/Email/Call/Task/Meeting/WhatsApp Message with type-specific fields; activities are editable and deletable via `PATCH`/`DELETE /api/leads/[leadId]/activities/[activityId]`, with `lead_activities.updated_at` set on edit). An activity may optionally be linked to one of the lead's deals via `lead_activities.deal_id` (FK to `deals.id`, `ON DELETE SET NULL`). There is a dedicated `/sales/deals` page with List and drag-and-drop Kanban views and a per-deal detail page at `/sales/deals/[dealId]`. Each deal keeps an append-only stage-movement audit log (`deal_activities` table — `created` and `stage_changed` events with `from_stage`/`to_stage`), written automatically on deal creation and stage change and surfaced on the deal detail page. The deals list (`GET /api/deals`) exposes a computed `last_activity_at` per deal — the newest of any linked lead activity and the deal's stage-movement log — and supports combinable from–to date-range filters by create date, last activity date, and close date (`createdFrom/createdTo`, `activityFrom/activityTo`, `closedFrom/closedTo`). Lead `source` is standardised to `web | mobile | manual`. Public demoform submissions also capture **marketing origin**: the form reads `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, and `fbclid` from the landing URL (ads link directly to `/demoform`), submits them as hidden fields, and the `POST /api/leads` handler stores the raw params (`leads.utm_source/utm_campaign/gclid/fbclid`) plus a derived display label `leads.origin` via `deriveLeadOrigin` in `src/lib/leads.ts` (a Facebook click id or Facebook-family `utm_source` → `Facebook Ads`; a Google click id or Google `utm_source` → `Google Ads`; any other explicit `utm_source` → that source title-cased; otherwise `Organic / Direct`). The origin label is surfaced in the leads table, the new-lead notification email, and the lead-assigned email. The lead-assigned email also carries an **Open in WhatsApp** quick-action button linking to `https://wa.me/<number>`, where the lead's digits-only telephone is normalised by `src/lib/whatsapp.ts` (a leading `0` is replaced with `LEAD_WHATSAPP_COUNTRY_CODE`, default `60`). Facebook Ads conversions are tracked with a native Meta Pixel gated on `NEXT_PUBLIC_META_PIXEL_ID`: the base pixel (`PageView`) loads site-wide from the root layout and a `Lead` conversion fires from the demoform success handler with `source`/`business_type`/`language` params (single source of the Lead event — not duplicated in GTM). When `META_CAPI_ACCESS_TOKEN` is also set, the same `Lead` is additionally sent server-side via the Meta Conversions API from `POST /api/leads` (`src/lib/meta-capi.ts`) so conversions survive browser ad blockers; the browser and server events carry a shared client-generated `event_id` so Meta deduplicates them. Server-side user data (phone, name) is SHA-256 hashed per Meta's rules; IP, user-agent, and the `_fbc`/`_fbp` cookies (or an `fbc` synthesised from `fbclid`) are attached for match quality. See `docs/meta-pixel-tracking.md`. Each lead also carries a work `status` (`leads.status` — ENUM `Unworked | Worked`, defaulting to `Unworked`), editable from the lead edit dialog and filterable from the leads table (`GET /api/leads?status=`); logging any activity on a lead auto-advances an `Unworked` lead to `Worked`. Leads can be assigned to **any** active Sales & Marketing user regardless of role (`GET /api/users/sales-agents`); admins can reassign inline from both the leads table and the lead detail page. Assigning a lead to a new user sends that user a best-effort email notification (`src/lib/lead-assignment-notification.ts`) with the lead details and a link; a mail failure never blocks the assignment. The deal detail page (`/sales/deals/[dealId]`) also surfaces the linked lead's contact details (name, telephone, email, business info) via extra columns on `GET /api/deals/[dealId]`. Visibility is role-scoped: a Sales & Marketing `User` sees only leads/deals assigned to them, while `Admin`/`Super Admin` see all and can filter the deals page by assignee. See `src/lib/leads.ts`, `src/lib/deals.ts`, `src/lib/lead-activities.ts`, and `src/lib/deal-activities.ts` for the shared logic (stage/field reconciliation, activity validation, and deal audit logging live there).

### Current Architecture Notes

* The app is currently deployed as one web application rather than separate `api/`, `worker/`, and `packages/shared/` services.
* The schema in `schema.sql` is the current operational schema and should be treated as the source of truth for implemented tables.
* Redis-, RabbitMQ-, and webhook-driven messaging components in this document are target-state design, not current runtime dependencies (with the exception of Redis, which is now used in production for rate limiting — see Rate Limiting below).
* Some pages are intentionally UI previews. In particular, the Renewal & Retention overview page currently shows sample KPI cards and placeholder chart panels instead of live reporting.

#### Session / Authentication Architecture

Sessions use **opaque tokens** rather than storing user IDs directly in cookies.

* **Token generation:** `randomBytes(32).toString("hex")` produces a 64-character hex token stored only in the `sims-auth` httpOnly cookie.
* **Server-side sessions table:** the raw token is SHA-256 hashed before DB storage; the `sessions` table only ever holds `token_hash CHAR(64)`. The plaintext token never touches the database.
* **`requireAuthenticatedUser(request)`** (exported from `src/lib/auth.ts`): hashes the cookie value, JOINs `sessions` with `users`, validates `expires_at`. All 45 protected API routes use this exclusively — there is no path that accepts a raw user ID from a cookie.
* **`createSession(userId, remember)`**: inserts the hashed token into the `sessions` table and returns the raw token for the cookie. TTL is 7 days (30 days when "remember me" is set).
* **`deleteSession(rawToken)`**: deletes the session row by hash (used on logout).
* Cookie flags: `httpOnly: true`, `sameSite: "strict"`, `secure: true` in production.
* **Password reset** deletes all sessions for the affected user (`DELETE FROM sessions WHERE user_id = ?`) to invalidate concurrent sessions on credential change.

### Current Gaps to Track

* Renewal analytics are not fully wired to live data.
* Messaging-provider webhook ingestion is not implemented.
* Automated renewal messaging and full CSAT flow are not implemented.
* Automated test coverage is minimal and currently focused on shared timezone helpers.
* RabbitMQ is not a current runtime dependency; Redis is required in production for rate limiting (in-memory fallback for local dev).

## Requirements

**MoSCoW Prioritization**

**Must Have**

* **MessagingProvider Messaging integration:** Receive webhooks for inbound messages, send Messaging messages, handle media, message status, and rate‑limit/backoff compliance.
* **Ticketing with POS linking:** Every thread auto‑or manually assigned a **FID** (Franchise) and **OID** (Outlet). Link via phone → FID/OID lookup; allow manual disambiguation when multiple outlets match; audit trail for changes.
* **Unified inbox & triage:** Threaded conversation view, assignment, collision control, internal notes, mentions, canned replies, categories, priority, SLA timers (FRT ≤ 5 min, ART tracked), and escalation.
* **Lifecycle & outcomes:** Statuses: New, Open, Pending Merchant, Pending Internal, Resolved, Closed; outcomes logged (Resolved, Info Provided, Escalated L2, Bug Filed, Lead Qualified, Renewal Recovered, Winback).
* **CSAT capture via Messaging:** 1–5 rating + optional comment auto‑sent on resolution with opt‑out. Store per ticket and aggregate by FID/OID/agent.
* **Renewal & failed‑payment recovery:** Ingest billing/renewal events from POS; send reminder/recovery templates; log attempts/outcomes; prevent spam via frequency caps.
* **RBAC:** Roles (Agent, Sales, Renewal, Supervisor, Admin) with scoped access by FID and outlet; PII field‑level controls.
* **Observability & analytics:** Dashboards for volume by category, FRT/ART, CSAT, reopen rate, backlog age, top merchants by tickets, recovery rate; export (CSV) and scheduled email.
* **Security & compliance (PDPA):** Consent/opt‑in state, right‑to‑erasure tools, audit logging, encryption in transit/at rest, data retention policy, least‑privilege access, incident logging.
* **Scalability & reliability:** Multi‑tenant by FID/OID, idempotent webhooks, retries with DLQ, 99.9% uptime target, structured logs/metrics/traces.

**Should Have**

* **Lead capture & qualification:** Auto‑classify inbound as Support vs Sales using entry points/keywords; capture lead fields; handoff to Sales with SLA.
* **Onboarding scheduling:** Share booking links, two‑way calendar sync, reminders (Messaging + email), ICS files, MS PIC assignment before approval, and SMTP email notifications to Merchant Success admins, assigned MS PICs, and submitters as appointments move through submission, approval, and completion.
* **Knowledge base integration:** Internal KB search and suggested replies.
* **Multilingual support:** EN + BM (Bahasa Malaysia) for templates and UI labels.
* **Email + Web form channels:** Secondary intake mapping to tickets with same FID/OID model.

**Could Have**

* **SSO (Google/Microsoft/Okta).**
* **Quality tooling:** QA scorecards, conversation review, coaching.
* **Customer portal:** Track ticket status and history for merchants.

**Won’t Have (MVP)**

* Full CRM replacement.
* Social channels beyond Messaging (e.g., FB/IG DM) in MVP.
* Automated LLM agent handling without human‑in‑the‑loop.

## Method

The sections below describe the intended target-state architecture. Use them for direction-setting and future design, but verify current implementation details against the live codebase before making assumptions about what already exists.

### Architecture Overview (MVP)

**High‑level components**

* **Messaging Ingestor (Webhook API):** Validates `X-Hub-Signature-256`, parses inbound messages/statuses, 200‑OK fast, emits domain events to a queue.
* **Conversation Orchestrator:** Tracks 24‑hour session state, selects/send templates, enforces rate‑limit/backoff, deduplicates events by Messaging `message_id`.
* **Ticket Service:** Creates/updates tickets, auto‑assigns **FID/OID** from POS Adapter, supports statuses/SLAs, categories, assignments, internal notes, outcomes, and audit.
* **POS Adapter & Sync:** Resolves contact → **FID/OID** via POS backend; provides franchise/outlet metadata; runs a **daily full sync** of franchises/outlets (no inbound billing webhooks).
* **Renewal/Recovery Service:** Computes renewals from `outlet.expiry_date`, schedules Messaging template reminders, applies frequency caps, logs recovery outcomes.
* **CSAT Service:** On `Resolved` status, triggers Messaging rating flow (1–5 + comment), aggregates by FID/OID/agent.
* **User/Admin Portal:** Unified inbox (threads, filters, search), ticket view, canned replies, SLA indicators, dashboards.
* **AuthN/Z:** Email/password + RBAC (Agent, Sales, Renewal, Supervisor, Admin); scope by FID/OID.
* **Observability:** Structured logs, metrics, traces; alerts on webhook failure rates, send failures, SLA breaches.

**Data & infrastructure (on VPS / dedicated DC in Kuala Lumpur)**

* **Relational DB:** MySQL 8.4 LTS (tickets, contacts, franchises/outlets, messages, renewals, CSAT, users, roles).
* **Cache/coordination:** Redis (sessions, rate‑limits, short‑lived lookups).
* **Queue:** RabbitMQ (idempotent event processing, DLQ for poison messages).
* **Object storage:** MinIO (media from Messaging: images, voice notes, docs) with lifecycle rules.
* **Reverse proxy/TLS:** NGINX + Let’s Encrypt (ACME HTTP‑01) for public webhook endpoints.
* **Containerization:** Docker Compose for MVP (one host), with network segregation (frontend, backend, data planes).

**Security & compliance**

* Verify webhook signatures; store only necessary PII; encryption in transit/at rest; audit logs; admin export & erasure tools; IP allow‑listing to admin portal; secret rotation.

**SLA & resilience**

* FRT timer starts at first inbound; ART tracked per status change; retries with exponential backoff; DLQ with operator UI; health checks and circuit breakers on external calls (MessagingProvider API, POS).

```plantuml
@startuml
skinparam componentStyle rectangle
skinparam wrapWidth 200

actor Merchant
actor Agent

package "Public Internet" {
  [NGINX] -down-> (Messaging Ingestor)
}

cloud "MessagingProvider Messaging API" as WA
WA -left-> (Messaging Ingestor)

queue "RabbitMQ" as MQ

(Messaging Ingestor) -right-> MQ : events

component "Conversation Orchestrator" as Orchestrator
component "Ticket Service" as Ticket
component "POS Adapter & Sync" as POS
component "Renewal/Recovery" as Renewal
component "Scheduler (Cron)" as Cron
component "CSAT Service" as CSAT
component "AuthN/Z" as Auth
component "User/Admin Portal (Web)" as Web

MQ -down-> Orchestrator
MQ -down-> Ticket
MQ -down-> Renewal
Ticket -down-> CSAT : on Resolved

Orchestrator -left-> WA : send messages/templates
Cron -down-> POS : daily sync franchises/outlets
POS -down-> Ticket : FID/OID resolution
Cron -right-> Renewal : compute from outlet.expiry_date

database "MySQL 8.4 LTS" as PG
rectangle "Redis" as Redis
folder "MinIO (media)" as S3

Ticket -down-> PG
Orchestrator -down-> Redis
Ingestor -down-> Redis
Ticket -down-> S3

Agent --> Web
Web --> Ticket
Web --> Auth

Merchant --> WA : chats
@enduml
```

### Data Model (MySQL) — FID/OID–centric

**MySQL Settings (MVP)**

* Engine: **InnoDB**; Charset/Collation: **utf8mb4 / utf8mb4_0900_ai_ci** (emoji-safe).
* Strict mode ON; SQL_SAFE_UPDATES OFF; `sql_require_primary_key=ON`.
* Timezone stored as UTC. The application uses `Asia/Kuala_Lumpur` for all user-facing display, date filters, exports, dashboard "today/yesterday" metrics, and analytics date/hour/month buckets.
* SQL calendar grouping uses a fixed `+08:00` conversion from UTC instead of named timezone tables, so environments do not need MySQL timezone data loaded.

**Core tables** (abridged DDL; implement all FKs + indices):

```sql
-- Franchise & Outlet
CREATE TABLE franchise (
  fid BIGINT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  renewal_date DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE outlet (
  oid BIGINT PRIMARY KEY,
  fid BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  address JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_outlet_franchise FOREIGN KEY (fid) REFERENCES franchise(fid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Users & RBAC
CREATE TABLE user (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('agent','sales','renewal','supervisor','admin') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE user_scope (
  user_id BIGINT NOT NULL,
  fid BIGINT NULL,
  oid BIGINT NULL,
  PRIMARY KEY(user_id, fid, oid),
  CONSTRAINT fk_scope_user FOREIGN KEY(user_id) REFERENCES user(id),
  CONSTRAINT fk_scope_franchise FOREIGN KEY(fid) REFERENCES franchise(fid),
  CONSTRAINT fk_scope_outlet FOREIGN KEY(oid) REFERENCES outlet(oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contacts (Messaging-first)
CREATE TABLE contact (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  wa_phone_e164 VARCHAR(32) NOT NULL,
  display_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  UNIQUE KEY uq_contact_phone (wa_phone_e164)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE contact_outlet (
  contact_id BIGINT NOT NULL,
  oid BIGINT NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (contact_id, oid),
  CONSTRAINT fk_co_contact FOREIGN KEY(contact_id) REFERENCES contact(id),
  CONSTRAINT fk_co_outlet FOREIGN KEY(oid) REFERENCES outlet(oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tickets
CREATE TABLE ticket (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fid BIGINT NOT NULL,
  oid BIGINT NOT NULL,
  contact_id BIGINT NOT NULL,
  status ENUM('new','open','pending_merchant','pending_internal','resolved','closed') NOT NULL DEFAULT 'new',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  category_id BIGINT NULL,
  assigned_user_id BIGINT NULL,
  first_response_at DATETIME NULL,
  resolved_at DATETIME NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_franchise FOREIGN KEY(fid) REFERENCES franchise(fid),
  CONSTRAINT fk_ticket_outlet FOREIGN KEY(oid) REFERENCES outlet(oid),
  CONSTRAINT fk_ticket_contact FOREIGN KEY(contact_id) REFERENCES contact(id),
  CONSTRAINT fk_ticket_assignee FOREIGN KEY(assigned_user_id) REFERENCES user(id),
  KEY idx_ticket_status_created (status, created_at),
  KEY idx_ticket_fid_oid (fid, oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE category (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Messages (Messaging)
CREATE TABLE message (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT NOT NULL,
  direction ENUM('in','out') NOT NULL,
  wa_message_id VARCHAR(128) NULL,
  type ENUM('text','image','audio','video','document','location','interactive') NOT NULL,
  content_text TEXT NULL,
  media_key VARCHAR(512) NULL,
  media_mime VARCHAR(128) NULL,
  media_sha256 VARCHAR(128) NULL,
  sent_at DATETIME NULL,
  received_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_ticket FOREIGN KEY(ticket_id) REFERENCES ticket(id),
  UNIQUE KEY uq_wa_message_id (wa_message_id),
  FULLTEXT KEY ftx_message_text (content_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CSAT
CREATE TABLE csat_response (
  ticket_id BIGINT PRIMARY KEY,
  rating TINYINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NULL,
  responded_at DATETIME NOT NULL,
  CONSTRAINT fk_csat_ticket FOREIGN KEY(ticket_id) REFERENCES ticket(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Renewals & Recovery
CREATE TABLE renewal (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  fid BIGINT NOT NULL,
  oid BIGINT NOT NULL,
  cycle_start DATE NOT NULL,
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('due','paid','failed','cancelled') NOT NULL DEFAULT 'due',
  last_attempt_at DATETIME NULL,
  CONSTRAINT fk_renewal_franchise FOREIGN KEY(fid) REFERENCES franchise(fid),
  CONSTRAINT fk_renewal_outlet FOREIGN KEY(oid) REFERENCES outlet(oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE renewal_attempt (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  renewal_id BIGINT NOT NULL,
  channel ENUM('messaging','email','call') NOT NULL,
  template_name VARCHAR(128) NULL,
  result ENUM('sent','bounced','delivered','failed','replied','paid') NOT NULL,
  error_code VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attempt_renewal FOREIGN KEY(renewal_id) REFERENCES renewal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Audit & Webhooks
CREATE TABLE audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(64) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE webhook_event (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  delivery_id VARCHAR(128) NULL,
  payload_hash CHAR(64) NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  status ENUM('received','processed','failed','dlq') NOT NULL DEFAULT 'received',
  UNIQUE KEY uq_payload_hash (payload_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sessions (current implementation — opaque token auth)
CREATE TABLE sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  token_hash CHAR(64) NOT NULL,   -- SHA-256 of the raw cookie token; plaintext never stored
  remember BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uniq_session_token_hash (token_hash),
  INDEX sessions_user_idx (user_id, expires_at),
  CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **`csat_tokens` note:** the `token` column has been renamed to `token_hash CHAR(64)`. The SHA-256 of the raw UUID token is stored; the plaintext token is only ever present in the survey URL and is never persisted. Application code hashes the URL token before querying the table.

> **CSAT Google Review trigger.** `csat_responses` carries two funnel columns —
> `google_review_shown_at` and `google_review_clicked_at` (both `DATETIME(3)`, nullable). On
> submission, if the Support Service score normalizes to ≥3 (Satisfied/Very Satisfied) **and**
> `CSAT_GOOGLE_REVIEW_URL` is configured, the survey shows a Google Review link for Slurp Retail
> Tech Sdn Bhd and stamps `google_review_shown_at`. A fire-and-forget `POST
> /api/csat/[token]/review-click` stamps `google_review_clicked_at` (idempotent). The eligibility
> decision lives in `src/lib/csat-google-review.ts`, whose score mapping mirrors the analytics
> `SCORE_CASE_SQL`. The URL is returned by `GET /api/csat/[token]` only for qualifying responses —
> never leaked for low scores. CSAT Insights reports the shown → clicked → conversion-rate funnel.

**Message search strategy.** Use FULLTEXT on `message.content_text` for quick phrase search; add `ticket_id` filter and date ranges to keep result sets small.

**Contact → FID/OID resolution.**

* Primary: lookup by `wa_phone_e164` in `contact_outlet` to propose default OID.
* Fallback: prompt agent with list of candidate outlets for that phone; once selected, persist link in `contact_outlet` (set `is_primary=1`).

### Data Model Delta — Renewals by `expiry_date` (Final)

```sql
ALTER TABLE outlet ADD COLUMN expiry_date DATE NULL AFTER timezone;
ALTER TABLE renewal ADD COLUMN source ENUM('pos','computed') NOT NULL DEFAULT 'computed' AFTER currency;
```

* **Semantics:** `outlet.expiry_date` is the outlet's subscription/payment due date. `renewal.source='computed'` indicates records created by the scheduler.
* **Scheduler logic:** Generate/refresh `renewal` rows for outlets whose `expiry_date` is within the next 60 days; set `due_date = expiry_date`.

### MessagingProvider Messaging Contract (MVP)

* **Inbound (Webhook)**

  * **Webhook method:** Accept `POST` callbacks from MessagingProvider and return `2xx` quickly after enqueueing.
  * **Signature:** Verify `X-MessagingProvider-Signature` against the raw payload and request URL. Reject if invalid.
  * **Events handled:** messages (`text`, `image`, `audio`, `video`, `document`, `interactive`), message status, reactions. Deduplicate by `wa_message_id` (unique index).

* **Outbound (Send)**

  * Endpoint: MessagingProvider Messages API (`POST /2010-04-01/Accounts/{AccountSid}/Messages.json`) with Account SID + Auth Token.
  * **Within 24‑hour session:** free‑form service messages allowed.
  * **Outside session:** use approved **template** messages (localized EN/BM variants). Track template name & language in `renewal_attempt` and message metadata.
  * Handle 4xx/5xx with exponential backoff; on 429 apply retry with jitter. Persist send attempts and responses (including returned `message_id`).

* **Media**

  * Download media from MessagingProvider media URLs using authenticated requests. Store in MinIO with `media_sha256` for integrity and `media_mime`.

**Agent workflows**

* **Triage:** New inbound → create ticket (auto FID/OID if resolvable), SLA timer starts; collision control when two agents view same ticket.
* **CSAT:** On `Resolved` → send rating request (1–5 + optional comment). Persist to `csat_response`.
* **Renewal recovery:** Compute from `outlet.expiry_date` → schedule Messaging template reminders (D-14, D-7, D-1, D+3) with caps; update `renewal.status` upon merchant action.

```plantuml
@startuml
skinparam classAttributeIconSize 0

class franchise { fid PK; name; status; renewal_date }
class outlet { oid PK; fid FK; name; timezone; expiry_date }
class contact { id PK; wa_phone_e164; display_name; email }
class contact_outlet { contact_id FK; oid FK; is_primary }
class ticket { id PK; fid FK; oid FK; contact_id FK; status; priority; category_id; assigned_user_id; created_at }
class message { id PK; ticket_id FK; direction; wa_message_id; type; content_text; media_key; created_at }
class csat_response { ticket_id PK/FK; rating; comment; responded_at }
class renewal { id PK; fid FK; oid FK; cycle_start; due_date; amount_cents; status; source }
class renewal_attempt { id PK; renewal_id FK; channel; template_name; result; created_at }
class user { id PK; email; role }
class user_scope { user_id FK; fid FK; oid FK }

franchise "1" -- "*" outlet
outlet "1" -- "*" ticket
contact "1" -- "*" ticket
contact "*" -- "*" outlet : contact_outlet

ticket "1" -- "*" message

ticket ||--|| csat_response
renewal "1" -- "*" renewal_attempt
outlet "1" -- "*" renewal
user "1" -- "*" ticket : assigned_user_id
user "1" -- "*" user_scope
franchise "1" -- "*" user_scope
outlet "1" -- "*" user_scope
@enduml
```

## Implementation

### Capacity & Sizing (MVP — based on ~500 tickets/month, 5 concurrent agents)

* **Host**: single VPS (or bare-metal) with **4 vCPU / 8 GB RAM / 200 GB SSD** is sufficient; leave headroom for media.
* **MySQL**: 1 primary instance (8 GB RAM OK). Estimated growth: ~5–10 MB/month for text; media stored in MinIO. Enable slow query log & add provided indices.
* **Redis**: 512 MB AOF; used for sessions/rate-limits; low CPU.
* **RabbitMQ**: default Quorum queues OK; messages/day low; DLQ sized 1–2 GB.
* **Backups**: nightly full + binlog; restore test monthly (kept as-is).

### Coolify Deployment Profile (Dockerfile build pack)

> Coolify will act as the reverse proxy + TLS terminator. **Do not deploy an NGINX container** in production; keep NGINX only for local dev if desired.

**Repo layout (suggested)**

```
/ (repo root)
  api/        # NestJS HTTP API (webhook + REST)
  worker/     # NestJS worker (queues, scheduler)
  src/        # Next.js UI (app dir lives here)
  public/
  packages/
    shared/   # (optional) shared types/utils
```

**Environment variables (Coolify → each app)**

* Shared: `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL`, `MINIO_*`, `POS_*`, `messaging_provider_*`, `APP_BASE_URL`.
* API-only: `PORT=8080`.
* Web-only: `PORT=3000`, `NEXT_PUBLIC_API_BASE`.
* Worker-only: `WORKER=1` (if you reuse API image).

**Security / rate-limiting env vars (current Next.js app)**

| Variable | Required | Description |
|---|---|---|
| `REDIS_URL` | Production required | Redis connection string for rate limiting (e.g. `redis://redis:6379` or `redis://:password@redis:6379/0` for password-only Redis). Falls back to in-memory store in development; throws at startup in production if absent. |
| `TRUSTED_PROXY` | Optional | Set to `"true"` when behind a reverse proxy (Coolify/Traefik) to enable `X-Forwarded-For` reading for IP-based rate limits. Leave unset when running without a proxy to prevent header spoofing. |
| `MINIO_PUBLIC_URL` | Optional | Public base URL for MinIO presigned URLs served to browsers (e.g. `https://files.example.my`). Needed when the internal `MINIO_ENDPOINT` is not reachable from clients. |
| `RECAPTCHA_SECRET_KEY` | Production required (demo form) | Google reCAPTCHA v2/v3 secret. If absent in production, the demo form `POST` returns HTTP 500 (fail-closed). |
| `LEAD_WHATSAPP_COUNTRY_CODE` | Optional | Default country code for the "Open in WhatsApp" button in the lead-assigned email. When a lead's digits-only telephone starts with `0`, the leading `0` is replaced with this code. Defaults to `60` (Malaysia) when unset. |
| `NEXT_PUBLIC_META_PIXEL_ID` | Optional | Meta (Facebook) Pixel ID. When set, the base pixel loads site-wide (`PageView`) and the demoform fires a `Lead` conversion on success. Baked into the client bundle at build time. Single source of the `Lead` event — do not duplicate it in GTM. |
| `META_CAPI_ACCESS_TOKEN` | Optional | Meta Conversions API access token (System User token). When set alongside `NEXT_PUBLIC_META_PIXEL_ID`, the demoform `Lead` is also sent server-side from `POST /api/leads` so it survives browser ad blockers; deduplicated with the browser pixel via a shared `event_id`. Server-only secret. |
| `META_CAPI_TEST_EVENT_CODE` | Optional | Test Events code for the Conversions API; when set, server events appear under Events Manager → Test Events. Leave unset in production. |

**MessagingProvider Messaging env**

* `messaging_provider_ACCOUNT_SID`
* `messaging_provider_AUTH_TOKEN`
* `messaging_provider_messaging_NUMBER` (e.g. `messaging:+14155238886`)
* `messaging_provider_WEBHOOK_URL`

**Health checks**

* API: `GET /health` → 200 OK (wire this in NestJS `@Controller('health')`).
* Web: `GET /` or `GET /api/health` (Next.js route).
* Worker: use **Docker HEALTHCHECK** that pings a lightweight `/healthz` in the worker or checks AMQP connectivity.

**Domains (Coolify)**

* API app → `api.<your-domain>` (public, used by Messaging webhook + web UI XHR).
* Web app → `<your-domain>` (public UI).

**Services in Coolify**

* **MySQL 8.4**, **Redis**, **RabbitMQ**, **MinIO** → provision as separate services (or use “Docker Image” service type with official images). Capture connection strings and inject into app env vars.

**MinIO Lifecycle Policy (object expiry)**

Uploaded attachments under the `uploads/` prefix are automatically deleted after 60 days by a MinIO-native lifecycle rule. Avatar images under `avatars/` are exempt. Apply this rule once after provisioning using the `mc` CLI:

```bash
mc alias set sims <MINIO_ENDPOINT> <MINIO_ACCESS_KEY> <MINIO_SECRET_KEY>
mc ilm add sims/<MINIO_BUCKET> \
  --prefix “uploads/” \
  --expiry-days 60
mc ilm ls sims/<MINIO_BUCKET>   # verify
```

Operational notes:
- MinIO's scanner runs every 24 hours. Objects are deleted within the first scanner cycle after their 60-day window closes — not at the precise moment.
- **Existing objects older than 60 days** will be deleted on the first scanner cycle after the rule is applied. Check before enabling if old attachments must be preserved.
- The rule is stored in MinIO metadata, not in Git. If MinIO is reprovisioned from scratch, re-apply the rule.
- After deletion, any `attachment_url` or `storage_key` column in MySQL that referenced the object becomes a dangling reference. The view proxy at `/api/uploads/view` returns `404 “File not found.”` for missing objects, so the user-facing impact is a broken attachment link rather than a 500 error.

---

### Dockerfiles

**api/Dockerfile** (NestJS API)

```dockerfile
# ---- base deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY api/package*.json ./
RUN npm ci --omit=dev

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node","dist/main.js"]
```

**worker/Dockerfile** (NestJS worker)

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY worker/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS build
WORKDIR /app
COPY worker/package*.json ./
RUN npm ci
COPY worker .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# optional healthcheck: a tiny HTTP server or amqp ping
CMD ["node","dist/worker.js"]
```

**Dockerfile** (Next.js — standalone output)

```dockerfile
# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Ensure next.config.js contains: module.exports = { output: 'standalone' }
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copy the minimal standalone server
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/ || exit 1
CMD ["node","server.js"]
```

**.dockerignore** (at each app root, or repo root for web)

```
node_modules
npm-debug.log
Dockerfile
.dockerignore
.next/cache
coverage
.env*
.git
```

---

### Coolify app setup (per app)

1. **Create Application → Dockerfile**; connect your Git repo; select the app subdir (`api`, `worker`, or `/` for web).
2. **Build settings**: leave default target; provide `Dockerfile` path relative to repo root (e.g., `api/Dockerfile`).
3. **Environment**: paste env vars from this spec. For secrets (tokens, DB passwords), use Coolify’s **Secret** type.
4. **Resources**: API/Web `0.5–1 vCPU / 512–1024 MB`; Worker `0.5 vCPU / 512 MB`.
5. **Domains**: set `api.example.my` for API; `example.my` for Web. Issue TLS via Coolify.
6. **Health check**: path `/health` (API), `/` (Web). For Worker, disable HTTP health check or add a minimal health endpoint.
7. **Auto-deploy** on push to `main`.
8. **Post-deploy commands** (API): apply schema updates via `schema.sql` (no migrations).

**Scaling guidance**

* API/Web: 1 replica (MVP). Worker: 1 replica (ensures single scheduler instance).
* Concurrency increases → scale API replicas; keep Worker at 1 unless you shard queues.

---

### Replacing docker-compose (local-only)

* Keep the provided `docker-compose.yml` for **local dev**.
* In production, **Coolify services** replace Compose: MySQL, Redis, RabbitMQ, MinIO run as managed services; API/Worker/Web are separate Dockerfile apps.

---

### 1) Infrastructure (VPS / Dedicated DC in Kuala Lumpur)

* **Host OS:** Ubuntu Server 24.04 LTS.
* **Networking:** Coolify proxy handles public ingress + TLS; restrict database/queue consoles to **private** access.
* **Secrets:** `.env` managed in Coolify; rotate app secrets quarterly.

### 2) Container Topology (docker-compose.yml — MVP, single host)

```yaml
# For LOCAL DEV only. In prod, use Coolify per-app Dockerfiles + services.
version: '3.9'
services:
  api:
    build: ./api
    ports: ['8080:8080']
    env_file: [.env]
    depends_on: [mysql, redis, rabbitmq]
  worker:
    build: ./worker
    env_file: [.env]
    depends_on: [redis, rabbitmq]
  web:
    build: .
    ports: ['3000:3000']
    env_file: [.env]
  mysql:
    image: mysql:8.4
    # ... (same as earlier)
  redis:
    image: redis:7
  rabbitmq:
    image: rabbitmq:3-management
  minio:
    image: minio/minio:latest
```

### 3) Environment variables (.env — key subset)

```
NODE_ENV=production
APP_BASE_URL=https://example.my

# MessagingProvider Messaging
messaging_provider_ACCOUNT_SID=...
messaging_provider_AUTH_TOKEN=...
messaging_provider_messaging_NUMBER=messaging:+14155238886
messaging_provider_WEBHOOK_URL=https://api.example.my/webhook

# Database & caches (use service hostnames from Coolify)
DATABASE_URL=mysql://user:pass@mysql:3306/engagement
REDIS_URL=redis://redis:6379          # Required in production for rate limiting
RABBITMQ_URL=amqp://user:pass@rabbitmq:5672

# Object storage
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=wa-media
MINIO_PUBLIC_URL=https://files.example.my   # Public URL for browser-facing presigned URLs

# POS Adapter
POS_BASE_URL=https://pos.internal/api
POS_TOKEN=...

# Security
TRUSTED_PROXY=true                    # Set when behind Coolify/Traefik reverse proxy
RECAPTCHA_SECRET_KEY=...              # Required in production; demo form fails closed without it
```

### 4) NestJS (API/Worker) — Module layout

* `AppModule`
* `AuthModule` (RBAC, JWT), `UsersModule`
* `WebhookModule` (Messaging POST events)
* `MessagingModule` (send templates/service messages, session tracking)
* `TicketModule` (CRUD, assignment, SLA timers, outcomes)
* `POSAdapterModule` (contact→FID/OID resolution, outlet metadata, daily sync)
* `RenewalModule` (expiry-based scheduler, reminder sender)
* `CSATModule` (survey flow, aggregation)
* `StorageModule` (MinIO)
* `QueueModule` (RabbitMQ bindings)
* `ReportingModule` (analytics queries, CSV export)

### 5) Messaging Webhook + Send — Reference handlers (NestJS)

```ts
// webhook.controller.ts
@Post('webhook')
@Header('X-Handled-By', 'engagement')
async handle(@Headers('x-messagingProvider-signature') sig: string, @Req() req: RawBodyRequest<Request>) {
  const raw = req.rawBody as Buffer;
  verifymessaging_providerSignature(raw, sig, process.env.messaging_provider_AUTH_TOKEN!, process.env.messaging_provider_WEBHOOK_URL!);
  const event = req.body;
  await this.webhookService.ingest(event);
  return { ok: true };
}
```

### 6) Eventing & Queues (RabbitMQ)

* Exchanges/Queues kept as earlier; set Worker replicas = 1 in Coolify (scheduler singleton).

### 7) SLA & Automation

* **FRT timer**, **CSAT on resolve**, **renewal cadence** (from `expiry_date`).

### 8) POS Adapter & Daily Sync (Final)

* Daily 02:00 MYT sync + renewal schedule (pseudocode already provided in Appendix).

### 9) Frontend (Next.js) — Unified Inbox MVP

**UI System: shadcn/ui + Tailwind**

* We will use **shadcn/ui** components (Radix under the hood) with **Tailwind** for styling and theming (light/dark).
* Project keeps component source under `components/ui/*` for full control and versioning.

**CLI setup (run at repo root)**

```
# initialize shadcn
pnpm dlx shadcn@latest init

# add core primitives we need
pnpm dlx shadcn@latest add button card badge input textarea label avatar tooltip dropdown-menu dialog sheet tabs table separator scroll-area command toast sonner skeleton

# optional for data table (ticket list)
pnpm dlx shadcn@latest add table data-table
```

**Theme tokens**

* Use CSS variables (recommended) with `--background`, `--foreground`, `--primary`, etc., and enable dark mode via `class` on `html`.
* Create a `ThemeToggle` using `dropdown-menu` + `useTheme()`.

**Key screens & atoms**

* **Inbox**: tickets table (sortable, filter by status/priority/FID/OID), bulk assign, quick actions (command palette).
* **Ticket Detail**: message thread, internal notes, composer (attachments), SLA chips, canned replies.
* **Renewals Console**: due/overdue tabs, one‑click send template, interaction history.
* **Reports**: KPIs cards (FRT, ART, CSAT), charts later (non‑MVP).

**Component map**

* Layout: `sheet` for left nav on mobile, `tabs` for views.
* Lists: `data-table` + `badge` + `tooltip`.
* Thread: custom bubble + `scroll-area`.
* Composer: `textarea`, `button`, `dropdown-menu` for canned replies.
* Dialogs: `dialog` for resolve/close, `sonner`/`toast` for alerts.

**Example: Inbox page skeleton**

```tsx
// src/app/(app)/inbox/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

export default function InboxPage() {
  const columns = [
    { accessorKey: 'id', header: 'Ticket' },
    { accessorKey: 'fid', header: 'FID' },
    { accessorKey: 'oid', header: 'OID' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }: any) => <Badge variant="outline">{getValue()}</Badge> },
    { accessorKey: 'priority', header: 'Priority' },
    { accessorKey: 'assignee', header: 'Assignee' },
    { accessorKey: 'updated_at', header: 'Updated' },
  ];
  const data = [] as any[]; // fetch from API
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Inbox</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline">Filters</Button>
          <Button>Assign</Button>
        </div>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} data={data} />
      </CardContent>
    </Card>
  );
}
```

**Example: Ticket composer atoms**

```tsx
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function Composer({ onSend }: { onSend: (text: string)=>void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex gap-2">
      <Textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Type a reply..."/>
      <Button onClick={()=>{ onSend(text); setText(""); }}>Send</Button>
    </div>
  );
}
```

**Folder structure (web)**

```
/ (repo root)
  src/app/(auth)/*
  src/app/(app)/inbox/page.tsx
  src/app/(app)/tickets/[id]/page.tsx
  src/components/ui/*        # shadcn components
  src/components/common/*    # app-specific wrappers (Composer, SLAChip, etc.)
  src/lib/api.ts             # REST client
```

**Accessibility & i18n**

* Use Radix-based components from shadcn for a11y. Integrate simple i18n keys for EN/BM labels.

### Frontend Theming (Red + system default)

**Decision:** Accent = **Red**; Theme = **system by default** with user toggle.

**Packages** (at repo root)

```
pnpm add next-themes lucide-react
```

**1) Tailwind tokens (override primary → red)**
Add to `src/app/globals.css` (or your CSS where shadcn tokens live):

```css
/* Use Tailwind's red-500 HSL (0 84.2% 60.2%) as primary */
:root {
  --primary: 0 84.2% 60.2%;
  --primary-foreground: 210 40% 98%;
  --ring: 0 84.2% 60.2%;
}
/* Dark mode keeps red hue; you can slightly tweak l% for contrast if desired */
.dark {
  --primary: 0 72.2% 50.6%; /* ~red-600 */
  --primary-foreground: 210 40% 98%;
}
```

> This works because shadcn/ui maps component colors to the `--primary`/`--ring` CSS variables.

**2) Theme provider (system default + toggle)**
Create `src/components/theme-provider.tsx`:

```tsx
'use client';
import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </NextThemesProvider>
  );
}
```

Wrap the root layout in `src/app/layout.tsx`:

```tsx
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

**3) Theme toggle component**
Create `src/components/theme-toggle.tsx`:

```tsx
'use client';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Laptop, Moon, Sun } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Toggle theme">
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}><Sun className="mr-2 h-4 w-4"/> Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}><Moon className="mr-2 h-4 w-4"/> Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}><Laptop className="mr-2 h-4 w-4"/> System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Add it to the top bar (e.g., Inbox header):

```tsx
import { ThemeToggle } from '@/components/theme-toggle';
// ...
<div className="flex gap-2"><ThemeToggle /></div>
```

**4) Visual checks**

* Ensure primary buttons, links, focus rings use red accent.
* Verify color contrast (WCAG) on both light/dark; adjust the L% values if needed.

### 10) Observability & Security

* Logs/metrics identical; Coolify surfaces container logs; use external ELK/Loki if desired.

### 11) Data Migration & Seed

* Run migration SQL in **post-deploy** step of API app or via phpMyAdmin once.

### 12) Templates (initial set)

* CSAT & Renewal EN/BM templates (Appendix).

### Capacity & Sizing (MVP — based on ~500 tickets/month, 5 concurrent agents)

* **Host**: single VPS (or bare-metal) with **4 vCPU / 8 GB RAM / 200 GB SSD** is sufficient; leave headroom for media.
* **MySQL**: 1 primary instance (8 GB RAM OK). Estimated growth: ~5–10 MB/month for text; media stored in MinIO. Enable slow query log & add provided indices.
* **Redis**: 512 MB AOF; used for sessions/rate-limits; low CPU.
* **RabbitMQ**: default Quorum queues OK; messages/day low; DLQ sized 1–2 GB.
* **NGINX**: rate-limit public webhook (e.g., 60 r/m IP burst 120). Enable WAF rules for common patterns.
* **Backups**: nightly full + binlog; restore test monthly (kept as-is).

### POS Authentication — Plain English Explainer

**Goal:** when our platform calls your POS API (and vice‑versa), both sides must be sure they are talking to the right party and the traffic is encrypted.

**Option A – Bearer Token over TLS (simple, good for MVP)**

* We include an HTTP header: `Authorization: Bearer <long-random-token>`.
* Connection is encrypted via **TLS** (HTTPS), preventing snooping.
* POS checks the token; if it matches, the call is accepted.
* **Pros:** Easiest to set up; works behind load balancers and proxies; easy rotation.
* **Cons:** If the token leaks, an attacker could call the POS until we rotate it.
* **Mitigations we’ll apply:** store token in secrets manager, **IP allow‑list** our egress IP(s), scope token to least privilege, **rate‑limit**, and **rotate quarterly**.

**Decision:** Use **Option A** only (Bearer over TLS with IP allow‑listing and quarterly rotation).

```plantuml
@startuml
actor Platform
participant "POS API" as POS

== Bearer over TLS ==
Platform -> POS : HTTPS + Header{Authorization: Bearer TOKEN}
POS --> Platform : 200 OK (verified token)

@enduml
```

### 1) Infrastructure (VPS / Dedicated DC in Kuala Lumpur)

* **Host OS:** Ubuntu Server 24.04 LTS.
* **Networking:** Public ingress **443** → NGINX → API; management ports (RabbitMQ, MySQL, phpMyAdmin, MinIO) **blocked** from public; access via **VPN** or bastion.
* **TLS:** Let’s Encrypt (ACME) auto‑renew; HSTS enabled.
* **Backups/DR:** Nightly full MySQL dump + binlog for PITR (30 days), MinIO object‑lifecycle + weekly offsite sync; monthly restore test.
* **Secrets:** `.env` via Vault/1Password; rotate app secrets quarterly.

### 2) Container Topology (docker‑compose.yml — MVP, single host)

```yaml
version: '3.9'
services:
  nginx:
    image: nginx:stable
    ports: ['443:443']
    volumes:
      - ./deploy/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./deploy/nginx/certs:/etc/letsencrypt
    depends_on: [api]

  api:
    image: registry.local/engagement-api:latest
    env_file: [.env]
    command: ["node","dist/main.js"]
    restart: unless-stopped
    depends_on: [mysql, redis, rabbitmq]

  worker:
    image: registry.local/engagement-api:latest
    env_file: [.env]
    command: ["node","dist/worker.js"]
    restart: unless-stopped
    depends_on: [rabbitmq, redis]

  mysql:
    image: mysql:8.4
    command: ["--default-authentication-plugin=mysql_native_password","--sql-require-primary-key=ON"]
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: engagement
    volumes:
      - mysql-data:/var/lib/mysql

  phpmyadmin:
    image: phpmyadmin:5.2
    environment:
      PMA_HOST: mysql
    depends_on: [mysql]
    # Expose only on VPN/admin network
    networks: [admin]

  redis:
    image: redis:7
    command: ["redis-server","--appendonly","yes"]
    volumes:
      - redis-data:/data

  rabbitmq:
    image: rabbitmq:3-management
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS}
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    # Management UI bound only to admin network
    networks: [admin]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio-data:/data
    networks: [admin]

volumes:
  mysql-data: {}
  redis-data: {}
  rabbitmq-data: {}
  minio-data: {}

networks:
  default: {}
  admin:
    internal: true
```

> **Note:** Place phpMyAdmin, RabbitMQ UI, and MinIO Console on the **internal admin** network; access via VPN only.

### 3) Environment variables (.env — key subset)

```
NODE_ENV=production
PORT=8080
APP_BASE_URL=https://eng.example.my

# MessagingProvider Messaging
messaging_provider_ACCOUNT_SID=...
messaging_provider_AUTH_TOKEN=...
messaging_provider_messaging_NUMBER=messaging:+14155238886
messaging_provider_WEBHOOK_URL=https://api.example.my/webhook

# Database & caches
DATABASE_URL=mysql://user:pass@mysql:3306/engagement
REDIS_URL=redis://redis:6379          # Required in production for rate limiting
RABBITMQ_URL=amqp://user:pass@rabbitmq:5672

# Object storage
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=wa-media
MINIO_PUBLIC_URL=https://files.example.my   # Public URL for browser-facing presigned URLs

# POS Adapter
POS_BASE_URL=https://pos.internal/api
POS_TOKEN=...

# Security
TRUSTED_PROXY=true                    # Set when behind Coolify/Traefik reverse proxy
RECAPTCHA_SECRET_KEY=...              # Required in production; demo form fails closed without it
```

### 4) NestJS (API/Worker) — Module layout

* `AppModule`
* `AuthModule` (RBAC, JWT), `UsersModule`
* `WebhookModule` (Messaging POST events)
* `MessagingModule` (send templates/service messages, session tracking)
* `TicketModule` (CRUD, assignment, SLA timers, outcomes)
* `POSAdapterModule` (contact→FID/OID resolution, outlet metadata)
* `RenewalModule` (listen billing events, schedule reminders)
* `CSATModule` (survey flow, aggregation)
* `StorageModule` (MinIO)
* `QueueModule` (RabbitMQ bindings)
* `ReportingModule` (analytics queries, CSV export)

**Key packages** (NestJS): HTTP (axios), JWT, validation (class‑validator), MySQL ORM (**Prisma** or TypeORM), `@golevelup/nestjs-rabbitmq` for AMQP, multipart parsing for media.

### 5) Messaging Webhook + Send — Reference handlers (NestJS)

```ts
// webhook.controller.ts
@Post('webhook')
@Header('X-Handled-By', 'engagement')
async handle(@Headers('x-messagingProvider-signature') sig: string, @Req() req: RawBodyRequest<Request>) {
  const raw = req.rawBody as Buffer;
  verifymessaging_providerSignature(raw, sig, process.env.messaging_provider_AUTH_TOKEN!, process.env.messaging_provider_WEBHOOK_URL!); // throws if invalid
  const event = req.body;
  await this.webhookService.ingest(event); // publish to RabbitMQ with idempotency key = wa_message_id
  return { ok: true };
}

// messaging.service.ts
async sendTemplate(toE164: string, template: string, lang = 'en') {
  const to = `messaging:${toE164}`;
  const res = await this.messagingProvider.messages.create({
    from: process.env.messaging_provider_messaging_NUMBER!,
    to,
    body: `${template} (${lang})`,
  });
  return res; // includes sid/message_id; persist to message table
}
```

### 6) Eventing & Queues (RabbitMQ)

* **Exchanges:** `wa.events` (fanout), `billing.events` (topic), `tickets.events` (topic).
* **Queues:** `wa.ingest`, `ticket.updater`, `renewal.scheduler`, `renewal.sender`, `csat.sender` with **DLQ** (e.g., `wa.ingest.dlq`).
* **Idempotency:** dedupe on `wa_message_id` (UNIQUE), `payload_hash` in `webhook_event`.
* **Retry:** per‑queue TTL + DLX; worker consumes DLQ with backoff/jitter.

### 7) SLA & Automation

* **FRT (≤5m):** Timer starts on first inbound; alert if `first_response_at` NULL after 5m (working hours aware).
* **CSAT:** On `Resolved` → send rating template → store `csat_response`.
* **Renewal cadence (computed):** For each outlet, set `due_date = expiry_date`. If due within 60 days, schedule Messaging reminders at D-14, D-7, D-1, D+3 (cap: max 3 outstanding prompts per cycle).

### 8) POS Adapter & Daily Sync (Final)

* **Daily full sync (02:00 Asia/Kuala_Lumpur):** Pull all **franchises** and **outlets**; idempotent UPSERTs.
* **Endpoints (POS):**

  * `GET /franchises?updated_since=YYYY-MM-DDTHH:mm:ssZ` → `[ { fid, name, status } ]`
  * `GET /outlets?updated_since=...` → `[ { oid, fid, name, timezone, expiry_date, status, address{...} } ]`
* **Auth:** HTTPS + `Authorization: Bearer <token>`; IP allow-listing from our egress.
* **Renewal trigger source:** `outlet.expiry_date` (no POS push). Scheduler computes `renewal.due_date = expiry_date` and creates reminders.
* **Error handling:** Retry with exponential backoff; write failures to DLQ; admin manual rerun supported.
* **Pseudocode (NestJS Cron):**

```ts
@Cron('0 0 2 * * *', { timeZone: 'Asia/Kuala_Lumpur' })
async syncPOSAndSchedule() {
  await this.posSync.syncFranchises();
  await this.posSync.syncOutlets();
  await this.renewals.refreshFromExpiryDates(60); // days lookahead
}
```

### 9) Frontend (Next.js) — Unified Inbox MVP

* **Views:** Inbox (filters: status/priority/category/assignee/FID/OID), Ticket Detail (threaded messages, internal notes), Renewal Console, Reports.
* **Components:** Message bubble (text/media), reply composer, canned replies, assignment dropdown, SLA chips, CSAT banner.
* **i18n:** EN/BM.

### 10) Observability & Security

* **Logs:** JSON logs to filebeat/ELK (or Loki).
* **Metrics:** /metrics (Prometheus), alerts on webhook failures, 429 rate limit spikes, SLA breach.
* **Hardening:** VPN‑only admin UIs, least‑priv DB users, `STRICT_TRANS_TABLES`, webhook signature verify, rate‑limit on public endpoints, WAF on NGINX, CSP/HTTPS only.

#### Security Controls (Current Implementation)

**Security Headers**
Applied to all routes via `next.config.ts` `headers()` export:
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

**Rate Limiting**
Implemented in `src/lib/rate-limit.ts` and `src/lib/rate-limit-store.ts`.
- **Backend:** Redis client (`redis` npm package) when `REDIS_URL` is set; in-memory `Map` fallback for local development. Throws at startup in production if `REDIS_URL` is missing.
- **IP derivation:** `getRateLimitIp(request)` reads `X-Forwarded-For` only when the `TRUSTED_PROXY` env var is set; otherwise falls back to `"direct"` — prevents IP spoofing via header injection.
- **Limits applied:**

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` | 10 req / 15 min per IP |
| `POST /api/auth/forgot-password` | 5 req / 15 min per IP |
| `POST /api/supportform/submit` | 5 req / 60 s per IP |
| `POST /api/leads` | 3 req / 60 s per IP |
| `POST /api/csat/[token]` | 10 req / 5 min per token |

**Password Policy**
Minimum 12 characters enforced at: account activation, password reset, profile password change, and admin user password-set routes.

**reCAPTCHA**
Fail-closed in production: if `RECAPTCHA_SECRET_KEY` is not set, the demo form `POST` returns HTTP 500 rather than bypassing verification. Local development retains a bypass with a console warning.

**File Upload Viewer Auth**
`GET /api/uploads/view` requires authentication via `requireAuthenticatedUser`. Previously this endpoint was unauthenticated.

**CSS Injection Defence**
`src/components/ui/chart.tsx` validates color values with a `CSS_COLOR_SAFE` regex allowlist before interpolating into `dangerouslySetInnerHTML` CSS blocks. Values that do not match fall back to `"transparent"`.

### 11) Data Migration & Seed

* Apply DDL updates via `schema.sql`; seed **roles**, **categories**, baseline **franchise/outlet** from POS.

### 12) Templates (initial set)

* **CSAT Request:** en/bm variants.
* **Renewal Reminder:** en/bm; parameters: outlet name, due date, payment link.

```plantuml
@startuml
actor Merchant
participant Messaging as WA
participant Webhook as "Webhook API"
queue MQ as "RabbitMQ"
participant Ticket as "Ticket Service"
participant AgentUI as "Agent UI"

Merchant -> WA : message
WA -> Webhook : webhook (POST)
Webhook -> Webhook : verify signature
Webhook -> MQ : publish wa.ingest
MQ -> Ticket : consume
Ticket -> Ticket : create/update ticket (FID/OID)
Ticket -> AgentUI : websocket update
AgentUI -> Merchant : reply via WA (send API)
@enduml
```

## Milestones

**M0 – Project Setup (1 week)**

* Repo, CI/CD, docker-compose baseline, environments, secret management.
* Acceptance: pipeline builds and deploys containers to VPS; health checks green.

**M1 – Messaging Ingest & Ticket Basics (2 weeks)**

* Webhook verify/signature, inbound parsing, ticket creation, basic inbox, assignment, statuses.
* Acceptance: send/receive text; ticket lifecycle; FRT timer starts.

**M2 – POS Sync & FID/OID Resolution (1 week)**

* Daily POS sync (franchises/outlets), contact→FID/OID linking UI.
* Acceptance: POS data present; new tickets auto-tagged with correct FID/OID.

**M3 – Inbox UX, SLAs & Notes (1 week)**

* Collision control, internal notes, canned replies, priority, categories, SLA indicators.
* Acceptance: agents resolve tickets end-to-end; audit log captured.

**M4 – Renewal Scheduler (1 week)**

* Compute renewals from `outlet.expiry_date`, schedule reminders, frequency caps, outcomes.
* Acceptance: outlets within 60 days generate reminders at D-14/D-7/D-1; statuses update on actions.

**M5 – CSAT Flow (0.5 week)**

* Post-resolution CSAT (1–5 + comment) via Messaging; dashboards.
* Acceptance: CSAT responses stored; per-agent and per-FID views.

**M6 – Analytics & Exports (1 week)**

* Volume by category/FID/OID, FRT/ART, CSAT, renewal recovery; CSV export.
* Acceptance: supervisor dashboard reflects last 30 days; scheduled email export.

**M7 – Hardening, Security & UAT (1 week)**

* Rate limits, WAF, VPN-only admin UIs, backup/restore test, load test at 2× expected volume; UAT sign-off.

**M8 – Go-Live (0.5 week)**

* Production cutover, runbooks, on-call, monitoring alerts.

**M9 – Post-launch (ongoing)**

* Tuning templates, add BM translations, agent coaching, backlog grooming.

## Gathering Results

**Success Metrics (from PRD goals)**

* **FRT:** median ≤ 5 minutes (business hours); **ART:** track and target -15% vs baseline.
* **CSAT:** +20% vs baseline within 60 days; response rate ≥ 25%.
* **Renewal recovery:** ≥ 60% of due outlets complete payment within D+7 of expiry.
* **Ops efficiency:** ≥ 40% reduction in manual steps per ticket (time-and-motion sampling).

**Dashboards & Reviews**

* Weekly: SLA breaches, top categories, top merchants by volume, open backlog age.
* Monthly: CSAT trends, renewal outcomes, agent QA sampling.

**Data Quality Checks**

* POS sync drift (counts by FID/OID), orphan contacts, duplicated OIDs, reminder frequency caps.

**Post-Production Monitoring**

* Alerts on webhook error rate, WA 429 spikes, queue backlogs, sync failures, CSAT send failures.

## Need Professional Help in Developing Your Architecture?

Please contact me at [sammuti.com](https://sammuti.com) :)

## Appendix — Ready‑to‑use Artifacts

### 1) SQL Migration — add outlet expiry + renewal source

This repo relies on `schema.sql` for database updates and does not use
separate migration files.

### 2) External scheduler — Daily POS sync + renewal scheduler

Scheduled jobs run via the platform scheduler (for example, Coolify) instead of
an in-app cron service. The scheduler should trigger a backend task or API call
that runs the POS sync and renewal refresh (for example, `POST /api/merchants/import`)
at the required time zone (Asia/Kuala_Lumpur).

**File:** `api/src/scheduler/scheduler.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [CronService, PosSyncService, RenewalService, DistLockService],
  exports: [CronService],
})
export class SchedulerModule {}
```

**File:** `api/src/pos/pos-sync.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class PosSyncService {
  private readonly log = new Logger(PosSyncService.name);
  private readonly base = process.env.POS_BASE_URL!;
  private readonly token = process.env.POS_TOKEN!;

  private async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    const res = await axios.get(`${this.base}${path}`, {
      params,
      headers: { Authorization: `Bearer ${this.token}` },
      timeout: 15000,
    });
    return res.data as T;
  }

  async syncFranchises(): Promise<void> {
    const updatedSince = new Date(Date.now() - 24*60*60*1000).toISOString();
    const items = await this.get<Array<{ fid:number; name:string; status:string }>>('/franchises', { updated_since: updatedSince });
    for (const f of items) {
      await this.upsertFranchise(f);
    }
    this.log.log(`Franchises upserted: ${items.length}`);
  }

  async syncOutlets(): Promise<void> {
    const updatedSince = new Date(Date.now() - 24*60*60*1000).toISOString();
    const items = await this.get<Array<{ oid:number; fid:number; name:string; timezone:string; expiry_date?:string; status:string; address?:any }>>('/outlets', { updated_since: updatedSince });
    for (const o of items) {
      await this.upsertOutlet(o);
    }
    this.log.log(`Outlets upserted: ${items.length}`);
  }

  // Replace with your DB adapter (TypeORM/Prisma/knex). Using plain SQL for clarity.
  private async upsertFranchise(f: {fid:number; name:string; status:string}) {
    await db.execute(
      `INSERT INTO franchise (fid, name, status) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), status=VALUES(status)`,
      [f.fid, f.name, f.status]
    );
  }

  private async upsertOutlet(o: {oid:number; fid:number; name:string; timezone:string; expiry_date?:string; status:string; address?:any}) {
    await db.execute(
      `INSERT INTO outlet (oid, fid, name, timezone, address, expiry_date) VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), timezone=VALUES(timezone), address=VALUES(address), expiry_date=VALUES(expiry_date)`,
      [o.oid, o.fid, o.name, o.timezone, JSON.stringify(o.address||null), o.expiry_date || null]
    );
  }
}
```

**File:** `api/src/renewal/renewal.service.ts`

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class RenewalService {
  async refreshFromExpiryDates(lookaheadDays: number) {
    // 1) Upsert renewal rows for outlets due within lookahead window
    await db.execute(
      `INSERT INTO renewal (fid, oid, cycle_start, due_date, amount_cents, currency, status, source)
       SELECT o.fid, o.oid, DATE_SUB(o.expiry_date, INTERVAL 1 YEAR) AS cycle_start,
              o.expiry_date AS due_date, 0, 'MYR', 'due', 'computed'
       FROM outlet o
       WHERE o.expiry_date IS NOT NULL
         AND o.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
       ON DUPLICATE KEY UPDATE due_date=VALUES(due_date), status=VALUES(status), source='computed'`,
      [lookaheadDays]
    );

    // 2) Schedule Messaging reminders (D-14, D-7, D-1, D+3)
    await this.scheduleReminders();
  }

  private async scheduleReminders() {
    // Example: enqueue jobs; actual implementation uses RabbitMQ bindings
    await mq.publish('renewal.scheduler', { type: 'build-reminders' });
  }
}
```

> The `db`/`mq`/`DistLockService` symbols represent your project’s existing database, queue, and Redis-lock adapters registered in NestJS DI.

---

### 3) Messaging Templates — drafts (EN/BM)

You’ll create these in Messaging Manager (Templates). Use **Category: Utility**.

**A) CSAT request**

* **Name:** `csat_request_v1`
* **Languages:** `en_US`, `ms_MY`
* **Body (EN):**

  > Hi {{1}}, thanks for chatting with {{2}}. Please rate our support **1–5** (5 = excellent). You can just tap a number below and optionally reply with a comment.
* **Body (BM):**

  > Hai {{1}}, terima kasih berbual dengan {{2}}. Sila beri penilaian **1–5** (5 = terbaik). Tekan nombor di bawah dan balas komen jika mahu.
* **Buttons:** Quick replies → `1`, `2`, `3`, `4`, `5`.
* **Example variables:** `{{1}} = Ali`, `{{2}} = Company Support`.
* **Sample send (within 24h window not required since template):**

```json
{
  "messaging_product": "messaging",
  "to": "+60XXXXXXXXX",
  "type": "template",
  "template": {
    "name": "csat_request_v1",
    "language": { "code": "en_US" }
  }
}
```

**B) Renewal reminder (D-14/D-7/D-1)**

* **Name:** `renewal_reminder_v1`
* **Languages:** `en_US`, `ms_MY`
* **Body (EN):**

  > {{1}} — your subscription for **{{2}}** is due on **{{3}}**. Please complete payment here: {{4}}. Reply if you need help.
* **Body (BM):**

  > {{1}} — langganan untuk **{{2}}** akan tamat pada **{{3}}**. Sila buat bayaran di sini: {{4}}. Balas jika perlukan bantuan.
* **Variables:** `{{1}} = Franchise/Brand`, `{{2}} = Outlet Name`, `{{3}} = Due Date (e.g., 28 Feb 2026)`, `{{4}} = Payment URL`.

**C) Renewal overdue (D+3)**

* **Name:** `renewal_overdue_v1`
* **Body (EN):**

  > Reminder: **{{2}}** for {{1}} expired on **{{3}}**. Use {{4}} to renew now to avoid service interruption.
* **Body (BM):**

  > Peringatan: **{{2}}** untuk {{1}} telah tamat pada **{{3}}**. Guna {{4}} untuk perbaharui sekarang untuk elak gangguan perkhidmatan.

**Send API example (same as above, change `template.name` and language).**

**Delivery & frequency caps (enforced by app):**

* Max **3 outstanding reminders** per renewal cycle.
* Stop sending once merchant replies or status becomes `paid/cancelled`.

---

### 4) Optional — NGINX location for Messaging webhook verify

**File:** `deploy/nginx/conf.d/messaging.conf`

```nginx
server {
  listen 443 ssl http2;
  server_name eng.example.my;

  # TLS config omitted for brevity

  location /webhook/messaging {
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_pass http://api:8080/webhook/messaging;
    # Basic rate limiting
    limit_req zone=public burst=120 nodelay;
  }
}
```

That’s it — these artifacts map 1:1 to the design above and are ready for your contractors to drop into the repo.
