import crypto from 'crypto'
import pool from '../config/database.js'
import { sendMail } from './mailer.js'

export const PRIVACY_NOTICE_VERSION = 'v1.0-2026-11-16'
export const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'https://lifemap.finance').replace(/\/$/, '')
export const PRIVACY_CONTACT = process.env.PRIVACY_CONTACT || 'privacy@boxwealth.in'
export const LOCKOUT_MS = 15 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5
export const OTP_TTL_MS = 10 * 60 * 1000
export const RESET_TTL_MS = 15 * 60 * 1000
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000
export const SOFT_DELETE_DAYS = 90

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', 'qwerty123',
  'welcome1', 'admin123', 'letmein1', 'lifemap123', 'boxwealth', 'boxwealth1',
])

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function isBoxWealthEmail(email) {
  return /@boxwealth\.in$/i.test(normalizeEmail(email))
}

export function validateStrongPassword(password) {
  const p = String(password || '')
  if (p.length < 8) return 'Password must be at least 8 characters'
  if (!/[a-z]/.test(p)) return 'Password must include a lowercase letter'
  if (!/[A-Z]/.test(p)) return 'Password must include an uppercase letter'
  if (!/[0-9]/.test(p)) return 'Password must include a number'
  if (!/[^A-Za-z0-9]/.test(p)) return 'Password must include a special character'
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return 'Choose a less common password'
  return null
}

function hashSecret(value) {
  const secret = process.env.JWT_SECRET || 'lifemap-otp'
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex')
}

export function hashOtp(email, code) {
  return hashSecret(`${normalizeEmail(email)}:${code}`)
}

export function hashToken(token) {
  return hashSecret(token)
}

export function otpMatches(email, code, storedHash) {
  const a = Buffer.from(hashOtp(email, code))
  const b = Buffer.from(String(storedHash || ''), 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function newJti() {
  return crypto.randomBytes(24).toString('hex')
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function newPrivacyRef() {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `PR-${stamp}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
}

export async function logActivity({
  actorRole = null,
  actorId = null,
  actorLabel = null,
  action,
  targetType = null,
  targetId = null,
  teamAdminId = null,
  meta = {},
}) {
  try {
    await pool.query(
      `INSERT INTO activity_log
        (actor_role, actor_id, actor_label, action, target_type, target_id, team_admin_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [actorRole, actorId, actorLabel, action, targetType, targetId, teamAdminId, JSON.stringify(meta || {})]
    )
  } catch (error) {
    console.error('activity_log insert failed', error.message)
  }
}

export function isLocked(row) {
  if (!row?.locked_until) return false
  return new Date(row.locked_until).getTime() > Date.now()
}

export async function registerFailure(tableSql, id) {
  const result = await pool.query(
    `UPDATE ${tableSql}
     SET failed_attempts = COALESCE(failed_attempts, 0) + 1,
         locked_until = CASE
           WHEN COALESCE(failed_attempts, 0) + 1 >= $2 THEN NOW() + ($3 || ' milliseconds')::interval
           ELSE locked_until
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING failed_attempts, locked_until`,
    [id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MS)]
  )
  return result.rows[0]
}

export async function clearFailures(tableSql, id) {
  await pool.query(
    `UPDATE ${tableSql}
     SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id]
  )
}

export async function alertSuperAdmins(subject, text) {
  try {
    const result = await pool.query(
      `SELECT email FROM super_admin WHERE email IS NOT NULL AND TRIM(email) <> ''`
    )
    for (const row of result.rows) {
      await sendMail({ to: row.email, subject, text, html: `<p>${text}</p>` })
    }
  } catch (error) {
    console.error('alertSuperAdmins failed', error.message)
  }
}

export async function issueOtp(email, purpose) {
  const normalized = normalizeEmail(email)
  const latest = await pool.query(
    `SELECT created_at FROM email_otp
     WHERE email = $1 AND purpose = $2
     ORDER BY created_at DESC LIMIT 1`,
    [normalized, purpose]
  )
  const lastSent = latest.rows[0]?.created_at ? new Date(latest.rows[0].created_at).getTime() : 0
  if (lastSent && Date.now() - lastSent < 45 * 1000) {
    return { error: 'Wait a moment before requesting another code.', status: 429 }
  }
  const code = String(crypto.randomInt(100000, 1000000))
  await pool.query(
    `UPDATE email_otp SET consumed_at = NOW()
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [normalized, purpose]
  )
  await pool.query(
    `INSERT INTO email_otp (email, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [normalized, hashOtp(normalized, code), purpose, new Date(Date.now() + OTP_TTL_MS)]
  )
  return { email: normalized, code }
}

export async function consumeOtp(email, purpose, code) {
  const normalized = normalizeEmail(email)
  const clean = String(code || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) {
    return { error: 'Enter the 6-digit code we emailed you', status: 400 }
  }
  const result = await pool.query(
    `SELECT id, code_hash, expires_at, attempts
     FROM email_otp
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [normalized, purpose]
  )
  const row = result.rows[0]
  if (!row) return { error: 'Enter the code we emailed you', status: 400 }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: 'That code has expired. Request a new one.', status: 400 }
  }
  if ((row.attempts || 0) >= MAX_FAILED_ATTEMPTS) {
    return { error: 'Too many incorrect codes. Request a new one.', status: 400 }
  }
  if (!otpMatches(normalized, clean, row.code_hash)) {
    await pool.query('UPDATE email_otp SET attempts = attempts + 1 WHERE id = $1', [row.id])
    return { error: 'That code is incorrect', status: 400 }
  }
  await pool.query('UPDATE email_otp SET consumed_at = NOW() WHERE id = $1', [row.id])
  return { id: row.id, email: normalized }
}

export async function createSession({ role, subjectId, jti, userAgent, ip }) {
  await pool.query(
    `INSERT INTO auth_session (jti, role, subject_id, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [jti, role, subjectId, userAgent || null, ip || null]
  )
}

export async function revokeAllSessions(role, subjectId) {
  await pool.query(
    `UPDATE auth_session SET revoked_at = NOW()
     WHERE role = $1 AND subject_id = $2 AND revoked_at IS NULL`,
    [role, subjectId]
  )
  const table = role === 'client' ? 'public."user"' : role === 'admin' ? 'admin' : 'super_admin'
  await pool.query(
    `UPDATE ${table} SET session_version = COALESCE(session_version, 1) + 1, updated_at = NOW() WHERE id = $1`,
    [subjectId]
  )
}

export async function touchSession(jti) {
  if (!jti) return
  await pool.query(
    `UPDATE auth_session SET last_seen_at = NOW()
     WHERE jti = $1 AND revoked_at IS NULL`,
    [jti]
  )
}

export async function isSessionValid(jti, role, subjectId) {
  if (!jti) return false
  const result = await pool.query(
    `SELECT id, revoked_at FROM auth_session
     WHERE jti = $1 AND role = $2 AND subject_id = $3 LIMIT 1`,
    [jti, role, subjectId]
  )
  const row = result.rows[0]
  return !!(row && !row.revoked_at)
}

export async function createResetOrInviteToken({ role, subjectId, email, purpose, ttlMs }) {
  const token = newToken()
  await pool.query(
    `UPDATE password_reset_token SET used_at = NOW()
     WHERE role = $1 AND subject_id = $2 AND purpose = $3 AND used_at IS NULL`,
    [role, subjectId, purpose]
  )
  await pool.query(
    `INSERT INTO password_reset_token (role, subject_id, email, token_hash, purpose, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [role, subjectId, normalizeEmail(email), hashToken(token), purpose, new Date(Date.now() + ttlMs)]
  )
  return token
}

export async function consumeResetToken(token, purposes) {
  const list = Array.isArray(purposes) ? purposes : [purposes]
  const result = await pool.query(
    `SELECT * FROM password_reset_token
     WHERE token_hash = $1 AND purpose = ANY($2::text[]) AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [hashToken(token), list]
  )
  const row = result.rows[0]
  if (!row) return { error: 'This link is invalid or already used', status: 400 }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: 'This link has expired', status: 400 }
  }
  await pool.query('UPDATE password_reset_token SET used_at = NOW() WHERE id = $1', [row.id])
  return { row }
}

export async function softDeleteEntity({
  entityType,
  entityId,
  payload,
  deletedByRole,
  deletedById,
  reason,
}) {
  const purgeAfter = new Date(Date.now() + SOFT_DELETE_DAYS * 24 * 60 * 60 * 1000)
  const result = await pool.query(
    `INSERT INTO deleted_items
      (entity_type, entity_id, payload, deleted_by_role, deleted_by_id, reason, purge_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [entityType, entityId, JSON.stringify(payload), deletedByRole, deletedById, reason || null, purgeAfter]
  )
  return result.rows[0]
}

export async function purgeExpiredDeletedItems() {
  try {
    const result = await pool.query(
      `SELECT id, entity_type, entity_id FROM deleted_items
       WHERE restored_at IS NULL AND purge_after IS NOT NULL AND purge_after < NOW()`
    )
    for (const row of result.rows) {
      if (row.entity_type === 'user') {
        await pool.query('DELETE FROM public."user" WHERE id = $1 AND deleted_at IS NOT NULL', [row.entity_id])
      } else if (row.entity_type === 'admin') {
        await pool.query('DELETE FROM admin WHERE id = $1 AND deleted_at IS NOT NULL', [row.entity_id])
      }
      await logActivity({
        action: 'permanent_purge',
        targetType: row.entity_type,
        targetId: row.entity_id,
        meta: { deletedItemId: row.id },
      })
      await pool.query('DELETE FROM deleted_items WHERE id = $1', [row.id])
    }
  } catch (error) {
    console.error('purgeExpiredDeletedItems failed', error.message)
  }
}

export function resetLink(token, kind = 'reset') {
  const path = kind === 'invite' ? '/set-password' : '/reset-password'
  return `${APP_BASE_URL}${path}?token=${encodeURIComponent(token)}`
}

export async function sendOtpMail(email, code, purpose) {
  const labels = {
    signup: 'sign-up',
    login: 'sign-in',
    sensitive: 'security',
  }
  const label = labels[purpose] || 'verification'
  await sendMail({
    to: email,
    subject: `Your LifeMap ${label} code`,
    text: `Your LifeMap verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`,
    html: `<p>Your LifeMap verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`,
  })
}
