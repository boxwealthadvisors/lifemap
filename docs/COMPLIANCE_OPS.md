# LifeMap compliance operations (DPDP Act / CERT-In)

This is the operational companion to the code. It lists what **people and infrastructure** must do; the code
only provides the hooks. Items marked **CONFIRM** need an owner to verify against the live environment before
the Privacy Notice is published as final.

## 1. Roles and configuration

| Setting | Where | Purpose |
| --- | --- | --- |
| `PRIVACY_CONTACT` | backend env | Grievance / privacy mailbox (default `privacy@boxwealth.in`) |
| `PRIVACY_CONTACT_NAME` | backend env | Name shown with the mailbox (default `BOX Wealth Privacy Officer`). Set to the real officer's name. |
| `APP_BASE_URL` | backend env | Base URL used in emailed links and `/api/privacy-meta` |
| `TOTP_ENC_KEY` | backend env (optional) | Key used to encrypt staff authenticator-app secrets at rest. Falls back to `JWT_SECRET`. Rotating it forces staff to re-enrol their authenticator app. |
| `JWT_SECRET` | backend env | Signs sessions and OTP hashes |

`GET /api/privacy-meta` returns `contactName`, `contactEmail` (and the legacy `contact`) for the Privacy Notice
and Privacy & Data pages.

## 2. CERT-In incident reporting (6 hours)

CERT-In Directions (28 April 2022) require reporting specified cyber incidents **within 6 hours of noticing
them**. Reporting is by email to `incident@cert-in.org.in` (also `1800-11-4949`), using CERT-In's form.

Process:

1. **Detect / triage (T+0).** Anyone who suspects an incident (unexpected admin lockouts, spikes of `failed_login`
   or `account_locked` in the activity log, unusual `plan_view` by staff, data exposure, malware, defacement,
   unauthorised access to the database) raises it in the engineering incident channel and pages the on-call
   engineer. Super admins already receive an email when a staff account is locked.
2. **Decide (by T+2h).** The incident owner (CTO or delegate) decides whether it is a reportable incident
   under the CERT-In list (e.g. unauthorised access to IT systems or data, data breach / leak, compromise of
   critical systems, attacks on applications).
3. **Report to CERT-In (by T+6h).** Send the incident form. Include time of detection, systems affected, type of
   incident, indicators of compromise and mitigation so far. Missing details can follow; the 6-hour clock does not wait.
4. **Contain and preserve.** Revoke sessions (`revokeAllSessions` / lock accounts), rotate secrets (`JWT_SECRET`,
   DB credentials), and **do not delete or edit logs**. Snapshot the database and application logs.
5. **Personal data breach (DPDP).** If personal data is affected, the privacy officer notifies the Data
   Protection Board and each affected user as the DPDP Act and Rules require (content and timelines per the
   Rules in force at the time). Record the decision either way. **CONFIRM** the current Rule timelines with counsel.
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

## 4. Log residency (India) and retention

- **CERT-In requires ICT system logs to be maintained within Indian jurisdiction for 180 days** (and they must be
  producible on request). LifeMap's audit trail lives in the `activity_log` table in the same database.
  **CONFIRM** the Render region of the database and web service. If it is not an Indian region, either move
  hosting to an Indian region or ship logs to storage in India (e.g. an S3 bucket in `ap-south-1`) and keep that copy.
- Platform and request logs (Render log streams) are separate from `activity_log`; if they are retained
  outside India, forward a copy to an Indian store as above.

### Retention: do not truncate `activity_log`

- Retain `activity_log` entries for **at least one year** (this also covers CERT-In's 180 days).
- `activity_log` is **append-only**: the application only `INSERT`s and `SELECT`s. There are no `UPDATE`,
  `DELETE` or `TRUNCATE` statements against it and none must be added. Do not "clean up" the table, do not
  shorten retention in a migration, and do not add `ON DELETE CASCADE` links that remove rows.
- If the table grows too large, archive rows **older than one year** to cold storage (kept in India) as a
  deliberate, ticketed DBA task, never by an automated job in the app.
- Deletion of a client never deletes their log entries; the log is the audit evidence.

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

## 7. Final Privacy Notice handover

The text in `src/pages/PrivacyPage.jsx` is a **placeholder** (version `v1.0-2026-11-16`). Before launch:

1. Legal counsel reviews and approves the notice (purposes, categories of data, sharing, retention, rights,
   grievance process, cross-border transfers, children's data, breach notification).
2. Replace the placeholder copy; remove the "placeholder" line; set the real effective date.
3. Bump `PRIVACY_NOTICE_VERSION` in `backend/lib/security.js` and `PRIVACY_NOTICE_VERSION_FALLBACK` in
   `src/lib/password.js` so new sign-ups record consent to the final version. Decide whether existing users must
   re-consent.
4. Set `PRIVACY_CONTACT` and `PRIVACY_CONTACT_NAME` in production to the real grievance officer and mailbox,
   and confirm the mailbox is monitored. The notice, sign-up screen and Privacy & Data page all read these values.
5. Make sure the sign-up blurb in `AuthModal.jsx` still matches the final notice (what data, why, who at BOX can
   see it: assigned relationship manager, BOX operations staff, privacy officer).
6. Confirm the 90-day request response window and 90-day soft-delete window stated in the notice match practice.
7. Publish at `/privacy`, archive the approved PDF, and record who approved it and when.
