# LifeMap compliance operations (DPDP Act / CERT-In)

This is the operational companion to the code. It lists what **people and infrastructure** must do; the code
only provides the hooks. Items marked **CONFIRM** need an owner to verify against the live environment before
the Privacy Notice is published as final.

## 1. Roles and configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `PRIVACY_CONTACT` | backend env | Grievance mailbox (current: `arunwealthmanagement@gmail.com`) |
| `PRIVACY_CONTACT_NAME` | backend env | Grievance officer name (current: `Arun Mandal`) |
| `APP_BASE_URL` | backend env | `https://lifemap.finance` — used in emailed invite/reset links |
| `DATA_HOSTING_REGION` | backend env | Shown in Privacy Notice §5. **Confirmed 2026-11-18:** `Oregon, United States (Render)` (web service region Oregon / US West). |
| `LOG_ARCHIVE_RETENTION_DAYS` | backend env | Daily CSV snapshots kept this many days (default `400`). |
| `LOG_ARCHIVE_NOTIFY_EMAIL` | backend env | Who gets a short email after each daily archive (default `amit@boxwealth.in,arun@boxwealth.in`). |
| `LOG_ARCHIVE_WEBHOOK_URL` | backend env (optional) | If set, each day’s CSV is also POSTed as JSON to this URL (S3/R2 proxy, Zapier, etc.). |
| `TOTP_ENC_KEY` | backend env (optional) | Encrypts staff authenticator secrets. Falls back to `JWT_SECRET`. |
| `JWT_SECRET` | backend env | Signs sessions and OTP hashes |
| Super Admin email | DB `super_admin.email` | Login OTP destination. Current: `arun@boxwealth.in` (set via Super Admin → Account, or SQL). |

`GET /api/privacy-meta` returns `contactName`, `contactEmail`, `hostingRegion`, `version`.

## 2. CERT-In incident reporting (6 hours)

CERT-In Directions (28 April 2022) require reporting specified cyber incidents **within 6 hours of noticing
them**. Reporting is by email to `incident@cert-in.org.in` (also `1800-11-4949`), using CERT-In's form.

**Incident owners (BOX Wealth):**

| Role | Person | Email |
| --- | --- | --- |
| Primary | Amit | `amit@boxwealth.in` |
| Backup | Arun | `arun@boxwealth.in` |

Process:

1. **Detect / triage (T+0).** Anyone who suspects an incident (unexpected admin lockouts, spikes of `failed_login`
   or `account_locked` in the activity log, unusual `plan_view` by staff, data exposure, malware, defacement,
   unauthorised access to the database) emails **Amit** (`amit@boxwealth.in`) and copies **Arun**
   (`arun@boxwealth.in`), and pages engineering. Super admins already receive an email when a staff account is locked.
2. **Decide (by T+2h).** Amit (or Arun if Amit is unavailable) decides whether it is a reportable incident
   under the CERT-In list (e.g. unauthorised access to IT systems or data, data breach / leak, compromise of
   critical systems, attacks on applications).
3. **Report to CERT-In (by T+6h).** Amit (or Arun as backup) sends the incident form. Include time of detection,
   systems affected, type of incident, indicators of compromise and mitigation so far. Missing details can follow;
   the 6-hour clock does not wait.
4. **Contain and preserve.** Revoke sessions (`revokeAllSessions` / lock accounts), rotate secrets (`JWT_SECRET`,
   DB credentials), and **do not delete or edit logs**. Snapshot the database and application logs.
5. **Personal data breach (DPDP).** If personal data is affected, the privacy officer (Arun Mandal) notifies the Data
   Protection Board and each affected user as the DPDP Act and Rules require. Record the decision either way.
   **CONFIRM** the current Rule timelines with counsel.
6. **Close out.** Post-incident review within 14 days; record root cause, timeline and fixes.

Keep a register of every incident (reported or not) with timestamps; CERT-In can ask for it.

## 3. Database encryption at rest (Render Postgres)

- LifeMap uses Render-managed PostgreSQL (`DATABASE_URL`, connections use TLS). Render encrypts managed
  Postgres disks and backups at rest; there is nothing to enable in the application.
- **CONFIRM** in the Render dashboard / current Render security documentation that encryption at rest applies
  to the specific plan in use, and keep a screenshot or link in the compliance folder.
- If the database moves (e.g. AWS, see `AWS_HANDOVER.md`), enable storage encryption (RDS: "Encryption" with
  KMS) at creation; it cannot be switched on later without a snapshot restore.
- Application-level protection already in place: passwords are bcrypt-hashed, OTPs and reset tokens are stored
  as HMAC hashes, and staff TOTP secrets are encrypted (AES-256-GCM) in `admin.totp_secret` / `super_admin.totp_secret`.

## 4. Log retention (180 days now; 1 year from May 2027)

BOX confirmed logs **do not need to be stored in India**. Retention required: **180 days now**, and **1 year from May 2027**.

There are **two kinds of logs**. Do not confuse them.

### A. Application audit trail — implemented

| Store | What | Retention |
| --- | --- | --- |
| `activity_log` | Live append-only audit (sign-ins, failed logins, plan views/edits, transfers, privacy, restores) | Never deleted by the app; keep ≥ 1 year |
| `activity_log_archive` | Nightly UTC-day CSV snapshot (job in `backend/lib/logArchive.js`) | Default **400 days**, then pruned |

- Job runs on boot and every 24 hours.
- Super Admin → **Activity log → Daily archives** can download any day or run “Archive yesterday now”.
- Email notice goes to Amit + Arun after each new day is archived (`LOG_ARCHIVE_NOTIFY_EMAIL`).
- Optional offsite copy: set `LOG_ARCHIVE_WEBHOOK_URL` (and optional `LOG_ARCHIVE_WEBHOOK_TOKEN`) so each day’s CSV is POSTed as JSON.
- Deleting a client never deletes their log rows.

**Status (2026-11-18):** daily archive path is live in code. Hosting region confirmed Oregon. No India residency requirement.

### B. Render platform / server logs (HTTP, deploy, crash) — only 7–30 days in Render UI

These are operational logs. They are **not** covered by `activity_log`. For long retention of crash/HTTP noise:

1. In Render → workspace **Observability → Log Streams** (or the service **Log Streams** setting), add a destination.
2. Prefer a provider that can keep logs ≥ 180 days (Axiom, Papertrail, CloudWatch/S3). Better Stack’s free tier only keeps **3 days** — fine for live tail, not enough alone for CERT-In.
3. Document the provider, retention days, and who has access below when enabled.

**Not enough alone:** relying only on the Render dashboard log viewer.

### Dated note

- **2026-11-18** — Region confirmed Oregon (US West) on `lifemaps-backend`. Daily `activity_log_archive` job added (400-day retention). Render Log Streams for platform logs still optional / pending.

### Retention: soft-deleted data and legal hold

- Deleted clients, admins and plan entries (goals, expenses, loans, assets, work assets, planned loans,
  insurance) are **soft-deleted** into `deleted_items` and can be restored by a super admin for **90 days**.
- A scheduled job (on boot and every 24 hours, `purgeExpiredDeletedItems`) permanently removes items past
  `purge_after`.
- **Legal hold:** a super admin can place any deleted item on legal hold (Deleted items tab, or
  `POST /api/admin/deleted-items/:id/legal-hold`). Held items (`deleted_items.legal_hold = TRUE`) are skipped by
  the scheduled purge and cannot be purged manually until the hold is released. Place a hold when a regulator,
  court or investigation requires records to be preserved, and log the reason in the incident / legal register.

## 5. Time synchronisation (NTP)

CERT-In requires all ICT clocks to be synchronised to NTP servers of NIC or NPL (or servers traceable to them),
so log timestamps are trustworthy.

- Render and most cloud hosts keep instance clocks in sync via the provider's time service. **CONFIRM** which
  source the host uses; if a CERT-In-aligned source is required, point chrony / `systemd-timesyncd` at
  `samay1.nic.in` / `samay2.nic.in` (NIC) or `time.nplindia.org` (NPL) on any self-managed server.
- The database writes timestamps with `NOW()`; the app server clock is not used for audit times.
- Staff authenticator codes (TOTP) need roughly accurate clocks (the server accepts +/- 30 seconds).

## 6. Staff access controls (summary)

- Email OTP on every sign-in; optional authenticator app (TOTP) for admins and super admins
  (`/api/totp/*`). Wrong codes count towards the 5-attempt lockout and are logged as `failed_login`.
- Changing a staff username, email or password requires the current password **and** an emailed code; the
  account's email address is alerted.
- Periodic access review (`Access review` tab) records each admin decision (Keep / Deactivate) in
  `access_review_decision` and the activity log. Do this at least quarterly.
- Associate change (`Access review` tab): moves all clients from the outgoing associate to the incoming one,
  deactivates and signs out the outgoing associate, and emails the incoming associate a password link.
- Clients cannot be transferred to "unassigned"; a transfer always names an active admin.

## 7. Privacy Notice / Terms handover

Working notice is version **`v1.1-2026-11-18`** (Arun’s revised draft: DPDP rights, consent, storage location, 18+).
Grievance contact for now: **Arun Mandal**, `arunwealthmanagement@gmail.com`.

Before treating it as final:

1. Legal counsel reviews and approves (including governing-law city in Terms).
2. Confirm `DATA_HOSTING_REGION` matches Render → Postgres → Info → Region.
3. Set production env: `PRIVACY_CONTACT`, `PRIVACY_CONTACT_NAME`, `APP_BASE_URL`, `DATA_HOSTING_REGION`.
4. Set Super Admin OTP email to `arun@boxwealth.in`.
5. If the final legal text changes, bump `PRIVACY_NOTICE_VERSION` and decide whether existing users must re-consent.
6. Archive the approved PDF and record who approved it and when.
