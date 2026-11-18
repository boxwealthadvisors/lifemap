import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STATEMENTS = [
  `ALTER TABLE financial_profile ADD COLUMN IF NOT EXISTS inflation_rate DECIMAL(8,6) DEFAULT 0.06`,
  `ALTER TABLE financial_profile ADD COLUMN IF NOT EXISTS equity_growth_rate DECIMAL(8,6) DEFAULT 0.15`,
  `ALTER TABLE financial_profile ADD COLUMN IF NOT EXISTS debt_growth_rate DECIMAL(8,6) DEFAULT 0.07`,
  `ALTER TABLE financial_profile ADD COLUMN IF NOT EXISTS personal_asset_value DECIMAL(15,2) DEFAULT 0`,
  `ALTER TABLE financial_profile ADD COLUMN IF NOT EXISTS household JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS category VARCHAR(100)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS sip_amount DECIMAL(15,2) DEFAULT 0`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS sip_frequency VARCHAR(40) DEFAULT 'Monthly'`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS sip_expiry_date VARCHAR(40)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS expected_return DECIMAL(8,4)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS maturity_date VARCHAR(40)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS maturity_value DECIMAL(15,2)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS income_amount DECIMAL(15,2)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS income_start_date VARCHAR(40)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS income_end_date VARCHAR(40)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS start_date VARCHAR(40)`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE work_assets ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE work_assets ADD COLUMN IF NOT EXISTS color VARCHAR(20)`,
  `ALTER TABLE work_assets ALTER COLUMN growth_rate TYPE DECIMAL(8,4)`,
  `ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_tag_check`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS category VARCHAR(100)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS flexibility VARCHAR(40)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS span_years INTEGER DEFAULT 1`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS inflation_pct DECIMAL(8,4) DEFAULT 6`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS target_age INTEGER`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS start_age INTEGER`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS end_age INTEGER`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS need_type VARCHAR(40)`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS tag_for VARCHAR(255)`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS lifestyle_level VARCHAR(255)`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS payment_from VARCHAR(255)`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS expiry DATE`,
  `ALTER TABLE financial_expense ADD COLUMN IF NOT EXISTS loan_id INTEGER`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS lender VARCHAR(255)`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS type VARCHAR(255)`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS start_date DATE`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS end_date DATE`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS principal_outstanding DECIMAL(15,2)`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS emi_day INTEGER DEFAULT 1`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS prepay_allowed BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS notes TEXT`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS name VARCHAR(255)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS target_amount DECIMAL(15,2)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS term VARCHAR(10) DEFAULT 'LT'`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS recommended_allocation VARCHAR(255)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS funding_source VARCHAR(255)`,
  `ALTER TABLE financial_goal ADD COLUMN IF NOT EXISTS on_track BOOLEAN DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS financial_insurance (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES "user"(id) ON DELETE CASCADE,
      profile_id INTEGER REFERENCES financial_profile(id) ON DELETE SET NULL,
      policy_type VARCHAR(255) NOT NULL,
      cover DECIMAL(15,2) NOT NULL,
      premium DECIMAL(15,2) NOT NULL,
      frequency VARCHAR(20) DEFAULT 'Yearly',
      provider VARCHAR(255),
      policy_number VARCHAR(255),
      start_date DATE,
      end_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  `ALTER TABLE financial_insurance ADD COLUMN IF NOT EXISTS profile_id INTEGER`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS frequency VARCHAR(40) DEFAULT 'Monthly'`,
  `ALTER TABLE financial_loan ADD COLUMN IF NOT EXISTS name VARCHAR(255)`,
  `ALTER TABLE financial_loan ALTER COLUMN rate TYPE DECIMAL(8,4) USING rate::DECIMAL(8,4)`,
  `CREATE TABLE IF NOT EXISTS planned_loan (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      profile_id INTEGER REFERENCES financial_profile(id) ON DELETE SET NULL,
      lender VARCHAR(255),
      name VARCHAR(255),
      type VARCHAR(255),
      principal DECIMAL(15,2) DEFAULT 0,
      rate DECIMAL(8,4) DEFAULT 0,
      emi DECIMAL(15,2) DEFAULT 0,
      frequency VARCHAR(40) DEFAULT 'Monthly',
      start_year INTEGER,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_planned_loan_user_id ON planned_loan(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_planned_loan_profile_id ON planned_loan(profile_id)`,
  `CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,
  `CREATE TABLE IF NOT EXISTS super_admin (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE TABLE IF NOT EXISTS admin (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      email VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES super_admin(id) ON DELETE SET NULL,
      super_admin_id INTEGER REFERENCES super_admin(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS super_admin_id INTEGER REFERENCES super_admin(id) ON DELETE SET NULL`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES super_admin(id) ON DELETE SET NULL`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS admin_id INTEGER`,
  `DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_admin_id_fkey'
      ) THEN
        ALTER TABLE public."user"
          ADD CONSTRAINT user_admin_id_fkey
          FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END
    $$`,
  `CREATE INDEX IF NOT EXISTS idx_user_admin_id ON public."user"(admin_id)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_username ON admin(username)`,
  `CREATE TABLE IF NOT EXISTS email_otp (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'signup',
      expires_at TIMESTAMP NOT NULL,
      attempts INTEGER DEFAULT 0,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_email_otp_email ON email_otp(email)`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS consent_version VARCHAR(40)`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS consent_at TIMESTAMP`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS delete_reason TEXT`,
  `ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS session_version INTEGER DEFAULT 1`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS session_version INTEGER DEFAULT 1`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS session_version INTEGER DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS auth_session (
      id SERIAL PRIMARY KEY,
      jti VARCHAR(64) UNIQUE NOT NULL,
      role VARCHAR(20) NOT NULL,
      subject_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen_at TIMESTAMP DEFAULT NOW(),
      revoked_at TIMESTAMP,
      user_agent TEXT,
      ip VARCHAR(64)
    )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_session_subject ON auth_session(role, subject_id)`,
  `CREATE TABLE IF NOT EXISTS password_reset_token (
      id SERIAL PRIMARY KEY,
      role VARCHAR(20) NOT NULL,
      subject_id INTEGER NOT NULL,
      email VARCHAR(255) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'reset',
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_token(token_hash)`,
  `CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      actor_role VARCHAR(20),
      actor_id INTEGER,
      actor_label VARCHAR(255),
      action VARCHAR(80) NOT NULL,
      target_type VARCHAR(40),
      target_id INTEGER,
      team_admin_id INTEGER,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_team ON activity_log(team_admin_id)`,
  `CREATE TABLE IF NOT EXISTS deleted_items (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(40) NOT NULL,
      entity_id INTEGER NOT NULL,
      payload JSONB NOT NULL,
      deleted_by_role VARCHAR(20),
      deleted_by_id INTEGER,
      reason TEXT,
      deleted_at TIMESTAMP DEFAULT NOW(),
      purge_after TIMESTAMP,
      restored_at TIMESTAMP
    )`,
  `CREATE INDEX IF NOT EXISTS idx_deleted_items_open ON deleted_items(entity_type, restored_at)`,
  `CREATE TABLE IF NOT EXISTS privacy_request (
      id SERIAL PRIMARY KEY,
      ref VARCHAR(40) UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      type VARCHAR(40) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'Received',
      details TEXT,
      due_at TIMESTAMP,
      closed_at TIMESTAMP,
      handled_by_role VARCHAR(20),
      handled_by_id INTEGER,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_privacy_request_user ON privacy_request(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_privacy_request_status ON privacy_request(status)`,
  // Legal hold: items with legal_hold = TRUE are skipped by the 90-day purge and cannot be purged manually.
  `ALTER TABLE deleted_items ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_deleted_items_user ON deleted_items((payload->>'user_id'))`,
  // Periodic access review (super admin keeps or deactivates each admin)
  `CREATE TABLE IF NOT EXISTS access_review_decision (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER,
      decision VARCHAR(20) NOT NULL,
      decided_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_access_review_decision_admin ON access_review_decision(admin_id, created_at DESC)`,
  // Staff TOTP (authenticator app). totp_secret is stored encrypted; the pending column holds a secret
  // between POST /totp/setup and POST /totp/enable.
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS totp_secret VARCHAR`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS totp_secret VARCHAR`,
  `ALTER TABLE admin ADD COLUMN IF NOT EXISTS totp_pending_secret VARCHAR`,
  `ALTER TABLE super_admin ADD COLUMN IF NOT EXISTS totp_pending_secret VARCHAR`,
  // activity_log is APPEND-ONLY: the application only ever INSERTs and SELECTs. There must be no UPDATE or
  // DELETE statements against it, and it must never be truncated: entries are retained for at least one
  // year (see docs/COMPLIANCE_OPS.md). Daily CSV snapshots go to activity_log_archive (see logArchive.js).
  `COMMENT ON TABLE activity_log IS 'Append-only audit trail. No UPDATE/DELETE/TRUNCATE; retain >= 1 year.'`,
  `CREATE TABLE IF NOT EXISTS activity_log_archive (
      id SERIAL PRIMARY KEY,
      day DATE NOT NULL UNIQUE,
      row_count INTEGER NOT NULL DEFAULT 0,
      csv_content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_archive_day ON activity_log_archive(day DESC)`,
  `COMMENT ON TABLE activity_log_archive IS 'Daily CSV snapshots of activity_log for 180-day / 1-year retention. Pruned after LOG_ARCHIVE_RETENTION_DAYS (default 400).'`,
]

export async function ensureLifemapMockupSchema(pool) {
  console.log('[migrate] Applying LifeMap mockup field schema…')
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql)
      console.log('[migrate] ok:', sql.split('\n')[0].trim().slice(0, 80))
    } catch (error) {
      if (/password authentication failed|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
        throw error
      }
      console.warn('[migrate] skipped:', sql.split('\n')[0], '-', error.message)
    }
  }
  console.log('[migrate] LifeMap mockup field schema ready')
}

async function runStandalone() {
  const { default: pool } = await import('../config/database.js')
  try {
    await ensureLifemapMockupSchema(pool)
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runStandalone().catch((error) => {
    console.error('[migrate] failed', error)
    process.exit(1)
  })
}

export default ensureLifemapMockupSchema
