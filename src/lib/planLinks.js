import { useLifeSheetStore } from '../store/enhanced-store'

export const FREQ_PER_YEAR = {
  Weekly: 52,
  Fortnightly: 26,
  Monthly: 12,
  Quarterly: 4,
  'Semi-Annually': 2,
  'Half-yearly': 2,
  Annually: 1,
  Yearly: 1,
}

export function num(v, fallback = 0) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export function asList(data, ...keys) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key]
  }
  return []
}

export function annualAmount(expense) {
  const amount = num(expense?.amount ?? expense?.amt)
  const freq = expense?.frequency || expense?.freq || 'Monthly'
  return amount * (FREQ_PER_YEAR[freq] || 12)
}

export function livingExpensesPresentValue(list, age, lifespan, inflation) {
  const years = Math.max(0, Math.round(num(lifespan, 85) - num(age, 32)))
  const inf = inflation > 1 ? inflation / 100 : num(inflation, 0.06)
  let pv = 0
  fpLivingExpenses(list).forEach((expense) => {
    const start = num(expense.start_age ?? expense.from, age)
    const end = num(expense.end_age ?? expense.to, lifespan)
    const annual = annualAmount(expense)
    const personal = num(expense.personal_inflation ?? expense.inf, inf)
    const growth = personal > 1 ? personal / 100 : personal
    for (let t = 0; t < years; t++) {
      const at = num(age) + t
      if (at < start || at > end) continue
      pv += annual * Math.pow(1 + growth, t) / Math.pow(1 + inf, t)
    }
  })
  return pv
}

export function isLoanLinked(row) {
  return Boolean(row?.loan_id)
}

export function isInsuranceLinked(row) {
  return Boolean(row?.insurance_id)
}

export function unassignedOf(lump, itemised) {
  return Math.max(0, num(lump) - num(itemised))
}

export function floorLump(lump, itemised) {
  return Math.max(num(lump), num(itemised))
}

export function fpLivingExpenses(list) {
  return asList(list, 'expenses').filter((row) => !isLoanLinked(row))
}

export function fpEditableExpenses(list) {
  return asList(list, 'expenses').filter((row) => !isLoanLinked(row) && !isInsuranceLinked(row))
}

function loanEndYear(loan) {
  const raw = loan?.end_date || loan?.end
  if (!raw) return null
  if (typeof raw === 'number' && raw > 1900) return raw
  const match = String(raw).match(/^(\d{4})/)
  return match ? Number(match[1]) : null
}

export function splitAssets(assets) {
  const rows = asList(assets, 'assets')
  const financial = rows
    .filter((a) => (a.tag || '') !== 'Personal')
    .reduce((s, a) => s + num(a.current_value ?? a.val), 0)
  const personal = rows
    .filter((a) => (a.tag || '') === 'Personal')
    .reduce((s, a) => s + num(a.current_value ?? a.val), 0)
  return { financial, personal, total: financial + personal }
}

export function workAnnual(list) {
  return asList(list, 'workAssets', 'assets', 'data')
    .reduce((s, row) => s + num(row.amount ?? row.amt), 0)
}

export function combinedSalary(profile, workRows) {
  return floorLump(profile?.current_annual_gross_income, workAnnual(workRows))
}

export function combinedAssets(profile, assetRows) {
  const split = splitAssets(assetRows)
  const lumpTotal = num(profile?.total_asset_gross_market_value)
  const lumpPersonal = num(profile?.personal_asset_value)
  const lumpFinancial = Math.max(0, lumpTotal - lumpPersonal)
  return {
    financial: floorLump(lumpFinancial, split.financial),
    personal: floorLump(lumpPersonal, split.personal),
    unassigned: unassignedOf(lumpTotal, split.total),
    itemised: split.total,
  }
}

export function horizonYears(age, lifespan) {
  return Math.max(1, Math.round(num(lifespan, 85) - num(age, 32)))
}

export function parseHousehold(raw) {
  let list = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  return Array.isArray(list) ? list : []
}

export function householdAnnual(list) {
  return parseHousehold(list).reduce((s, row) => s + num(row.income), 0)
}

export function combinedWorkUnassigned(profile, workRows) {
  const salary = num(profile?.current_annual_gross_income)
  const itemised = workAnnual(workRows)
  const tenure = Math.max(1, num(profile?.work_tenure_years, 28))
  return unassignedOf(salary, itemised) * tenure
}

function projectSip({ initial, sip, freq, rate, years, expiry }) {
  const growth = 1 + num(rate)
  const per = FREQ_PER_YEAR[freq] || 0
  const annualSip = num(sip) * per
  let remainingSipYears = years
  if (expiry) {
    const left = (new Date(expiry) - new Date()) / (365.25 * 24 * 3600 * 1000)
    remainingSipYears = Math.max(0, Math.min(years, left))
  }
  let value = num(initial)
  for (let t = 0; t < years; t++) {
    value = value * growth + (t < remainingSipYears ? annualSip : 0)
  }
  return value
}

export function publishPlanToStore({
  profile,
  assets,
  work,
  expenses,
  loans,
  goals,
  assumptions,
}) {
  const store = useLifeSheetStore.getState()
  const age = num(profile?.age ?? assumptions?.age, 32)
  const assetsCombined = combinedAssets(profile, assets)
  const inflation = num(assumptions?.inflationRate ?? profile?.inflation_rate, 0.06)
  const incomeGrowth = num(assumptions?.incomeGrowthRate ?? profile?.income_growth_rate, 0.08)
  const assetGrowth = num(assumptions?.assetGrowthRate ?? profile?.asset_growth_rate, 0.11)
  const equitySplit = num(assumptions?.assetEquitySplit, 0.6)
  const equityGrowth = num(assumptions?.equityGrowthRate ?? assumptions?.assetEquityGrowthRate ?? profile?.equity_growth_rate, 0.15)
  const debtGrowth = num(assumptions?.debtGrowthRate ?? assumptions?.assetDebtGrowthRate ?? profile?.debt_growth_rate, 0.07)
  const tenure = num(profile?.work_tenure_years, 28)
  const lifespan = num(profile?.lifespan_years ?? assumptions?.lifespanYears, 85)
  const years = horizonYears(age, lifespan)
  const workTillAge = age + tenure
  const currentYear = new Date().getFullYear()
  const assetRows = asList(assets, 'assets')
  const workRows = asList(work, 'workAssets', 'assets', 'data')
  const expenseRows = asList(expenses, 'expenses')
  const loanRows = asList(loans, 'loans')
  const household = parseHousehold(profile?.household)

  const portfolioSeries = {}
  const incomeSeries = {}
  const expenseSeries = {}
  const emiSeries = {}
  const unassignedAssets = assetsCombined.unassigned
  const salaryLump = num(profile?.current_annual_gross_income)

  for (let yearOffset = 0; yearOffset <= years; yearOffset++) {
    const year = currentYear + yearOffset
    let portfolio = 0
    assetRows.forEach((asset) => {
      const extra = asset.custom_data || {}
      portfolio += projectSip({
        initial: num(asset.current_value),
        sip: num(asset.sip_amount ?? extra.sipAmount),
        freq: asset.sip_frequency || extra.sipFrequency || '',
        rate: num(asset.expected_return ?? extra.expectedReturn, assetGrowth * 100) > 1
          ? num(asset.expected_return ?? extra.expectedReturn, assetGrowth * 100) / 100
          : num(asset.expected_return ?? extra.expectedReturn, assetGrowth),
        years: yearOffset,
        expiry: asset.sip_expiry_date || extra.sipExpiryDate || '',
      })
    })
    if (unassignedAssets > 0) {
      portfolio += unassignedAssets * equitySplit * Math.pow(1 + equityGrowth, yearOffset)
      portfolio += unassignedAssets * (1 - equitySplit) * Math.pow(1 + debtGrowth, yearOffset)
    }
    portfolioSeries[year] = Math.round(portfolio)

    let income = 0
    const at = age + yearOffset
    if (at < workTillAge) {
      income += salaryLump * Math.pow(1 + incomeGrowth, yearOffset)
    }
    workRows.forEach((row) => {
      const endAge = num(row.endAge ?? row.end, 65)
      if (at <= endAge) {
        const growth = num(row.growthRate ?? row.g, 5)
        const rate = growth > 1 ? growth / 100 : growth
        income += num(row.amount ?? row.amt) * Math.pow(1 + rate, yearOffset)
      }
    })
    household.forEach((row) => {
      const till = num(row.workTill ?? row.work_till, workTillAge)
      const amt = num(row.income)
      if (amt > 0 && at <= till) {
        const growth = num(row.g ?? row.growth, incomeGrowth * 100)
        const rate = growth > 1 ? growth / 100 : growth
        income += amt * Math.pow(1 + rate, yearOffset)
      }
    })
    incomeSeries[year] = Math.round(income)

    let living = 0
    fpLivingExpenses(expenseRows).forEach((expense) => {
      const start = num(expense.start_age, age)
      const end = num(expense.end_age, lifespan)
      const at = age + yearOffset
      if (at < start || at > end) return
      const inf = num(expense.personal_inflation, inflation)
      const rate = inf > 1 ? inf / 100 : inf
      living += annualAmount(expense) * Math.pow(1 + rate, yearOffset)
    })
    expenseSeries[year] = Math.round(living)

    emiSeries[year] = Math.round(
      loanRows.reduce((sum, loan) => {
        const until = loanEndYear(loan)
        if (until && year > until) return sum
        return sum + num(loan.emi) * 12
      }, 0)
    )
  }

  store.setDetailAssets(portfolioSeries)
  store.setDetailIncome(incomeSeries)
  store.setDetailExpenses(expenseSeries)
  store.setDetailEmi(emiSeries)
  store.hydrateMainInputs({
    age,
    income0: salaryLump + workAnnual(work) + householdAnnual(household),
    workTenureYears: tenure,
    assets0: assetsCombined.financial + assetsCombined.personal,
    expenses0: fpLivingExpenses(expenseRows).reduce((s, e) => s + annualAmount(e), 0),
    g_income: incomeGrowth,
    r_assets: assetGrowth,
    i_expenses: inflation,
    lifespanYears: lifespan,
  })
  store.setLoans(loanRows)
  store.setExpenses(expenseRows)
  store.setGoals(asList(goals, 'goals'))
}
