
import React, { useEffect, useRef, useState } from 'react';
import EditableGrid from '@/components/EditableGrid.jsx';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminUser } from '@/contexts/AdminUserContext';
import ApiService from '@/services/api';
import { useLifeSheetStore } from '@/store/enhanced-store';
import { refreshPlanStore } from '@/lib/mockupSync';
import { asList, livingExpensesPresentValue } from '@/lib/planLinks';
import { AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import PagePager from '@/components/PagePager.jsx';

export default function InsurancePage() {
  const { user } = useAuth();
  const adminUser = useAdminUser();
  
  // Check if we're in admin mode
  const isAdminMode = !!adminUser?.userId;
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null);
  const effectiveIsAuthenticated = isAdminMode || !!user;
  const [rows, setRows] = useState([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [loading, setLoading] = useState(true);
  const [savingRows, setSavingRows] = useState(new Set());
  
  // Get financial data from store - same as OriginalLifeSheet
  const { main, setLoans: setStoreLoans, setExpenses: setStoreExpenses, setGoals: setStoreGoals, hydrateMainInputs, sourcePreferences } = useLifeSheetStore();
  
  // Local state for formData, loans, expenses, goals - same as OriginalLifeSheet
  const [formData, setFormData] = useState({
    age: '',
    currentAnnualGrossIncome: '',
    workTenureYears: '',
    totalAssetGrossMarketValue: '',
    totalLoanOutstandingValue: '',
    loanTenureYears: '',
    lifespanYears: 85,
    incomeGrowthRate: 0.06,
    inflationRate: 0.06,
    assetEquitySplit: 0.60,
    assetEquityGrowthRate: 0.15,
    assetDebtGrowthRate: 0.07
  });
  
  const [loans, setLoans] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [goals, setGoals] = useState([]);
  
  // Format currency helper - same as OriginalLifeSheet
  const formatCurrency = (amount) => {
    const numAmount = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
    const isNegative = numAmount < 0;
    const absAmount = Math.abs(numAmount);
    
    let formatted;
    if (absAmount >= 10000000) {
      formatted = `${(absAmount / 10000000).toFixed(1)}Cr`;
    } else if (absAmount >= 100000) {
      formatted = `${(absAmount / 100000).toFixed(1)}L`;
    } else if (absAmount >= 1000) {
      formatted = `${(absAmount / 1000).toFixed(1)}K`;
    } else {
      formatted = `${absAmount.toFixed(0)}`;
    }
    
    return `${isNegative ? '-' : ''}₹${formatted}`;
  };
  
  // Calculate values from left pane cells (same as OriginalLifeSheet)
  const annualOf = (expense) => {
    const amount = parseFloat(expense.amount) || 0
    const per = { Weekly: 52, Fortnightly: 26, Monthly: 12, Quarterly: 4, 'Semi-Annually': 2, 'Half-yearly': 2, Annually: 1, Yearly: 1 }
    return amount * (per[expense.frequency] || 12)
  }
  const totalLoans = loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
  const totalExpenses = expenses
    .filter((expense) => !expense.loan_id)
    .reduce((sum, expense) => sum + annualOf(expense), 0);
  const totalGoals = goals.reduce((sum, goal) => sum + (parseFloat(goal.amount) || 0), 0);
  
  // Calculate values (Quick Calculator or Detailed based on source preferences) - EXACT SAME as OriginalLifeSheet
  const calculateQuickCalculatorValues = () => {
    const { detail } = useLifeSheetStore.getState();
    const useDetailedAssets = detail?.assets?.portfolioSeries && Object.keys(detail.assets.portfolioSeries).length > 0;
    const useDetailedIncome = detail?.workIncome?.series && Object.keys(detail.workIncome.series).length > 0;
    const useDetailedExpenses = detail?.expenses?.series && Object.keys(detail.expenses.series).length > 0;
    
    // If using detailed calculations, use them with inflation discounting
    if (useDetailedAssets || useDetailedIncome || useDetailedExpenses) {
      return calculateDetailedValues();
    }
    
    // Otherwise use Quick Calculator logic
    const currentIncome = parseFloat(formData.currentAnnualGrossIncome) || 0;
    const workTenure = parseInt(formData.workTenureYears) || 0;
    const incomeGrowth = (formData.incomeGrowthRate !== undefined && formData.incomeGrowthRate !== null && formData.incomeGrowthRate !== '') 
      ? parseFloat(formData.incomeGrowthRate) : 0.06;
    const inflation = (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '') 
      ? parseFloat(formData.inflationRate) : 0.06;
    
    // Total Assets: 60:40 split, project with growth rates, discount by inflation
    const totalAssets = parseFloat(formData.totalAssetGrossMarketValue) || 0;
    const equitySplit = (formData.assetEquitySplit !== undefined && formData.assetEquitySplit !== null && formData.assetEquitySplit !== '') 
      ? parseFloat(formData.assetEquitySplit) : 0.60;
    const equityPortion = totalAssets * equitySplit;
    const debtPortion = totalAssets * (1 - equitySplit);
    const equityGrowth = (formData.assetEquityGrowthRate !== undefined && formData.assetEquityGrowthRate !== null && formData.assetEquityGrowthRate !== '') 
      ? parseFloat(formData.assetEquityGrowthRate) : 0.15;
    const debtGrowth = (formData.assetDebtGrowthRate !== undefined && formData.assetDebtGrowthRate !== null && formData.assetDebtGrowthRate !== '') 
      ? parseFloat(formData.assetDebtGrowthRate) : 0.07;
    
    // Project assets year by year, discounting each year's value
    let projectedEquity = equityPortion;
    let projectedDebt = debtPortion;
    for (let year = 0; year < workTenure; year++) {
      projectedEquity *= (1 + equityGrowth);
      projectedDebt *= (1 + debtGrowth);
      projectedEquity /= (1 + inflation);
      projectedDebt /= (1 + inflation);
    }
    const totalProjectedAssets = projectedEquity + projectedDebt;
    
    // Financial Goals: Discount by inflation (no projection)
    const discountedGoals = totalGoals / (1 + inflation);
    
    // Expenses: Project by inflation, discount by inflation
    const remainingLife = Math.max(0, (parseInt(formData.lifespanYears) || 85) - (parseInt(formData.age) || 0));
    let totalProjectedExpenses = 0;
    for (let year = 0; year < remainingLife; year++) {
      const projectedExpense = totalExpenses * Math.pow(1 + inflation, year);
      const discountedExpense = projectedExpense / Math.pow(1 + inflation, year);
      totalProjectedExpenses += discountedExpense;
    }
    
    // EMIs: Discount by inflation (no projection) - include in expenses to avoid double counting
    const totalEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
    const discountedEmi = totalEmi / (1 + inflation);
    
    // Total Future Expenses includes both regular expenses and EMIs (discounted)
    const totalFutureExpensesWithEmi = totalProjectedExpenses + discountedEmi;
    
    return {
      totalExistingAssets: totalProjectedAssets,
      totalExistingLiabilities: totalLoans,
      totalHumanCapital: 0, // Not used in insurance page
      totalFutureExpenses: totalFutureExpensesWithEmi,
      totalFinancialGoals: discountedGoals,
      discountedEmi,
      surplusDeficit: totalProjectedAssets - totalLoans - totalFutureExpensesWithEmi - discountedGoals
    };
  };
  
  // Calculate using detailed data with inflation discounting - EXACT SAME as OriginalLifeSheet
  const calculateDetailedValues = () => {
    const { detail } = useLifeSheetStore.getState();
    const inflation = (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '') 
      ? parseFloat(formData.inflationRate) : 0.06;
    
    const currentYear = new Date().getFullYear();
    const age = parseInt(formData.age || 30);
    const targetAge = 80;
    const projectionYears = Math.max(0, targetAge - age);
    const workTenure = parseInt(formData.workTenureYears) || 0;
    
    // Assets: Use detailed if available, otherwise quick calculator
    let totalProjectedAssets = 0;
    if (detail?.assets?.portfolioSeries && Object.keys(detail.assets.portfolioSeries).length > 0) {
      const startingAssetsNominal = detail.assets.portfolioSeries[currentYear] || parseFloat(formData.totalAssetGrossMarketValue) || 0;
      const finalYear = currentYear + workTenure;
      const assetsNominal = detail.assets.portfolioSeries[finalYear] || startingAssetsNominal;
      totalProjectedAssets = assetsNominal / Math.pow(1 + inflation, workTenure);
    } else {
      // Quick calculator assets
      const totalAssets = parseFloat(formData.totalAssetGrossMarketValue) || 0;
      const equitySplit = (formData.assetEquitySplit !== undefined && formData.assetEquitySplit !== null && formData.assetEquitySplit !== '') 
        ? parseFloat(formData.assetEquitySplit) : 0.60;
      const equityPortion = totalAssets * equitySplit;
      const debtPortion = totalAssets * (1 - equitySplit);
      const equityGrowth = (formData.assetEquityGrowthRate !== undefined && formData.assetEquityGrowthRate !== null && formData.assetEquityGrowthRate !== '') 
        ? parseFloat(formData.assetEquityGrowthRate) : 0.15;
      const debtGrowth = (formData.assetDebtGrowthRate !== undefined && formData.assetDebtGrowthRate !== null && formData.assetDebtGrowthRate !== '') 
        ? parseFloat(formData.assetDebtGrowthRate) : 0.07;
      
      let projectedEquity = equityPortion;
      let projectedDebt = debtPortion;
      for (let year = 0; year < workTenure; year++) {
        projectedEquity *= (1 + equityGrowth);
        projectedDebt *= (1 + debtGrowth);
        projectedEquity /= (1 + inflation);
        projectedDebt /= (1 + inflation);
      }
      totalProjectedAssets = projectedEquity + projectedDebt;
    }
    
    // Expenses: living series and EMI series are stored separately
    const remainingLife = Math.max(0, (parseInt(formData.lifespanYears) || 85) - age);
    let totalFutureExpenses = 0;
    if (detail?.expenses?.series && Object.keys(detail.expenses.series).length > 0) {
      const emiSeries = detail?.loans?.series || {};
      for (let yearOffset = 0; yearOffset < remainingLife; yearOffset++) {
        const year = currentYear + yearOffset;
        const expensesNominal = (detail.expenses.series[year] || 0) + (emiSeries[year] || 0);
        const expensesPresentValue = expensesNominal / Math.pow(1 + inflation, yearOffset);
        totalFutureExpenses += expensesPresentValue;
      }
    } else {
      // Quick calculator expenses + EMIs
      let totalProjectedExpenses = 0;
      for (let year = 0; year < remainingLife; year++) {
        const projectedExpense = totalExpenses * Math.pow(1 + inflation, year);
        const discountedExpense = projectedExpense / Math.pow(1 + inflation, year);
        totalProjectedExpenses += discountedExpense;
      }
      const totalEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
      const discountedEmi = totalEmi / (1 + inflation);
      totalFutureExpenses = totalProjectedExpenses + discountedEmi;
    }
    
    // Financial Goals: Discount by inflation (no projection)
    const discountedGoals = totalGoals / (1 + inflation);
    
    return {
      totalExistingAssets: totalProjectedAssets,
      totalExistingLiabilities: totalLoans,
      totalHumanCapital: 0, // Not used in insurance page
      totalFutureExpenses,
      totalFinancialGoals: discountedGoals,
      surplusDeficit: totalProjectedAssets - totalLoans - totalFutureExpenses - discountedGoals
    };
  };
  
  const calculations = (() => {
    const age = parseInt(formData.age, 10) || 32;
    const lifespan = parseInt(formData.lifespanYears, 10) || 85;
    const inflationRaw = (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '')
      ? parseFloat(formData.inflationRate) : 0.06;
    const inflation = inflationRaw > 1 ? inflationRaw / 100 : inflationRaw;
    const storeExpenses = useLifeSheetStore.getState().expenses;
    const expenseRows = (expenses && expenses.length)
      ? expenses
      : asList(storeExpenses, 'expenses');
    const livingPv = livingExpensesPresentValue(expenseRows, age, lifespan, inflation);
    const totalEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
    const discountedEmi = totalEmi / (1 + inflation);
    const totalFutureExpenses = livingPv + discountedEmi;
    const base = calculateQuickCalculatorValues();
    return {
      ...base,
      totalFutureExpenses,
      surplusDeficit: base.totalExistingAssets - totalLoans - totalFutureExpenses - base.totalFinancialGoals,
    };
  })();
  
  // Calculate insurance needed from net total (without Human Capital)
  const netTotal = calculations.totalExistingAssets - calculations.totalExistingLiabilities - calculations.totalFutureExpenses - calculations.totalFinancialGoals;
  const insuranceNeeded = netTotal < 0 ? Math.abs(netTotal) : 0;

  // Load financial data - same as OriginalLifeSheet
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      loadInsurance();
      refreshPlanStore(effectiveUserId, { admin: isAdminMode }).catch(() => {});

      try {
        const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
        if (Object.keys(quickCalcAssumptions).length > 0) {
          setFormData(prev => ({
            ...prev,
            inflationRate: quickCalcAssumptions.inflationRate !== undefined ? quickCalcAssumptions.inflationRate : prev.inflationRate,
            incomeGrowthRate: quickCalcAssumptions.incomeGrowthRate !== undefined ? quickCalcAssumptions.incomeGrowthRate : prev.incomeGrowthRate,
            assetEquitySplit: quickCalcAssumptions.assetEquitySplit !== undefined ? quickCalcAssumptions.assetEquitySplit : prev.assetEquitySplit,
            assetEquityGrowthRate: quickCalcAssumptions.assetEquityGrowthRate !== undefined ? quickCalcAssumptions.assetEquityGrowthRate : prev.assetEquityGrowthRate,
            assetDebtGrowthRate: quickCalcAssumptions.assetDebtGrowthRate !== undefined ? quickCalcAssumptions.assetDebtGrowthRate : prev.assetDebtGrowthRate
          }));
        }
      } catch (e) {
        console.warn('Failed to load Quick Calculator assumptions from localStorage:', e);
      }
      
      // Load financial profile
      const profilePromise = isAdminMode
        ? ApiService.getFinancialProfileForUser(effectiveUserId)
        : ApiService.getFinancialProfile(effectiveUserId);
      profilePromise.then(res => {
        const profile = res.profile || res;
        if (profile) {
          setFormData(prev => ({
            ...prev,
            age: profile.age || '',
            currentAnnualGrossIncome: profile.current_annual_gross_income || '',
            workTenureYears: profile.work_tenure_years || '',
            totalAssetGrossMarketValue: profile.total_asset_gross_market_value || '',
            totalLoanOutstandingValue: profile.total_loan_outstanding_value || '',
            lifespanYears: profile.lifespan_years || 85,
            incomeGrowthRate: profile.income_growth_rate != null ? parseFloat(profile.income_growth_rate) : prev.incomeGrowthRate,
            inflationRate: profile.inflation_rate != null ? parseFloat(profile.inflation_rate) : prev.inflationRate,
            assetEquityGrowthRate: profile.equity_growth_rate != null ? parseFloat(profile.equity_growth_rate) : prev.assetEquityGrowthRate,
            assetDebtGrowthRate: profile.debt_growth_rate != null ? parseFloat(profile.debt_growth_rate) : prev.assetDebtGrowthRate
          }));
        }
      }).catch(error => {
        console.error('❌ Profile fetch error:', error);
      });
      
      // Load loans
      const loansPromise = isAdminMode
        ? ApiService.getFinancialLoansForUser(effectiveUserId)
        : ApiService.getFinancialLoans(effectiveUserId);
      loansPromise.then(res => {
        const mappedLoans = (res.loans || []).map(loan => ({
          ...loan,
          description: loan.provider || loan.lender || loan.name || '',
          amount: parseFloat(loan.principal_outstanding || loan.amount || 0)
        }));
        setLoans(mappedLoans);
      }).catch(error => {
        console.error('❌ Loans fetch error:', error);
      });
      
      // Load goals
      const goalsPromise = isAdminMode
        ? ApiService.getFinancialGoalsForUser(effectiveUserId)
        : ApiService.getFinancialGoals(effectiveUserId);
      goalsPromise.then(res => {
        const mappedGoals = (res.goals || []).map(goal => ({
          ...goal,
          amount: parseFloat(goal.target_amount || goal.amount || 0)
        }));
        setGoals(mappedGoals);
      }).catch(error => {
        console.error('❌ Goals fetch error:', error);
      });
      
      // Load expenses
      const expensesPromise = isAdminMode
        ? ApiService.getFinancialExpensesForUser(effectiveUserId)
        : ApiService.getFinancialExpenses(effectiveUserId);
      expensesPromise.then(res => {
        const expensesData = asList(res, 'expenses', 'data');
        setExpenses(expensesData);
      }).catch(error => {
        console.error('❌ Expenses fetch error:', error);
      });
    } else if (!effectiveIsAuthenticated) {
      // If not authenticated, set loading to false immediately
      setLoading(false);
    }
  }, [effectiveIsAuthenticated, effectiveUserId, isAdminMode]);

  const loadInsurance = async () => {
    if (!effectiveUserId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = isAdminMode
        ? await ApiService.getFinancialInsuranceForUser(effectiveUserId)
        : await ApiService.getFinancialInsurance(effectiveUserId);
      const insurance = Array.isArray(response?.insurance)
        ? response.insurance
        : (Array.isArray(response) ? response : []);
      
      // Map database fields to frontend field names
      const mappedInsurance = insurance.map(policy => ({
        id: policy.id,
        policyType: policy.policy_type,
        cover: policy.cover,
        premium: policy.premium,
        frequency: policy.frequency || 'Yearly',
        provider: policy.provider,
        policyNumber: policy.policy_number,
        startDate: policy.start_date || '',
        endDate: policy.end_date || '',
        expiryYear: policy.end_date ? parseInt(policy.end_date.split('-')[0]) : '',
        notes: policy.notes,
        user_id: policy.user_id,
        created_at: policy.created_at,
        updated_at: policy.updated_at
      }));
      
      setRows(mappedInsurance);
    } catch (error) {
      console.error('Error loading insurance:', error);
    } finally {
      setLoading(false);
    }
  };

  const persistInsuranceRow = async (row, rowIndex) => {
    const policyType = String(row?.policyType || '').trim() || 'Term life';
    const cover = parseFloat(row.cover) || 0;
    const premium = parseFloat(row.premium) || 0;
    const hasSubstance = cover > 0 || premium > 0
      || String(row.provider || '').trim()
      || String(row.policyNumber || '').trim()
      || String(row.notes || '').trim()
      || String(row.policyType || '').trim();
    if (!hasSubstance) return;

    const isoDate = (v) => {
      if (!v) return null;
      const s = String(v).trim();
      if (!s) return null;
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
    };
    const frequency = (() => {
      const k = String(row.frequency || 'Yearly').trim().toLowerCase();
      if (k === 'monthly') return 'Monthly';
      if (k === 'quarterly') return 'Quarterly';
      if (k === 'half-yearly' || k === 'semi-annually' || k === 'semi annually') return 'Half-yearly';
      return 'Yearly';
    })();
    const endDate = isoDate(row.endDate) || (row.expiryYear ? `${parseInt(row.expiryYear, 10)}-12-31` : null);
    const payload = {
      policy_type: policyType,
      cover,
      premium,
      frequency,
      provider: row.provider || null,
      policy_number: row.policyNumber || null,
      start_date: isoDate(row.startDate),
      end_date: endDate,
      notes: row.notes || null,
    };
    const create = (body) => isAdminMode
      ? ApiService.createFinancialInsuranceForUser(body, effectiveUserId)
      : ApiService.createFinancialInsurance(body);
    const update = (id, body) => isAdminMode
      ? ApiService.updateFinancialInsuranceForUser(id, body, effectiveUserId)
      : ApiService.updateFinancialInsurance(id, body);

    if (row.id && !String(row.id).startsWith('temp_')) {
      await update(row.id, payload);
      return;
    }
    if (String(row.id || '').startsWith('temp_')) {
      const created = await create(payload);
      const newId = created?.insurance?.id || created?.id;
      if (newId != null && rowIndex != null) {
        setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, id: newId, policyType } : r)));
      }
    }
  };

  useEffect(() => () => {
    rowsRef.current.forEach((row, index) => {
      persistInsuranceRow(row, index).catch((error) => console.error('Error flushing insurance save', error));
    });
  }, []);

  const addRow = () => {
    const newRow = {
      id: `temp_${Date.now()}`,
      policyType: 'Term life',
      cover: 0,
      premium: 0,
      frequency: 'Yearly',
      provider: '',
      policyNumber: '',
      startDate: '',
      endDate: '',
      expiryYear: new Date().getFullYear() + 10, // Default to 10 years from now
      notes: ''
    };
    setRows([...rows, newRow]);
  };

  const delRow = async (rowIndex) => {
    const row = rows[rowIndex];
    
    if (row.id && !row.id.toString().startsWith('temp_')) {
      try {
        await (isAdminMode
          ? ApiService.deleteFinancialInsuranceForUser(row.id, effectiveUserId)
          : ApiService.deleteFinancialInsurance(row.id));
        setRows(rows.filter((_, i) => i !== rowIndex));
      } catch (error) {
        console.error('Error deleting insurance:', error);
      }
    } else {
      setRows(rows.filter((_, i) => i !== rowIndex));
    }
  };

  const handleCellChange = (rowIndex, field, value) => {
    try {
      const updatedRows = [...rows];
      updatedRows[rowIndex] = { ...updatedRows[rowIndex], [field]: value };
      setRows(updatedRows);

      const row = updatedRows[rowIndex];
      
      // Debounce auto-save
      const timeoutKey = `insurance_row_${rowIndex}`;
      clearTimeout(window[timeoutKey]);
      
      window[timeoutKey] = setTimeout(() => {
        persistInsuranceRow(row, rowIndex).catch((error) => console.error('Error saving insurance:', error));
      }, 400);
    } catch (error) {
      console.error('Error in handleCellChange:', error);
    }
  };

  const handleReset = () => {
    loadInsurance();
  };

  const handleExportCsv = () => {
    const headers = ['Policy Type', 'Cover Amt.', 'Premium', 'Frequency', 'Provider', 'Policy No.', 'Start Date', 'End Date', 'Notes'];
    const csvRows = rows.map(row => ([
      row.policyType || '',
      row.cover ?? '',
      row.premium ?? '',
      row.frequency || '',
      row.provider || '',
      row.policyNumber || '',
      row.startDate || '',
      row.endDate || '',
      row.notes || ''
    ]));
    const content = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `insurance-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Calculate summary statistics
  const coverBucket = (type) => {
    const t = String(type || '').toLowerCase();
    if (/health|mediclaim|floater|top-?up/.test(t)) return 'health';
    if (/motor|car|two.?wheeler|travel|home|house|fire|property/.test(t)) return 'other';
    if (/term|life|ulip|endow|whole|pension/.test(t)) return 'life';
    return 'other';
  };
  const coverByType = rows.reduce((acc, policy) => {
    const amount = parseFloat(policy.cover) || 0;
    acc[coverBucket(policy.policyType)] += amount;
    return acc;
  }, { life: 0, health: 0, other: 0 });
  const lifeCover = coverByType.life;
  const totalAnnualPremium = rows.reduce((sum, policy) => {
    const premium = parseFloat(policy.premium) || 0;
    const k = String(policy.frequency || 'Yearly').toLowerCase();
    if (k === 'monthly') return sum + premium * 12;
    if (k === 'quarterly') return sum + premium * 4;
    if (k === 'half-yearly' || k === 'semi-annually' || k === 'semi annually') return sum + premium * 2;
    return sum + premium;
  }, 0);
  
  // Gap vs what the family would need uses life / term cover only
  const uncoveredInsurance = Math.max(0, insuranceNeeded - lifeCover);

  const columns = [
    { field: 'policyType', headerName: 'Policy Type', type: 'select', options: (row) => {
      const base = ['Term life', 'Whole life', 'ULIP', 'Endowment', 'Health', 'Super top-up', 'Personal accident', 'Motor', 'Home', 'Travel', 'Other'];
      if (row?.policyType && !base.includes(row.policyType)) return [row.policyType, ...base];
      return base;
    } },
    { field: 'cover', headerName: 'Cover Amount', type: 'number' },
    { field: 'premium', headerName: 'Premium', type: 'number' },
    { field: 'frequency', headerName: 'Frequency', type: 'select', options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'] },
    { field: 'provider', headerName: 'Provider' },
    { field: 'policyNumber', headerName: 'Policy No.' },
    { field: 'startDate', headerName: 'Start Date', type: 'date' },
    { field: 'endDate', headerName: 'End Date', type: 'date' },
    { field: 'notes', headerName: 'Notes' }
  ];

  if (loading) {
    return (
      <div className="lm-body">
        <div className="lm-card" style={{ padding: 48, textAlign: 'center', color: 'var(--lm-muted)' }}>
          Loading insurance…
        </div>
      </div>
    );
  }

  return (
    <div className="lm-body">
      <PageHeader
        title="What you are protected by"
        description="Policies you already hold, and the gap between cover and what your family would actually need. Add each policy in the register below."
      />
      {rows.length === 0 && (
        <div className="lm-alert">
          <AlertTriangle className="h-4 w-4" />
          <span>
            Start adding your policies in the insurance register below. You may add as many
            policies as you want.
          </span>
        </div>
      )}

      <div id="sec-mix" className="lm-card" style={{ marginBottom: 16 }}>
        <div className="lm-reghead">
          <h3>Cover gap</h3>
          {insuranceNeeded > 0 ? (
            <span className="lm-pill">Needed {formatCurrency(insuranceNeeded)}</span>
          ) : null}
        </div>
        <div className="lm-gapgrid">
          <div className="lm-gapcol">
            <h4>What you have</h4>
            <div className="lm-grow pos">
              <span>Existing assets</span>
              <b>+ {formatCurrency(calculations.totalExistingAssets)}</b>
            </div>
            <div className="lm-grow tot pos">
              <span>Total</span>
              <b>+ {formatCurrency(calculations.totalExistingAssets)}</b>
            </div>
            <div className="lm-grow">
              <span>Life cover</span>
              <b>{formatCurrency(lifeCover)}</b>
            </div>
            <div className={`lm-grow ${uncoveredInsurance > 0 ? 'neg' : 'pos'}`}>
              <span>Uncovered</span>
              <b>{formatCurrency(uncoveredInsurance)}</b>
            </div>
          </div>
          <div className="lm-gapcol">
            <h4>What would need funding</h4>
            <div className="lm-grow neg">
              <span>Existing liabilities</span>
              <b>− {formatCurrency(calculations.totalExistingLiabilities)}</b>
            </div>
            <div className="lm-grow neg">
              <span>Future expenses</span>
              <b>− {formatCurrency(calculations.totalFutureExpenses)}</b>
            </div>
            <div className="lm-grow neg">
              <span>Goals</span>
              <b>− {formatCurrency(calculations.totalFinancialGoals)}</b>
            </div>
            <div className="lm-grow tot neg">
              <span>Total</span>
              <b>− {formatCurrency(calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals)}</b>
            </div>
          </div>
        </div>
      </div>

      <div className="lm-stats">
        <div className="lm-stat">
          <div className="k">Life cover</div>
          <div className="v">{formatCurrency(lifeCover)}</div>
        </div>
        <div className="lm-stat">
          <div className="k">Health cover</div>
          <div className="v">{formatCurrency(coverByType.health)}</div>
        </div>
        <div className="lm-stat">
          <div className="k">Other cover</div>
          <div className="v">{formatCurrency(coverByType.other)}</div>
        </div>
        <div className="lm-stat">
          <div className="k">Annual premiums</div>
          <div className="v">{formatCurrency(totalAnnualPremium)}</div>
        </div>
      </div>

      <div id="sec-register" className="lm-card">
        <div className="lm-reghead">
          <h3>Insurance register</h3>
          <span className="count">{rows.length} policies</span>
          <div className="r">
            <button type="button" className="lm-ghost primary" onClick={addRow}>+ Add policy</button>
            <button type="button" className="lm-ghost" onClick={handleExportCsv}>Export CSV</button>
            <button type="button" className="lm-ghost" onClick={handleReset}>Reset</button>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <EditableGrid
            columns={columns}
            rows={rows}
            onChange={setRows}
            onAdd={addRow}
            onDelete={delRow}
            onCellChange={handleCellChange}
          />
        </div>
      </div>

      {savingRows.size > 0 && (
        <div className="lm-note" style={{ textAlign: 'left' }}>Saving changes…</div>
      )}
      <PagePager />
    </div>
  );
}
