import pool from '../config/database.js'
import { sendMail } from './mailer.js'
import { logActivity } from './security.js'

/** Keep daily CSV snapshots at least this long (covers 180 days now and 1 year from May 2027). */
export const LOG_ARCHIVE_RETENTION_DAYS = Number(process.env.LOG_ARCHIVE_RETENTION_DAYS || 400)

function csvCell(value) {
  if (value == null) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function dayBoundsUtc(dayStr) {
  const start = new Date(`${dayStr}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

function yesterdayUtc() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

async function buildDayCsv(dayStr) {
  const { start, end } = dayBoundsUtc(dayStr)
  const result = await pool.query(
    `SELECT id, created_at, actor_role, actor_id, actor_label, action,
            target_type, target_id, team_admin_id, meta
     FROM activity_log
     WHERE created_at >= $1 AND created_at < $2
     ORDER BY created_at ASC, id ASC`,
    [start, end]
  )
  const header = [
    'id', 'created_at', 'actor_role', 'actor_id', 'actor_label', 'action',
    'target_type', 'target_id', 'team_admin_id', 'meta',
  ]
  const lines = [header.join(',')]
  for (const row of result.rows) {
    lines.push([
      row.id,
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      row.actor_role,
      row.actor_id,
      row.actor_label,
      row.action,
      row.target_type,
      row.target_id,
      row.team_admin_id,
      JSON.stringify(row.meta || {}),
    ].map(csvCell).join(','))
  }
  return { rowCount: result.rows.length, csv: `${lines.join('\r\n')}\r\n` }
}

async function postWebhook(dayStr, rowCount, csv) {
  const url = process.env.LOG_ARCHIVE_WEBHOOK_URL
  if (!url) return false
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.LOG_ARCHIVE_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.LOG_ARCHIVE_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      source: 'lifemap',
      type: 'activity_log_daily_archive',
      day: dayStr,
      rowCount,
      csv,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LOG_ARCHIVE_WEBHOOK_URL failed (${res.status}): ${body.slice(0, 200)}`)
  }
  return true
}

async function notifyOwners(dayStr, rowCount) {
  const to = process.env.LOG_ARCHIVE_NOTIFY_EMAIL
    || 'amit@boxwealth.in,arun@boxwealth.in'
  const recipients = String(to).split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
  if (!recipients.length) return
  const subject = `LifeMap activity log archived for ${dayStr} (${rowCount} rows)`
  const text = [
    `The LifeMap daily activity_log archive for ${dayStr} is ready.`,
    `Rows archived: ${rowCount}`,
    '',
    'Download from Super Admin → Activity log → Daily archives,',
    'or GET /api/admin/activity-log/archives/:day.csv',
    '',
    'Live activity_log rows are never deleted by this job.',
  ].join('\n')
  for (const recipient of recipients) {
    try {
      await sendMail({ to: recipient, subject, text, html: `<p>${text.replace(/\n/g, '<br>')}</p>` })
    } catch (error) {
      console.warn('[log-archive] notify failed for', recipient, error.message)
    }
  }
}

/**
 * Snapshot one UTC calendar day of activity_log into activity_log_archive.
 * Idempotent: skips if that day is already archived.
 * Never deletes or updates activity_log.
 */
export async function archiveActivityLogDay(dayStr = yesterdayUtc()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
    throw new Error(`Invalid archive day: ${dayStr}`)
  }

  const existing = await pool.query(
    'SELECT id, row_count FROM activity_log_archive WHERE day = $1::date',
    [dayStr]
  )
  if (existing.rows[0]) {
    return { day: dayStr, skipped: true, rowCount: existing.rows[0].row_count, id: existing.rows[0].id }
  }

  const { rowCount, csv } = await buildDayCsv(dayStr)
  const inserted = await pool.query(
    `INSERT INTO activity_log_archive (day, row_count, csv_content)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO NOTHING
     RETURNING id, row_count`,
    [dayStr, rowCount, csv]
  )
  if (!inserted.rows[0]) {
    const again = await pool.query(
      'SELECT id, row_count FROM activity_log_archive WHERE day = $1::date',
      [dayStr]
    )
    return { day: dayStr, skipped: true, rowCount: again.rows[0]?.row_count || rowCount, id: again.rows[0]?.id }
  }

  let webhook = false
  try {
    webhook = await postWebhook(dayStr, rowCount, csv)
  } catch (error) {
    console.error('[log-archive] webhook failed:', error.message)
  }

  try {
    await notifyOwners(dayStr, rowCount)
  } catch (error) {
    console.error('[log-archive] notify failed:', error.message)
  }

  await logActivity({
    action: 'activity_log_archived',
    targetType: 'activity_log_archive',
    targetId: inserted.rows[0].id,
    meta: { day: dayStr, rowCount, webhook },
  })

  return { day: dayStr, skipped: false, rowCount, id: inserted.rows[0].id, webhook }
}

/** Drop archive snapshots older than retention. Never touches activity_log. */
export async function pruneOldLogArchives() {
  const result = await pool.query(
    `DELETE FROM activity_log_archive
     WHERE day < (CURRENT_DATE - ($1::int || ' days')::interval)
     RETURNING day`,
    [LOG_ARCHIVE_RETENTION_DAYS]
  )
  return { removed: result.rowCount }
}

/** Run yesterday's archive + prune. Safe to call on a daily timer. */
export async function runDailyLogArchive() {
  try {
    const archived = await archiveActivityLogDay()
    const pruned = await pruneOldLogArchives()
    console.log(
      `[log-archive] day=${archived.day} rows=${archived.rowCount} skipped=${archived.skipped} pruned=${pruned.removed}`
    )
    return { archived, pruned }
  } catch (error) {
    console.error('[log-archive] daily job failed:', error.message)
    return { error: error.message }
  }
}

export async function listLogArchives({ limit = 60, offset = 0 } = {}) {
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM activity_log_archive')
  const rows = await pool.query(
    `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, row_count, created_at,
            octet_length(csv_content) AS bytes
     FROM activity_log_archive
     ORDER BY day DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return { total: count.rows[0].total, archives: rows.rows }
}

export async function getLogArchiveCsv(dayStr) {
  const result = await pool.query(
    `SELECT day, row_count, csv_content, created_at
     FROM activity_log_archive WHERE day = $1::date`,
    [dayStr]
  )
  return result.rows[0] || null
}
