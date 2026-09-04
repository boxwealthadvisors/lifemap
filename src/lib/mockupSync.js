import ApiService from '../services/api'
import {
  annualAmount,
  asList,
  assetMaturityRows,
  combinedAssets,
  combinedWorkUnassigned,
  floorLump,
  fpEditableExpenses,
  fpLivingExpenses,
  unassignedOf,
  FREQ_PER_YEAR,
  num,
  parseHousehold,
  workAnnual,
} from './planLinks'

const PAGES = {
  fp: '/lifemap/fp-calculator.html',
  assets: '/lifemap/assets.html',
  work: '/lifemap/work-assets.html',
  goals: '/lifemap/goals.html',
  loans: '/lifemap/loans.html',
  expenses: '/lifemap/expenses.html',
}

export function mockupSrc(page) {
  return PAGES[page] || PAGES.fp
}

export function emptyMockupState(page) {
  if (page === 'assets') return { ROWS: [], UNASSIGNED: 0, GOALS: [] }
  if (page === 'work') return { ROWS: [], UNASSIGNED: 0 }
  if (page === 'goals') return { ROWS: [], ASSETS: [], INCOMES: [] }
  if (page === 'loans') return { ROWS: [], PLAN: [] }
  if (page === 'expenses') return { ROWS: [], SOURCES: [] }
  if (page === 'fp') {
    return {
      S: {
        age: 0,
        salary: 0,
        gSal: 8,
        workTill: 60,
        finAssets: 0,
        personalAssets: 0,
        assetMaturities: [],
        loans: [],
        goals: [],
        exp: [],
        expRegister: [],
        gRet: 12,
        gInf: 6,
        lifeTo: 90,
        work: [],
        household: [],
      },
    }
  }
  return {}
}

const thisYear = () => new Date().getFullYear()

const realId = (id) => id != null && !String(id).startsWith('temp_')


const asPct = (v, fallback = 0) => {
  const n = num(v, fallback)
  if (!Number.isFinite(n)) return fallback
  const pct = n > 0 && n <= 1 ? n * 100 : n
  return Math.round(pct * 10) / 10
}

const asRate = (v, fallback = 0) => {
  const n = num(v, fallback)
  if (!Number.isFinite(n)) return fallback
  return n > 1 ? n / 100 : n
}

// <input type="date"> only accepts YYYY-MM-DD, so trim anything timestamp-shaped.
const asDateInput = (v) => {
  if (v == null || v === '') return ''
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function bindFinancialApi(userId, admin) {
  if (admin) {
    return {
      getFinancialProfile: () => ApiService.getFinancialProfileForUser(userId),
      updateFinancialProfile: (profileId, data) => ApiService.updateFinancialProfileForUser(profileId, data, userId),
      createFinancialProfile: (data) => ApiService.createFinancialProfileForUser(data, userId),
      getFinancialAssets: () => ApiService.getFinancialAssetsForUser(userId),
      createFinancialAsset: (body) => ApiService.createFinancialAssetForUser(body, userId),
      updateFinancialAsset: (id, body) => ApiService.updateFinancialAssetForUser(id, body, userId),
      deleteFinancialAsset: (id) => ApiService.deleteFinancialAssetForUser(id, userId),
      getWorkAssets: () => ApiService.getWorkAssetsForUser(userId),
      createWorkAsset: (body) => ApiService.createWorkAssetForUser(body, userId),
      updateWorkAsset: (id, body) => ApiService.updateWorkAssetForUser(id, body, userId),
      deleteWorkAsset: (id) => ApiService.deleteWorkAssetForUser(id, userId),
      getFinancialGoals: () => ApiService.getFinancialGoalsForUser(userId),
      createFinancialGoal: (body) => ApiService.createFinancialGoalForUser(body, userId),
      updateFinancialGoal: (id, body) => ApiService.updateFinancialGoalForUser(id, body, userId),
      deleteFinancialGoal: (id) => ApiService.deleteFinancialGoalForUser(id, userId),
      getFinancialLoans: () => ApiService.getFinancialLoansForUser(userId),
      createFinancialLoan: (body) => ApiService.createFinancialLoanForUser(body, userId),
      updateFinancialLoan: (id, body) => ApiService.updateFinancialLoanForUser(id, body, userId),
      deleteFinancialLoan: (id) => ApiService.deleteFinancialLoanForUser(id, userId),
      getPlannedLoans: () => ApiService.getPlannedLoansForUser(userId),
      createPlannedLoan: (body) => ApiService.createPlannedLoanForUser(body, userId),
      updatePlannedLoan: (id, body) => ApiService.updatePlannedLoanForUser(id, body, userId),
      deletePlannedLoan: (id) => ApiService.deletePlannedLoanForUser(id, userId),
      getFinancialExpenses: () => ApiService.getFinancialExpensesForUser(userId),
      createFinancialExpense: (body) => ApiService.createFinancialExpenseForUser(body, userId),
      updateFinancialExpense: (id, body) => ApiService.updateFinancialExpenseForUser(id, body, userId),
      deleteFinancialExpense: (id) => ApiService.deleteFinancialExpenseForUser(id, userId),
    }
  }
  return {
    getFinancialProfile: () => ApiService.getFinancialProfile(userId),
    updateFinancialProfile: (profileId, data) => ApiService.updateFinancialProfile(profileId, data),
    createFinancialProfile: (data) => ApiService.createFinancialProfile(data),
    getFinancialAssets: () => ApiService.getFinancialAssets(userId),
    createFinancialAsset: (body) => ApiService.createFinancialAsset(body),
    updateFinancialAsset: (id, body) => ApiService.updateFinancialAsset(id, body),
    deleteFinancialAsset: (id) => ApiService.deleteFinancialAsset(id),
    getWorkAssets: () => ApiService.getWorkAssets(userId),
    createWorkAsset: (body) => ApiService.createWorkAsset(body),
    updateWorkAsset: (id, body) => ApiService.updateWorkAsset(id, body),
    deleteWorkAsset: (id) => ApiService.deleteWorkAsset(id),
    getFinancialGoals: () => ApiService.getFinancialGoals(userId),
    createFinancialGoal: (body) => ApiService.createFinancialGoal(body),
    updateFinancialGoal: (id, body) => ApiService.updateFinancialGoal(id, body),
    deleteFinancialGoal: (id) => ApiService.deleteFinancialGoal(id),
    getFinancialLoans: () => ApiService.getFinancialLoans(userId),
    createFinancialLoan: (body) => ApiService.createFinancialLoan(body),
    updateFinancialLoan: (id, body) => ApiService.updateFinancialLoan(id, body),
    deleteFinancialLoan: (id) => ApiService.deleteFinancialLoan(id),
    getPlannedLoans: () => ApiService.getPlannedLoans(userId),
    createPlannedLoan: (body) => ApiService.createPlannedLoan(body),
    updatePlannedLoan: (id, body) => ApiService.updatePlannedLoan(id, body),
    deletePlannedLoan: (id) => ApiService.deletePlannedLoan(id),
    getFinancialExpenses: () => ApiService.getFinancialExpenses(userId),
    createFinancialExpense: (body) => ApiService.createFinancialExpense(body),
    updateFinancialExpense: (id, body) => ApiService.updateFinancialExpense(id, body),
    deleteFinancialExpense: (id) => ApiService.deleteFinancialExpense(id),
  }
}

const yearOf = (value) => {
  if (!value) return ''
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getFullYear()
  const text = String(value)
  const match = text.match(/^(\d{4})/)
  return match ? Number(match[1]) : ''
}

function readAssumptions() {
  try {
    return JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}')
  } catch {
    return {}
  }
}

function writeAssumptions(next) {
  const prev = readAssumptions()
  localStorage.setItem('quickCalcAssumptions', JSON.stringify({ ...prev, ...next }))
}

function createdId(created) {
  if (!created || typeof created !== 'object') return null
  return (
    created.id ||
    created.asset?.id ||
    created.goal?.id ||
    created.expense?.id ||
    created.loan?.id ||
    created.plannedLoan?.id ||
    null
  )
}

function profileAge(profile, local = readAssumptions()) {
  const age = num(profile?.age ?? local.age, 32)
  return age >= 16 && age <= 100 ? age : 32
}

function profileAssumptions(profile, local = readAssumptions()) {
  return {
    inflationRate: asRate(profile?.inflation_rate ?? local.inflationRate, 0.06),
    assetGrowthRate: asRate(profile?.asset_growth_rate ?? local.assetGrowthRate, 0.11),
    incomeGrowthRate: asRate(profile?.income_growth_rate ?? local.incomeGrowthRate, 0.08),
    equityGrowthRate: asRate(profile?.equity_growth_rate ?? local.assetEquityGrowthRate, 0.15),
    debtGrowthRate: asRate(profile?.debt_growth_rate ?? local.assetDebtGrowthRate, 0.07),
    assetEquitySplit: asRate(local.assetEquitySplit, 0.6),
    lifespanYears: num(profile?.lifespan_years ?? local.lifespanYears, 85),
    age: profileAge(profile, local),
  }
}

function toFpExpense(e, age, life) {
  return {
    id: e.id,
    n: e.description || e.subcategory || e.category || 'Expense',
    v: annualAmount(e),
    from: num(e.start_age ?? e.from, age),
    to: num(e.end_age ?? e.to, life),
    inf: asPct(e.personal_inflation ?? e.inf, 6),
    loanId: e.loan_id || e.loanId || null,
    insId: e.insurance_id || e.insId || null,
    saved: true,
  }
}

function rowHasContent(row) {
  if (!row) return false
  const identity = Boolean(
    (row.name && String(row.name).trim()) ||
    (row.n && String(row.n).trim()) ||
    (row.sub && String(row.sub).trim()) ||
    (row.prov && String(row.prov).trim())
  )
  if (identity) return true
  return [row.val, row.amt, row.cost, row.bal, row.v, row.emi, row.sip, row.mval]
    .some((value) => num(value) > 0)
}

function isLinkedExpense(row) {
  return Boolean(row?.loan_id || row?.insurance_id || row?.loanId || row?.insId)
}

function toExpenseRow(e, age, life) {
  const freq = e.frequency === 'Semi-Annually' ? 'Half-yearly' : (e.frequency === 'Yearly' ? 'Annually' : (e.frequency || 'Monthly'))
  return {
    id: e.id,
    cat: e.category || 'Other',
    sub: e.description || e.subcategory || '',
    type: e.need_type || e.tag_for || e.type || 'Need',
    amt: num(e.amount ?? e.amt),
    freq: e.freq || freq,
    inf: asPct(e.personal_inflation ?? e.inf, 6),
    from: num(e.start_age ?? e.from, age || 32),
    to: num(e.end_age ?? e.to, life || 90),
    src: e.payment_from || e.src || '',
    notes: e.notes || '',
    loanId: e.loan_id || e.loanId || null,
    insId: e.insurance_id || e.insId || null,
    saved: true,
  }
}

async function upsertProfile(api, payload) {
  const profileRes = await api.getFinancialProfile().catch(() => null)
  const profile = profileRes?.profile
  if (profile?.id) return api.updateFinancialProfile(profile.id, payload)
  return api.createFinancialProfile({
    age: profileAge(profile),
    ...payload,
  })
}

async function ensureProfile(api, extra = {}) {
  const profileRes = await api.getFinancialProfile().catch(() => null)
  if (profileRes?.profile?.id) {
    if (Object.keys(extra).length) {
      await api.updateFinancialProfile(profileRes.profile.id, extra).catch(() => {})
    }
    return profileRes.profile
  }
  const created = await api.createFinancialProfile({
    age: profileAge(null),
    ...extra,
  }).catch(() => null)
  return created?.profile || created || null
}

export async function loadMockupState(page, userId, options = {}) {
  const api = bindFinancialApi(userId, options.admin)
  try {
  const profileRes = await api.getFinancialProfile().catch(() => null)
  const profile = profileRes?.profile || null
  const assumptions = profileAssumptions(profile)
  writeAssumptions(assumptions)
  const age = assumptions.age

  if (page === 'fp') {
    const [assetsRes, loansRes, goalsRes, expensesRes, workRes] = await Promise.all([
      api.getFinancialAssets().catch(() => ({})),
      api.getFinancialLoans().catch(() => ({})),
      api.getFinancialGoals().catch(() => ({})),
      api.getFinancialExpenses().catch(() => ({})),
      api.getWorkAssets().catch(() => []),
    ])
    const assetsCombined = combinedAssets(profile, assetsRes)
    const salary = num(profile?.current_annual_gross_income)
    const workList = asList(workRes, 'workAssets', 'assets', 'data')
    const household = parseHousehold(profile?.household).map((m, i) => ({
      id: m.id || `hh-${i}`,
      n: m.n || m.name || '',
      rel: m.rel || m.relation || 'Spouse',
      age: num(m.age, age),
      income: num(m.income),
      g: asPct(m.g ?? m.growth, asPct(assumptions.incomeGrowthRate, 8)),
      workTill: num(m.workTill ?? m.work_till, age + num(profile?.work_tenure_years, 28)),
      saved: true,
    }))

    return {
      S: {
        age,
        salary,
        gSal: asPct(assumptions.incomeGrowthRate, 8),
        workTill: age + num(profile?.work_tenure_years, 28),
        finAssets: assetsCombined.financial,
        personalAssets: assetsCombined.personal,
        assetMaturities: assetMaturityRows(assetsRes),
        loans: asList(loansRes, 'loans').map((l) => ({
          id: l.id,
          n: l.loanName || l.name || l.type || 'Loan',
          v: num(l.principal_outstanding ?? l.amount),
          emi: num(l.emi),
          saved: true,
        })),
        goals: asList(goalsRes, 'goals').map((g) => {
          const targetYear = num(g.target_year ?? g.targetYear, thisYear() + 5)
          return {
            id: g.id,
            n: g.description || g.name || '',
            v: num(g.target_amount ?? g.amount),
            yrs: Math.max(0, targetYear - thisYear()),
            saved: true,
          }
        }),
        exp: fpEditableExpenses(expensesRes).map((e) => toFpExpense(e, age, assumptions.lifespanYears)),
        expRegister: fpLivingExpenses(expensesRes).map((e) => toFpExpense(e, age, assumptions.lifespanYears)),
        gRet: asPct(assumptions.assetGrowthRate, 11),
        gInf: asPct(assumptions.inflationRate, 6),
        lifeTo: assumptions.lifespanYears || 85,
        work: workList.map((r, i) => ({
          id: r.id,
          name: r.stream || r.name || `Income ${i + 1}`,
          amt: num(r.amount ?? r.amt),
          g: asPct(r.growthRate ?? r.g, 5),
          end: num(r.endAge ?? r.end, 65),
        })),
        household,
      },
    }
  }

  if (page === 'assets') {
    const [res, goalsRes] = await Promise.all([
      api.getFinancialAssets().catch(() => ({})),
      api.getFinancialGoals().catch(() => ({})),
    ])
    const ROWS = asList(res, 'assets').map((a) => {
      const cd = a.custom_data || {}
      return {
        id: a.id,
        name: a.name || '',
        cat: a.category || cd.cat || cd.subType || 'Other',
        tag: a.tag || 'Investment',
        val: num(a.current_value),
        sip: num(a.sip_amount ?? cd.sipAmount),
        freq: a.sip_frequency || cd.sipFrequency || 'Monthly',
        exp: a.sip_expiry_date || cd.sipExpiryDate || '',
        ret: asPct(a.expected_return ?? cd.expectedReturn, 6),
        mat: asDateInput(a.maturity_date ?? cd.maturityDate),
        mval: num(a.maturity_value ?? cd.maturityValue),
        notes: a.notes || cd.notes || '',
        earmarks: (cd.goalEarmarks || []).map((e) => ({
          id: e.goalId || e.id,
          name: e.goalName || e.name || '',
          pct: num(e.percent ?? e.pct),
        })),
        saved: true,
      }
    })
    return {
      ROWS,
      UNASSIGNED: combinedAssets(profile, res).unassigned,
      GOALS: asList(goalsRes, 'goals').map((g) => ({
        id: g.id,
        name: g.description || g.name || 'Goal',
      })),
    }
  }

  if (page === 'work') {
    const res = await api.getWorkAssets().catch(() => [])
    const list = asList(res, 'workAssets', 'assets', 'data')
    const colors = [
      '#2f6fd0', '#0d8a78', '#e9a23b', '#c94f70', '#7b61c9',
      '#2a9dce', '#d65a31', '#5a9e3d', '#b35c9c', '#8c6d31',
    ]
    const ROWS = list.map((r, i) => ({
      id: r.id,
      c: r.color || colors[i % colors.length],
      name: r.stream || r.name || '',
      amt: num(r.amount),
      g: asPct(r.growthRate, 5),
      end: num(r.endAge, 65),
      notes: r.notes || '',
      saved: true,
    }))
    return {
      ROWS,
      AGE: age,
      UNASSIGNED: combinedWorkUnassigned(profile, list),
    }
  }

  if (page === 'goals') {
    const [res, assetsRes, workRes] = await Promise.all([
      api.getFinancialGoals().catch(() => ({})),
      api.getFinancialAssets().catch(() => ({})),
      api.getWorkAssets().catch(() => []),
    ])
    const lm = (g) => g.custom_data?.lifemap || {}
    const ROWS = asList(res, 'goals').map((g) => {
      const extra = lm(g)
      const targetYear = num(g.target_year ?? g.targetYear, thisYear() + 10)
      const at = num(g.target_age, extra.at || (age ? age + Math.max(0, targetYear - thisYear()) : 40))
      return {
        id: g.id,
        name: g.description || g.name || '',
        cat: g.category || extra.cat || 'Other',
        flex: g.flexibility || extra.flex || 'Committed',
        cost: num(g.target_amount ?? g.amount),
        at,
        span: num(g.span_years ?? extra.span, 1),
        inf: asPct(g.inflation_pct ?? extra.inf, 6),
        notes: g.notes || extra.notes || '',
        links: (g.custom_data?.linkedAssets || extra.linkedAssets || []).map((a) => ({
          id: a.assetId || a.id,
          name: a.assetName || a.name || '',
          pct: num(a.percent ?? a.pct),
        })),
        incomeLinks: (g.custom_data?.linkedIncomes || extra.linkedIncomes || []).map((a) => ({
          id: a.incomeId || a.id,
          name: a.incomeName || a.name || '',
          pct: num(a.percent ?? a.pct),
        })),
        saved: true,
      }
    })
    const INCOMES = []
    if (num(profile?.current_annual_gross_income) > 0) {
      INCOMES.push({ id: 'salary', name: 'Your salary' })
    }
    asList(workRes, 'workAssets', 'assets', 'data').forEach((r) => {
      INCOMES.push({
        id: r.id,
        name: r.stream || r.name || 'Income stream',
      })
    })
    parseHousehold(profile?.household).forEach((m, i) => {
      const name = m.n || m.name || `Family member ${i + 1}`
      if (num(m.income) > 0) {
        INCOMES.push({ id: m.id || `hh-${i}`, name: `${name} · ${m.rel || 'family'}` })
      }
    })
    return {
      ROWS,
      AGE: age,
      RET: asPct(assumptions.assetGrowthRate, 11),
      ASSETS: asList(assetsRes, 'assets')
        .filter((a) => (a.tag || '') !== 'Personal')
        .map((a) => ({
          id: a.id,
          name: a.name || 'Asset',
        })),
      INCOMES,
    }
  }

  if (page === 'loans') {
    const [res, plannedRes] = await Promise.all([
      api.getFinancialLoans().catch(() => ({})),
      api.getPlannedLoans().catch(() => ({})),
    ])
    const ROWS = asList(res, 'loans').map((l) => ({
      id: l.id,
      prov: l.lender || l.provider || '',
      name: l.loanName || l.name || '',
      cat: l.type || l.cat || 'Other',
      bal: num(l.principal_outstanding ?? l.amount),
      rate: num(l.rate ?? l.interestRate),
      emi: num(l.emi),
      freq: l.frequency || l.freq || 'Monthly',
      notes: l.notes || '',
      end: yearOf(l.end_date) || '',
      saved: true,
    }))
    const PLAN = asList(plannedRes, 'plannedLoans', 'loans').map((l) => ({
      id: l.id,
      prov: l.lender || '',
      name: l.name || '',
      cat: l.type || 'Other',
      bal: num(l.principal),
      rate: num(l.rate),
      emi: num(l.emi),
      freq: l.frequency || 'Monthly',
      start: num(l.start_year, thisYear() + 1),
      notes: l.notes || '',
      saved: true,
    }))
    return { ROWS, PLAN }
  }

  if (page === 'expenses') {
    const [res, assetsRes] = await Promise.all([
      api.getFinancialExpenses().catch(() => ({})),
      api.getFinancialAssets().catch(() => ({})),
    ])
    const life = assumptions.lifespanYears || 90
    const ROWS = asList(res, 'expenses').map((e) => toExpenseRow(e, age, life))
    const SOURCES = asList(assetsRes, 'assets')
      .map((a) => a.name)
      .filter(Boolean)
    return { ROWS, AGE: age, LIFE: life, GINF: asPct(assumptions.inflationRate, 6), SOURCES }
  }

  return null
  } finally {
    refreshPlanStore(userId, options).catch(() => {})
  }
}

async function syncCollection({ existing, next, create, update, remove, payload, protect }) {
  if (!Array.isArray(next)) return

  const current = existing.filter((row) => realId(row.id))
  const incoming = next.filter((row) => {
    if (!row) return false
    if (current.some((item) => String(item.id) === String(row.id))) return true
    return rowHasContent(row)
  })
  const incomingIds = new Set(incoming.filter((row) => realId(row.id)).map((row) => String(row.id)))

  const failures = []

  for (const row of current) {
    if (!incomingIds.has(String(row.id))) {
      if (protect?.(row)) continue
      try {
        await remove(row.id)
      } catch (error) {
        failures.push(error)
      }
    }
  }

  for (const row of incoming) {
    const prior = current.find((item) => String(item.id) === String(row.id))
    const body = payload(row, prior)
    try {
      if (prior) {
        await update(row.id, body)
      } else {
        const created = await create(body)
        const id = createdId(created)
        if (id) row.id = id
      }
    } catch (error) {
      failures.push(error)
    }
  }

  if (failures.length) {
    throw failures[0]
  }
}

function asGoalEarmarks(list) {
  return (list || [])
    .map((e) => ({
      goalId: e.id || e.goalId,
      goalName: e.name || e.goalName || '',
      percent: num(e.pct ?? e.percent),
    }))
    .filter((e) => e.goalId && e.percent > 0)
}

function asLinkedIncomes(list) {
  return (list || [])
    .map((e) => ({
      incomeId: e.id || e.incomeId,
      incomeName: e.name || e.incomeName || '',
      percent: num(e.pct ?? e.percent),
    }))
    .filter((e) => e.incomeId && e.percent > 0)
}

function asLinkedAssets(list) {
  return (list || [])
    .map((e) => ({
      assetId: e.id || e.assetId,
      assetName: e.name || e.assetName || '',
      percent: num(e.pct ?? e.percent),
    }))
    .filter((e) => e.assetId && e.percent > 0)
}

async function syncGoalLinksFromAssets(api, assetRows) {
  const goalsRes = await api.getFinancialGoals().catch(() => ({}))
  const goals = asList(goalsRes, 'goals')
  for (const goal of goals) {
    const linked = []
    assetRows.forEach((row) => {
      if (!realId(row.id)) return
      if ((row.tag || '') === 'Personal') return
      ;(row.earmarks || []).forEach((e) => {
        if (String(e.id || e.goalId) === String(goal.id)) {
          linked.push({
            assetId: row.id,
            assetName: row.name || 'Asset',
            percent: num(e.pct ?? e.percent),
          })
        }
      })
    })
    const prev = JSON.stringify(goal.custom_data?.linkedAssets || [])
    const next = JSON.stringify(linked)
    if (prev === next) continue
    await api.updateFinancialGoal(goal.id, {
      custom_data: { ...(goal.custom_data || {}), linkedAssets: linked },
    }).catch(() => {})
  }
}

async function syncAssetEarmarksFromGoals(api, goalRows) {
  const assetsRes = await api.getFinancialAssets().catch(() => ({}))
  const assets = asList(assetsRes, 'assets')
  for (const asset of assets) {
    const earmarks = []
    goalRows.forEach((row) => {
      if (!realId(row.id)) return
      ;(row.links || []).forEach((e) => {
        if (String(e.id || e.assetId) === String(asset.id)) {
          earmarks.push({
            goalId: row.id,
            goalName: row.name || 'Goal',
            percent: num(e.pct ?? e.percent),
          })
        }
      })
    })
    const prev = JSON.stringify(asset.custom_data?.goalEarmarks || [])
    const next = JSON.stringify(earmarks)
    if (prev === next) continue
    await api.updateFinancialAsset(asset.id, {
      custom_data: { ...(asset.custom_data || {}), goalEarmarks: earmarks },
    }).catch(() => {})
  }
}

export async function saveMockupState(page, userId, state, options = {}) {
  if (!userId || !state) return
  const api = bindFinancialApi(userId, options.admin)
  try {

  if (page === 'fp' && state.S) {
    const S = state.S
    const workTenure = Math.max(0, num(S.workTill) - num(S.age))
    const payload = {
      age: num(S.age),
      current_annual_gross_income: num(S.salary),
      work_tenure_years: workTenure,
      total_asset_gross_market_value: num(S.finAssets) + num(S.personalAssets),
      personal_asset_value: num(S.personalAssets),
      total_loan_outstanding_value: (S.loans || []).reduce((s, l) => s + num(l.v), 0),
      lifespan_years: num(S.lifeTo, 85),
      income_growth_rate: asRate(S.gSal, 0.08),
      asset_growth_rate: asRate(S.gRet, 0.11),
      inflation_rate: asRate(S.gInf, 0.06),
      household: (S.household || []).map((m, i) => ({
        id: m.id || `hh-${i}`,
        n: m.n || '',
        rel: m.rel || 'Spouse',
        age: num(m.age),
        income: num(m.income),
        g: num(m.g, S.gSal),
        workTill: num(m.workTill, S.workTill),
      })),
    }
    writeAssumptions({
      inflationRate: payload.inflation_rate,
      assetGrowthRate: payload.asset_growth_rate,
      incomeGrowthRate: payload.income_growth_rate,
      lifespanYears: payload.lifespan_years,
      age: payload.age,
    })
    await upsertProfile(api, payload)
    return
  }

  if (page === 'assets') {
    if (!Array.isArray(state.ROWS)) return
    await ensureProfile(api)
    const res = await api.getFinancialAssets().catch(() => ({}))
    await syncCollection({
      existing: asList(res, 'assets'),
      next: state.ROWS || [],
      create: (body) => api.createFinancialAsset(body),
      update: (id, body) => api.updateFinancialAsset(id, body),
      remove: (id) => api.deleteFinancialAsset(id),
      payload: (row, prior) => ({
        name: row.name || 'Asset',
        tag: row.tag || 'Investment',
        current_value: num(row.val),
        category: row.cat || 'Other',
        sip_amount: num(row.sip),
        sip_frequency: row.freq || 'Monthly',
        sip_expiry_date: row.exp || null,
        expected_return: asRate(row.ret, 0.06),
        maturity_date: row.mat || null,
        maturity_value: num(row.mval) > 0 ? num(row.mval) : null,
        notes: row.notes || '',
        custom_data: {
          ...(prior?.custom_data || {}),
          sipAmount: num(row.sip),
          sipFrequency: row.freq || 'Monthly',
          sipExpiryDate: row.exp || '',
          expectedReturn: num(row.ret),
          maturityDate: row.mat || '',
          maturityValue: num(row.mval),
          notes: row.notes || '',
          cat: row.cat || 'Other',
          goalEarmarks: (row.tag || '') === 'Personal' ? [] : asGoalEarmarks(row.earmarks),
        },
      }),
    })
    await syncGoalLinksFromAssets(api, state.ROWS || [])
    const rows = state.ROWS || []
    const fin = rows.filter((r) => (r.tag || '') !== 'Personal').reduce((s, r) => s + num(r.val), 0)
    const personal = rows.filter((r) => (r.tag || '') === 'Personal').reduce((s, r) => s + num(r.val), 0)
    const profileRes = await api.getFinancialProfile().catch(() => null)
    const current = profileRes?.profile
    const lump = floorLump(current?.total_asset_gross_market_value, fin + personal)
    const personalLump = floorLump(current?.personal_asset_value, personal)
    await upsertProfile(api, {
      total_asset_gross_market_value: lump,
      personal_asset_value: personalLump,
    }).catch(() => {})
    state.UNASSIGNED = unassignedOf(lump, fin + personal)
    return
  }

  if (page === 'work') {
    if (!Array.isArray(state.ROWS)) return
    const agePatch = state.AGE ? { age: num(state.AGE) } : {}
    await ensureProfile(api, agePatch)
    const res = await api.getWorkAssets().catch(() => [])
    await syncCollection({
      existing: asList(res, 'workAssets', 'assets', 'data'),
      next: (state.ROWS || []).map((row) => ({ ...row, name: row.name })),
      create: (body) => api.createWorkAsset(body),
      update: (id, body) => api.updateWorkAsset(id, body),
      remove: (id) => api.deleteWorkAsset(id),
      payload: (row) => ({
        stream: row.name || 'Income stream',
        amount: num(row.amt),
        growthRate: asRate(row.g, 0.05),
        endAge: num(row.end, 65) || 65,
        notes: row.notes || '',
        color: row.c || null,
      }),
    })
    if (state.AGE || workAnnual(state.ROWS)) {
      const profileRes = await api.getFinancialProfile().catch(() => null)
      const current = profileRes?.profile
      const patch = {}
      if (state.AGE) patch.age = num(state.AGE)
      if (Object.keys(patch).length) {
        await upsertProfile(api, patch).catch(() => {})
      }
      const salary = num(current?.current_annual_gross_income)
      const streams = workAnnual(state.ROWS)
      const tenure = Math.max(1, num(current?.work_tenure_years, 28))
      state.UNASSIGNED = unassignedOf(salary, streams) * tenure
    }
    return
  }

  if (page === 'goals') {
    if (!Array.isArray(state.ROWS)) return
    const res = await api.getFinancialGoals().catch(() => ({}))
    const age = num(state.AGE, 32)
    await syncCollection({
      existing: asList(res, 'goals'),
      next: state.ROWS || [],
      create: (body) => api.createFinancialGoal(body),
      update: (id, body) => api.updateFinancialGoal(id, body),
      remove: (id) => api.deleteFinancialGoal(id),
      payload: (row, prior) => ({
        name: row.name || 'Goal',
        description: row.name || 'Goal',
        target_amount: num(row.cost),
        target_year: thisYear() + Math.max(0, num(row.at, age) - age),
        target_age: num(row.at),
        category: row.cat || 'Other',
        flexibility: row.flex || 'Committed',
        span_years: num(row.span, 1),
        inflation_pct: num(row.inf, 6),
        notes: row.notes || '',
        custom_data: {
          ...(prior?.custom_data || {}),
          lifemap: {
            cat: row.cat,
            flex: row.flex,
            span: row.span,
            inf: row.inf,
            notes: row.notes,
            at: row.at,
          },
          linkedAssets: asLinkedAssets(row.links),
          linkedIncomes: asLinkedIncomes(row.incomeLinks),
        },
      }),
    })
    await syncAssetEarmarksFromGoals(api, state.ROWS || [])
    const assetGrowthRate = asRate(state.RET, 0.11)
    writeAssumptions({ assetGrowthRate, age })
    await upsertProfile(api, { age, asset_growth_rate: assetGrowthRate }).catch(() => {})
    return
  }

  if (page === 'loans') {
    if (!Array.isArray(state.ROWS) && !Array.isArray(state.PLAN)) return
    const [res, plannedRes] = await Promise.all([
      api.getFinancialLoans().catch(() => ({})),
      api.getPlannedLoans().catch(() => ({})),
    ])
    await syncCollection({
      existing: asList(res, 'loans'),
      next: Array.isArray(state.ROWS) ? state.ROWS : undefined,
      create: (body) => api.createFinancialLoan(body),
      update: (id, body) => api.updateFinancialLoan(id, body),
      remove: (id) => api.deleteFinancialLoan(id),
      payload: (row) => ({
        lender: row.prov || 'Lender',
        name: row.name || '',
        type: row.cat || 'Other',
        principal_outstanding: num(row.bal),
        rate: num(row.rate),
        emi: num(row.emi),
        frequency: row.freq || 'Monthly',
        notes: row.notes || '',
        end_date: row.end ? `${num(row.end)}-12-31` : undefined,
      }),
    })
    await syncCollection({
      existing: asList(plannedRes, 'plannedLoans', 'loans'),
      next: Array.isArray(state.PLAN) ? state.PLAN : undefined,
      create: (body) => api.createPlannedLoan(body),
      update: (id, body) => api.updatePlannedLoan(id, body),
      remove: (id) => api.deletePlannedLoan(id),
      payload: (row) => ({
        lender: row.prov || '',
        name: row.name || '',
        type: row.cat || 'Other',
        principal: num(row.bal),
        rate: num(row.rate),
        emi: num(row.emi),
        frequency: row.freq || 'Monthly',
        start_year: num(row.start, thisYear() + 1),
        notes: row.notes || '',
      }),
    })
    return
  }

  if (page === 'expenses') {
    if (!Array.isArray(state.ROWS)) return
    const res = await api.getFinancialExpenses().catch(() => ({}))
    const existing = asList(res, 'expenses')
    const age = num(state.AGE, 32)
    const lifespanYears = num(state.LIFE, 90)
    const next = [...(state.ROWS || [])]
    const nextIds = new Set(next.filter((row) => realId(row.id)).map((row) => String(row.id)))
    existing.forEach((row) => {
      if (isLinkedExpense(row) && !nextIds.has(String(row.id))) {
        next.push(toExpenseRow(row, age, lifespanYears))
      }
    })
    state.ROWS = next
    await syncCollection({
      existing,
      next,
      create: (body) => api.createFinancialExpense(body),
      update: (id, body) => api.updateFinancialExpense(id, body),
      remove: (id) => api.deleteFinancialExpense(id),
      protect: isLinkedExpense,
      payload: (row, prior) => {
        if (isLinkedExpense(prior || row)) {
          return {
            notes: row.notes || '',
            payment_from: row.src || '',
            personal_inflation: asRate(row.inf, 0.06),
            start_age: num(row.from),
            end_age: num(row.to),
          }
        }
        return {
          description: row.sub || row.cat || 'Expense',
          amount: num(row.amt),
          frequency: row.freq === 'Half-yearly' ? 'Half-yearly' : (row.freq || 'Monthly'),
          category: row.cat || 'Other',
          tag_for: row.type || 'Need',
          need_type: row.type || 'Need',
          payment_from: row.src || '',
          personal_inflation: asRate(row.inf, 0.06),
          notes: row.notes || '',
          start_age: num(row.from),
          end_age: num(row.to),
        }
      },
    })
    const inflationRate = asRate(state.GINF, 0.06)
    writeAssumptions({ inflationRate, lifespanYears, age })
    await upsertProfile(api, {
      inflation_rate: inflationRate,
      lifespan_years: lifespanYears,
      age,
    }).catch(() => {})
  }
  } finally {
    refreshPlanStore(userId, options).catch(() => {})
  }
}

export async function refreshPlanStore(userId, options = {}) {
  if (!userId) return
  const api = bindFinancialApi(userId, options.admin)
  const [profileRes, assets, work, expenses, loans, goals] = await Promise.all([
    api.getFinancialProfile().catch(() => null),
    api.getFinancialAssets().catch(() => ({})),
    api.getWorkAssets().catch(() => []),
    api.getFinancialExpenses().catch(() => ({})),
    api.getFinancialLoans().catch(() => ({})),
    api.getFinancialGoals().catch(() => ({})),
  ])
  const profile = profileRes?.profile || null
  publishPlanToStore({
    profile,
    assets,
    work,
    expenses,
    loans,
    goals,
    assumptions: profileAssumptions(profile),
  })
}
