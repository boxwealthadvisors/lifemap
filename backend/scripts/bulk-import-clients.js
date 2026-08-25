#!/usr/bin/env node
/**
 * Bulk-import clients into Render Postgres.
 *
 * Do NOT paste hundreds of INSERTs into Render Shell.
 * Convert Arun's xlsx/csv dumps into the templates in import-templates/,
 * then run this from a machine that has the files:
 *
 *   cd backend
 *   set DATABASE_URL=postgresql://...render.com/...   (External URL, with SSL)
 *   node scripts/bulk-import-clients.js --dry-run --admin-username YOUR_ADMIN --users ./clients/users.csv
 *   node scripts/bulk-import-clients.js --admin-username YOUR_ADMIN --users ./clients/users.csv --assets ./clients/assets.csv --out ./clients/passwords.csv
 *
 * Never commit DATABASE_URL or passwords.csv.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  return process.argv[i + 1] || fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function die(message) {
  console.error(message)
  process.exit(1)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  const src = String(text).replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      if (row.some((v) => String(v).trim() !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (ch !== '\r') cell += ch
  }
  if (cell.length || row.length) {
    row.push(cell)
    if (row.some((v) => String(v).trim() !== '')) rows.push(row)
  }
  if (!rows.length) return []
  const headers = rows[0].map((h) => String(h || '').trim().toLowerCase().replace(/\s+/g, '_'))
  return rows.slice(1).map((values) => {
    const obj = {}
    headers.forEach((key, idx) => {
      obj[key] = values[idx] == null ? '' : String(values[idx]).trim()
    })
    return obj
  })
}

function readTable(filePath) {
  if (!filePath) return []
  const abs = path.resolve(filePath)
  if (!fs.existsSync(abs)) die(`File not found: ${abs}`)
  if (/\.xlsx?$/i.test(abs)) {
    die(`Pass CSV, not Excel. Save "${path.basename(abs)}" as CSV first (or have Claude convert the sheet).`)
  }
  return parseCsv(fs.readFileSync(abs, 'utf8'))
}

function emailOf(row) {
  return String(row.email || row.e_mail || row.mail || '').trim().toLowerCase()
}

function asNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback
  let text = String(value).trim().replace(/,/g, '').replace(/₹/g, '').replace(/rs\.?/i, '')
  const cr = /([0-9.]+)\s*cr/i.exec(text)
  if (cr) return Number(cr[1]) * 10000000
  const lakh = /([0-9.]+)\s*l(?:ac|akh)?/i.exec(text)
  if (lakh) return Number(lakh[1]) * 100000
  text = text.replace(/%/g, '')
  const n = Number(text)
  return Number.isFinite(n) ? n : fallback
}

function asRate(value, fallback = 0) {
  const n = asNumber(value, fallback)
  if (!Number.isFinite(n)) return fallback
  return n > 1 ? n / 100 : n
}

function password() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12)
}

function groupByEmail(rows) {
  const map = new Map()
  for (const row of rows) {
    const email = emailOf(row)
    if (!email) continue
    if (!map.has(email)) map.set(email, [])
    map.get(email).push(row)
  }
  return map
}

async function main() {
  const dryRun = hasFlag('--dry-run')
  const usersPath = arg('--users')
  const adminUsername = arg('--admin-username')
  const adminIdArg = arg('--admin-id')
  const outPath = arg('--out', path.resolve('passwords.csv'))
  if (!usersPath) {
    die(`Usage:
  node scripts/bulk-import-clients.js --admin-username ADVISOR --users users.csv [--assets a.csv] [--work-assets w.csv] [--goals g.csv] [--loans l.csv] [--planned-loans p.csv] [--expenses e.csv] [--insurance i.csv] [--out passwords.csv] [--dry-run]

DATABASE_URL must be the Render Postgres External URL.`)
  }
  if (!process.env.DATABASE_URL) die('Set DATABASE_URL to the Render External Database URL first.')

  const users = readTable(usersPath)
  const assets = groupByEmail(readTable(arg('--assets')))
  const work = groupByEmail(readTable(arg('--work-assets')))
  const goals = groupByEmail(readTable(arg('--goals')))
  const loans = groupByEmail(readTable(arg('--loans')))
  const planned = groupByEmail(readTable(arg('--planned-loans')))
  const expenses = groupByEmail(readTable(arg('--expenses')))
  const insurance = groupByEmail(readTable(arg('--insurance')))

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  })

  const client = await pool.connect()
  try {
    let adminId = adminIdArg ? Number(adminIdArg) : null
    if (!adminId) {
      if (!adminUsername) die('Pass --admin-username or --admin-id so clients show in that advisor’s list.')
      const found = await client.query('SELECT id, username, name FROM admin WHERE username = $1', [adminUsername])
      if (!found.rows.length) die(`No admin row for username "${adminUsername}". Create the advisor first.`)
      adminId = found.rows[0].id
      console.log(`Advisor: ${found.rows[0].name || found.rows[0].username} (admin.id=${adminId})`)
    }

    const report = []
    let created = 0
    let skipped = 0

    for (const row of users) {
      const email = emailOf(row)
      const name = String(row.name || row.full_name || row.client_name || '').trim() || (email ? email.split('@')[0] : '')
      if (!email) {
        report.push({ email: '', name, status: 'skipped', reason: 'no email' })
        skipped += 1
        continue
      }
      const existing = await client.query('SELECT id FROM "user" WHERE lower(email) = $1', [email])
      if (existing.rows.length) {
        report.push({ email, name, status: 'skipped', reason: `already exists as user.id=${existing.rows[0].id}` })
        skipped += 1
        continue
      }

      const plain = password()
      const age = Math.round(asNumber(row.age, 32)) || 32
      const salary = asNumber(row.salary || row.annual_salary || row.current_annual_gross_income, 0)
      const workTill = Math.round(asNumber(row.work_till || row.worktill || row.retire_age, age + asNumber(row.work_tenure_years, 0)))
      const workTenure = Math.max(0, workTill > age ? workTill - age : asNumber(row.work_tenure_years, 0))
      const lifeTo = Math.round(asNumber(row.life_to || row.lifespan_years, 85)) || 85

      if (dryRun) {
        report.push({ email, name, status: 'dry-run', password: plain })
        created += 1
        continue
      }

      await client.query('BEGIN')
      try {
        const hash = await bcrypt.hash(plain, 12)
        const userRes = await client.query(
          'INSERT INTO "user" (email, password_hash, name, admin_id, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id',
          [email, hash, name, adminId]
        )
        const userId = userRes.rows[0].id
        const profileRes = await client.query(
          `INSERT INTO financial_profile (
             user_id, age, current_annual_gross_income, work_tenure_years, lifespan_years,
             income_growth_rate, asset_growth_rate, inflation_rate, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW()) RETURNING id`,
          [
            userId,
            age,
            salary,
            workTenure,
            lifeTo,
            asRate(row.income_growth_pct || row.g_sal, 0.08),
            asRate(row.asset_growth_pct || row.g_ret, 0.11),
            asRate(row.inflation_pct || row.g_inf, 0.06),
          ]
        )
        const profileId = profileRes.rows[0].id

        for (const a of assets.get(email) || []) {
          await client.query(
            `INSERT INTO assets (user_id, profile_id, name, tag, current_value, category, sip_amount, sip_frequency, sip_expiry_date, expected_return, notes, custom_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb)`,
            [
              userId,
              profileId,
              a.name || 'Asset',
              a.tag || 'Investment',
              asNumber(a.current_value || a.value || a.val),
              a.category || a.cat || null,
              asNumber(a.sip_amount || a.sip),
              a.sip_frequency || a.freq || 'Monthly',
              a.sip_expiry_date || a.exp || null,
              asRate(a.expected_return_pct || a.expected_return || a.ret, 0),
              a.notes || '',
            ]
          )
        }
        for (const w of work.get(email) || []) {
          await client.query(
            `INSERT INTO work_assets (user_id, profile_id, stream, amount, growth_rate, end_age, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              userId,
              profileId,
              w.stream || w.name || 'Income stream',
              asNumber(w.amount || w.amt),
              asRate(w.growth_rate || w.g, 0.05),
              Math.round(asNumber(w.end_age || w.end, 65)) || 65,
              w.notes || '',
            ]
          )
        }
        for (const g of goals.get(email) || []) {
          await client.query(
            `INSERT INTO financial_goal (user_id, profile_id, name, description, target_amount, target_year, category, notes)
             VALUES ($1,$2,$3,$3,$4,$5,$6,$7)`,
            [
              userId,
              profileId,
              g.name || g.n || 'Goal',
              asNumber(g.target_amount || g.amount || g.v),
              Math.round(asNumber(g.target_year || g.year)) || null,
              g.category || null,
              g.notes || '',
            ]
          )
        }
        for (const l of loans.get(email) || []) {
          await client.query(
            `INSERT INTO financial_loan (user_id, profile_id, name, lender, type, principal_outstanding, amount, emi, rate, frequency, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)`,
            [
              userId,
              profileId,
              l.name || l.n || 'Loan',
              l.lender || l.name || 'Lender',
              l.type || 'Other',
              asNumber(l.principal_outstanding || l.outstanding || l.amount || l.v),
              asNumber(l.emi),
              asRate(l.rate || l.interest, 0),
              l.frequency || 'Monthly',
              l.notes || '',
            ]
          )
        }
        for (const l of planned.get(email) || []) {
          await client.query(
            `INSERT INTO planned_loan (user_id, profile_id, name, lender, type, principal, emi, rate, frequency, start_year, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              userId,
              profileId,
              l.name || 'Planned loan',
              l.lender || '',
              l.type || '',
              asNumber(l.principal || l.amount),
              asNumber(l.emi),
              asRate(l.rate, 0),
              l.frequency || 'Monthly',
              Math.round(asNumber(l.start_year)) || null,
              l.notes || '',
            ]
          )
        }
        for (const e of expenses.get(email) || []) {
          await client.query(
            `INSERT INTO financial_expense (user_id, profile_id, category, description, subcategory, amount, frequency, need_type, personal_inflation, start_age, end_age, notes)
             VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              userId,
              profileId,
              e.category || e.cat || 'Other',
              e.description || e.subcategory || e.sub || 'Expense',
              asNumber(e.amount || e.amt),
              e.frequency || e.freq || 'Monthly',
              e.need_type || e.type || 'Need',
              asRate(e.personal_inflation || e.inf, 0.06),
              Math.round(asNumber(e.start_age || e.from)) || null,
              Math.round(asNumber(e.end_age || e.to)) || null,
              e.notes || '',
            ]
          )
        }
        for (const p of insurance.get(email) || []) {
          await client.query(
            `INSERT INTO financial_insurance (user_id, profile_id, policy_type, cover, premium, frequency, provider, policy_number, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              userId,
              profileId,
              p.policy_type || p.type || 'Term',
              asNumber(p.cover),
              asNumber(p.premium),
              p.frequency || 'Yearly',
              p.provider || '',
              p.policy_number || '',
              p.notes || '',
            ]
          )
        }

        await client.query('COMMIT')
        report.push({ email, name, user_id: userId, status: 'created', password: plain })
        created += 1
        console.log(`created ${email} (user.id=${userId})`)
      } catch (error) {
        await client.query('ROLLBACK')
        report.push({ email, name, status: 'failed', reason: error.message })
        console.error(`failed ${email}:`, error.message)
      }
    }

    const lines = ['email,name,user_id,status,password,reason']
    for (const row of report) {
      lines.push([
        row.email || '',
        `"${String(row.name || '').replace(/"/g, '""')}"`,
        row.user_id || '',
        row.status,
        row.password || '',
        `"${String(row.reason || '').replace(/"/g, '""')}"`,
      ].join(','))
    }
    fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8')
    console.log(`\n${dryRun ? 'DRY RUN' : 'DONE'} created=${created} skipped=${skipped} report=${outPath}`)
    console.log('Give Arun the password file privately. Do not commit it.')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
