# LifeMap — handover for Claude (Arun)

This file is the source of truth for any Claude (or other agent) connected to this GitHub repo and the live Render stack.

**Product:** LifeMap by BOX Wealth — a financial-planning app. A client signs in, fills FP Calculator / Assets / Work assets / Goals / Loans / Expenses / Insurance, and the plan is stored in Postgres. An advisor (admin) can open that same plan and edit it. Super admin creates advisors.

**First job after handover:** take Arun’s unlinked client dumps (CSV / XLSX / SQL / whatever) and load them into **Render Postgres** so each client can sign in on https://lifemap.finance with a generated password. Return the login list to Arun. Map what you can. Tell Arun clearly what is missing or cannot be stored.

Do not invent schema. Do not drop tables. Do not set `DATABASE_INIT=true`.

---

## 1. Where everything lives

| Piece | Exact value |
|---|---|
| GitHub (source of truth) | https://github.com/boxwealthadvisors/lifemap.git |
| Branch Render deploys | `main` |
| Old GitHub (archive only) | https://github.com/Amitr16/lifemaps.git |
| Live app | https://lifemap.finance |
| API | https://lifemaps-backend-yzb6.onrender.com |
| API prefix | `/api` (example: `https://lifemaps-backend-yzb6.onrender.com/api/financial/profile/:userId`) |
| Render project | LifeMaps / Production |
| Frontend service | `lifemaps-frontend` — Node, root empty, build `npm install && npm run build`, start `node server.js` |
| Backend service | `lifemaps-backend` — Node, root empty, build `cd backend && npm install`, start `cd backend && node start-render.js` |
| Database | Render Postgres `lifemaps-db` |
| Optional classifier | `lifemaps-classifier` (Python). Not required for import. |

Frontend env (baked in at **build** time):

- `VITE_API_URL` = `https://lifemaps-backend-yzb6.onrender.com/api`
- `PORT` = `3000`

Backend env (do not wipe):

- `DATABASE_URL` = Internal URL of `lifemaps-db`
- `JWT_SECRET` = existing secret (do not rotate unless you intend to log everyone out)
- `CORS_ORIGIN` = `https://lifemap.finance,https://www.lifemap.finance` (plus any `*.onrender.com` frontend URL still in use)
- `NODE_ENV` = `production`
- `PORT` = `10000`
- `OPENAI_API_KEY` = optional, expense classify fallback

**Never set `DATABASE_INIT=true`.** That runs a wipe-and-recreate script.

### How Claude reaches the live database

1. Render dashboard → `lifemaps-db` → **Connections**.
2. Use **External Database URL** from a one-off script on a trusted machine, **or** Render **Shell** on `lifemaps-backend` (then `cd backend` and run a Node script with the existing `DATABASE_URL`).
3. Connection is Postgres. SSL is required from outside Render.
4. **Never paste the connection string, JWT secret, or generated passwords into a public gist.** Give Arun the password sheet privately.

Discover live columns before importing:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY 1;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```

The table `"user"` is a reserved word. Always quote it: `"user"`.

---

## 2. What the app actually does

Three roles:

| Role | Table | How they sign in | What they can do |
|---|---|---|---|
| Super admin | `super_admin` | https://lifemap.finance/super-admin/login | Create/edit **admins**, assign users |
| Admin (advisor) | `admin` | https://lifemap.finance/admin/login | See **their** clients, open a client’s LifeMap, edit it |
| User (client) | `"user"` | https://lifemap.finance Sign in (email + password) | Edit their own plan |

Public self-signup is **closed**. `POST /api/register` returns 403. New clients are created by an admin (UI) or by this import (DB/API).

User-facing screens (same UI for client login and admin→client edit):

| Screen | Route | Storage |
|---|---|---|
| FP Calculator | `/` | `financial_profile` plus summaries; mockup HTML |
| Assets | `/assets` | `assets` |
| Work assets | `/work-assets` | `work_assets` |
| Goals | `/goals` | `financial_goal` |
| Loans | `/loans` | `financial_loan` + `planned_loan` |
| Expenses | `/expenses` | `financial_expense` |
| Insurance | `/insurance` | `financial_insurance` (React page, not mockup) |

Mockup HTML lives in `src/mockups/`. After HTML edits run `python scripts/prepare-mockups.py` so `public/lifemap/*.html` updates. Persistence is `src/lib/mockupSync.js`. Admin impersonation uses `/api/admin/financial/...` with `?userId=`.

---

## 3. Identity model (read this before any import)

```
super_admin 1──* admin 1──* "user" 1──* financial_profile
                                      └── assets
                                      └── work_assets
                                      └── financial_goal
                                      └── financial_loan
                                      └── planned_loan
                                      └── financial_expense
                                      └── financial_insurance
```

Rules:

1. A **client login** is a row in `"user"` (`email` unique, `name`, `password_hash`, `admin_id`).
2. Almost every plan row needs `user_id` **and** `profile_id`. Create **one** `financial_profile` per user before inserting registers.
3. `"user".admin_id` must point at the advisor in `admin`. If it is null, that client will **not** show in that advisor’s Admin → user list.
4. Passwords are **bcrypt** (cost **12**, `bcryptjs`). Never store plaintext in the database.
5. Email is the only unique client key the app has. There is no CRM id, PAN, phone, or Aadhaar column.

---

## 4. Tables Claude must know

### 4.1 `"user"` — client login

| Column | Type | Required | Notes |
|---|---|---|---|
| `id` | serial PK | yes | |
| `email` | varchar unique | **yes** | login id; lowercase and trim |
| `password_hash` | varchar | **yes** | bcrypt of generated password |
| `name` | varchar | **yes** | display name |
| `admin_id` | int FK → `admin(id)` | **yes for advisor list** | which advisor owns this client |
| `created_at` / `updated_at` | timestamp | | |

No phone, address, DOB, PAN, family members, or client-code column.

**Create one client:**

```sql
INSERT INTO "user" (email, password_hash, name, admin_id, created_at)
VALUES ($1, $2, $3, $4, NOW())
RETURNING id, email, name, created_at;
```

`$2` = `await bcrypt.hash(plainPassword, 12)` in Node (`bcryptjs`).

### 4.2 `admin` — advisor

| Column | Notes |
|---|---|
| `id` | PK |
| `username` | unique, used at `/admin/login` (not email) |
| `password_hash` | bcrypt 12 |
| `name`, `email` | optional |
| `is_active` | default true |
| `super_admin_id` / `created_by` | optional FKs to `super_admin` |

Find the advisor **before** importing clients:

```sql
SELECT id, username, name, email FROM admin WHERE is_active = TRUE;
```

If Arun is the only advisor, attach every imported `"user".admin_id` to his `admin.id`. If he is not in `admin` yet, create him via Super Admin UI or insert a hashed row. Do not reuse `super_admin` as `admin_id`.

### 4.3 `super_admin`

| Column | Notes |
|---|---|
| `username` | unique; login at `/super-admin/login` |
| `password_hash` | bcrypt 12 |

Not used for client logins. Do not import clients here.

### 4.4 `financial_profile` — one per user (create before registers)

Rates are **decimals** (`0.08` = 8%), not percents.

| Column | App meaning |
|---|---|
| `user_id` | FK |
| `age` | current age (FP) |
| `current_annual_gross_income` | salary (annual) |
| `work_tenure_years` | years left working (`workTill - age`) |
| `total_asset_gross_market_value` | financial + personal assets total |
| `personal_asset_value` | personal (non-investment) assets |
| `total_loan_outstanding_value` | outstanding loans total |
| `lifespan_years` | planning horizon age (often 85–90) |
| `income_growth_rate` | salary growth, decimal |
| `asset_growth_rate` | default asset return, decimal |
| `inflation_rate` | decimal |
| `equity_growth_rate` / `debt_growth_rate` | decimals |
| `loan_tenure_years`, `monthly_income`, `annual_income`, `asset_value`, `loan_value` | legacy; prefer the columns above |

Minimum insert if the dump only has a person:

```sql
INSERT INTO financial_profile (user_id, age, lifespan_years, income_growth_rate, asset_growth_rate, inflation_rate)
VALUES ($userId, $age, 85, 0.08, 0.11, 0.06)
RETURNING id;
```

### 4.5 `assets`

| Column | Dump mapping |
|---|---|
| `user_id`, `profile_id` | required |
| `name` | holding name |
| `tag` | `Investment` \| `Personal` \| `Emergency` \| `Retirement` (or a row in `user_tags`) |
| `current_value` | market value |
| `category` | form: Equity MF, FD, Real estate, … |
| `sip_amount`, `sip_frequency`, `sip_expiry_date` | SIP |
| `expected_return` | **decimal** (0.12 not 12) |
| `notes` | |
| `custom_data` | jsonb; UI also stores `goalEarmarks: [{ goalId, goalName, percent }]` |

### 4.6 `work_assets` (income streams, not salary)

Salary itself is `financial_profile.current_annual_gross_income`. This table is extra streams (rent, business, bonus).

| Column | Dump mapping |
|---|---|
| `stream` | name |
| `amount` | annual amount |
| `growth_rate` | **decimal** |
| `end_age` | required integer |
| `notes`, `color` | optional |

### 4.7 `financial_goal`

| Column | Dump mapping |
|---|---|
| `name` / `description` | goal name |
| `target_amount` / `amount` | rupees |
| `target_year` or `target_date` or `target_age` | when |
| `category`, `flexibility`, `span_years`, `inflation_pct`, `notes` | |
| `custom_data` | jsonb; UI stores `linkedAssets: [{ assetId, assetName, percent }]` |

### 4.8 `financial_loan` (already drawn)

| Column | Dump mapping |
|---|---|
| `name`, `lender`, `type` | |
| `principal_outstanding` (prefer) or `amount` | outstanding |
| `emi`, `rate` (decimal), `frequency` | usually Monthly |
| `start_date`, `end_date`, `emi_day`, `prepay_allowed`, `notes` | |

Creating a loan via the API also creates a linked `financial_expense` with `loan_id` (the EMI). If you insert loans **and** EMI rows yourself, do **one** of: insert loan only and let the app/API create the EMI, **or** insert both and set `financial_expense.loan_id`. Never import the same EMI twice.

### 4.9 `planned_loan` (not yet taken)

`lender`, `name`, `type`, `principal`, `rate` (decimal), `emi`, `frequency`, `start_year`, `notes`.

### 4.10 `financial_expense` (living costs)

| Column | Dump mapping |
|---|---|
| `category` | Housing, Food, … |
| `description` / `subcategory` | line name |
| `amount` | per frequency period, not always annual |
| `frequency` | `Monthly`, `Quarterly`, `Yearly`, `Annually`, `Half-yearly`, `Semi-Annually`, `Weekly`, `Fortnightly` |
| `need_type` / `tag_for` | `Need` \| `Want` \| `Saving` |
| `personal_inflation` | **decimal** |
| `start_age`, `end_age` | life window |
| `payment_from`, `notes` | |
| `loan_id` | set only for auto EMI rows |
| `insurance_id` | set only for premium rows created from insurance |

Skip importing EMI/premium lines if you already import the parent loan/policy.

### 4.11 `financial_insurance`

`policy_type`, `cover`, `premium`, `frequency` (`Monthly`/`Quarterly`/`Yearly`), `provider`, `policy_number`, `start_date`, `end_date`, `notes`.

### 4.12 Supporting (usually skip on first import)

| Table | Purpose |
|---|---|
| `user_tags` | extra asset tags beyond the four defaults |
| `user_asset_columns` | custom asset grid columns |
| `user_source_preferences` | which source a widget prefers |
| `expense_categories` / `expense_tags` | optional taxonomies |
| `financial_scenario` | old scenario snapshots; **not** the live mockup UI |

---

## 5. First task — import Arun’s client dumps

### 5.1 Ask Arun for (and tell him if missing)

**Must have to create logins**

- Email (unique). If missing, you **cannot** create a LifeMap login. Report those rows.
- Display name. If missing, derive from email local-part and tell him you did.

**Must have so they appear under the advisor**

- Which advisor owns them, **or** confirm “all clients belong to admin X”. You need `admin.id`.

**Nice to have (map into profile / registers)**

- Age, salary (annual), work-till age or years to retirement, inflation %, expected return %
- Asset lines (name, value, type/tag, SIP)
- Income streams besides salary
- Goals (name, amount, year)
- Loans (outstanding, EMI, rate, tenure)
- Expenses (amount + frequency + category)
- Insurance (cover, premium, type, provider)

### 5.2 What you cannot store (tell Arun; do not fake columns)

There is **no table/column** for:

- Phone, WhatsApp, address, city, PAN, Aadhaar, passport, KYC docs
- Client code / CRM id / Folio / AMFI ARN as a first-class field (you may put a code in `notes` if he insists)
- Family graph (spouse/kids as people). Only extra `"user"` rows if they get their own login
- Uploaded PDFs, CAS, CAMS/KARVY files as files. Parse them into register **rows** instead
- Bank account numbers, IFSC, demat, credit score
- Meetings, tasks, billing, invoices, GST
- Portfolio analytics (XIRR, benchmark vs Nifty) beyond the simple registers
- Historical NAV time series

If a dump is only CAS/holdings, you can load **assets**. If it is only a phone book, you can load **users** and nothing else.

### 5.3 Import order (strict)

1. Resolve `admin_id`.
2. Normalise emails; skip duplicates already in `"user"`.
3. For each new client: generate password → bcrypt 12 → insert `"user"`.
4. Insert `financial_profile`.
5. Insert child rows (assets, work_assets, goals, loans, planned_loan, expenses, insurance).
6. Hand Arun a **password sheet**: email, name, plaintext password, `user.id`. This is the only time plaintext exists.
7. Report: created / skipped (duplicate email) / failed / unmapped columns.

Password: at least 12 characters, mixed, unique per user. Do not use a shared password for everyone.

### 5.4 Rate conversion

If the dump says `8` or `8%` for growth/inflation/return, store `0.08`.  
If the dump already looks like `0.08`, keep it.  
`financial_goal.inflation_pct` is the awkward one: the UI often stores **6** meaning 6%, not 0.06. When unsure, look at existing rows: `SELECT inflation_pct FROM financial_goal LIMIT 5`.

### 5.5 Money

Store rupees as numbers. `1500000` not `"15L"`. Convert L/Cr in the importer (`1L = 100000`, `1Cr = 10000000`).

### 5.6 How to run it

Preferred: a Node script in `backend/scripts/` using `bcryptjs` + `pg` and `backend/config/database.js` (uses `DATABASE_URL`). Run from **Render Shell** on `lifemaps-backend` so you never copy the DB URL locally unless Arun wants that.

Dry-run first (print mapping, insert nothing). Then a 1-client test. Then the rest. After import, Arun should:

1. Open https://lifemap.finance/admin/login as the advisor  
2. See the new names in the user register  
3. Open one plan (same mockup UI as the client)  
4. Give that client their email + generated password to try Sign in

### 5.7 Do not

- `TRUNCATE` or `DROP`
- `DATABASE_INIT=true`
- Insert into `"user"` without `password_hash`
- Point `admin_id` at `super_admin.id`
- Import EMI both as a loan and as a living expense without `loan_id`
- Commit dumps or password sheets to GitHub

---

## 6. How Claude should change the product later

| Kind of change | Where |
|---|---|
| Copy / charts / registers on FP, Assets, Work, Goals, Loans, Expenses | `src/mockups/lifemap-*.html` then `python scripts/prepare-mockups.py` |
| Save/load mapping | `src/lib/mockupSync.js` |
| Insurance / Profile / Growth / Admin UI | `src/pages/*.jsx`, `src/components/` |
| API / validation | `backend/routes/financial.js`, `backend/routes/admin.js`, `backend/routes/auth.js` |
| New DB columns | add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` to `backend/scripts/ensure-lifemap-mockup-schema.js` (runs on API boot). Never a destructive init script |
| Frontend API URL | Render **frontend** env `VITE_API_URL`, then **rebuild** frontend |

Git: push `main` to `https://github.com/boxwealthadvisors/lifemap.git`. Render auto-deploys.

Frontend Render settings (if Git reconnect resets them to Python):

- Language **Node**
- Build `npm install && npm run build`
- Start `node server.js`

Backend:

- Language **Node**
- Build `cd backend && npm install`
- Start `cd backend && node start-render.js`

Leave `lifemaps-db` alone when changing Git.

Admin editing a client uses the **same mockup UI** as the client (`MockupHost` + admin financial APIs). Do not revive the old React `AdminAssetsPage` path for that.

---

## 7. Useful API notes (if importing via HTTP instead of SQL)

Admin JWT from `POST /api/admin/admin/login` `{ username, password }`.

Create user (admin): `POST /api/admin/users` `{ email, password, name }` — sets `admin_id` from the token. Public `POST /api/register` is forbidden.

Then plan data: either SQL, or `/api/admin/financial/...` with `?userId=<id>` and the admin token (see `src/services/api.js` `*ForUser` methods).

User JWT from `POST /api/login` `{ email, password }`.

---

## 8. Local development (optional)

- Frontend: repo root, `npm run dev` (Vite, often port 5174)
- Backend: `backend/`, Node, default `http://localhost:10000/api`
- Local Postgres via `DATABASE_URL` or `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`

---

## 9. Checklist after a client dump load

- [ ] `"user"` rows exist, unique emails, bcrypt hashes, `admin_id` set  
- [ ] Password sheet delivered to Arun (not committed)  
- [ ] Each user has one `financial_profile`  
- [ ] Advisor sees them at `/admin`  
- [ ] Opening a user shows the mockup plan (not an empty Python error page)  
- [ ] One client can Sign in at https://lifemap.finance  
- [ ] Unmapped dump columns listed for Arun  
- [ ] Fields with no table listed as “cannot import”  

If anything in a dump does not fit the tables above, **do not silently drop it**. Tell Arun the column name, a sample value, and that LifeMap has nowhere to put it unless we add a column on purpose.
