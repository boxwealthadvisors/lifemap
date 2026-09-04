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
