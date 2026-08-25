import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { Progress } from '@/components/ui/progress.jsx'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ComposedChart, Area, AreaChart, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Calculator, Target, DollarSign, PiggyBank, User, Save, RefreshCw, Plus, Trash2, Shield, Users, Briefcase, CreditCard, ShoppingCart, UserCircle, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAdminUser } from '../contexts/AdminUserContext'
import { useChart } from '../contexts/ChartContext'
import { useLifeSheetStore } from '../store/enhanced-store'
import AuthModal from './AuthModal'
import ApiService from '../services/api'
import '../styles/professional-theme.css'

export default function OriginalLifeSheet() {
  const { user, logout, isAuthenticated } = useAuth()
  const adminUser = useAdminUser()
  const navigate = useNavigate()
  
  // Check if we're in admin mode
  const isAdminMode = !!adminUser?.userId
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null)
  const effectiveIsAuthenticated = isAdminMode || isAuthenticated
  const { chartData } = useChart()
  const { setDetailAssets } = useLifeSheetStore()
  const { updateLifeSheet, addGoal: addStoreGoal, updateGoal: updateStoreGoal, deleteGoal: deleteStoreGoal, addExpense: addStoreExpense, updateExpense: updateStoreExpense, deleteExpense: deleteStoreExpense, addLoan: addStoreLoan, updateLoan: updateStoreLoan, deleteLoan: deleteStoreLoan, setLoans: setStoreLoans, setExpenses: setStoreExpenses, setGoals: setStoreGoals, lifeSheet, setMainInputs, hydrateMainInputs, setSourcePreference, sourcePreferences, loadSourcePreferences } = useLifeSheetStore()
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authModalTab, setAuthModalTab] = useState('login')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [heroOpen, setHeroOpen] = useState(false);
  
  
  // Core financial data based on Excel analysis
  const [formData, setFormData] = useState({
    age: '',
    currentAnnualGrossIncome: '',
    workTenureYears: '',
    totalAssetGrossMarketValue: '',
    totalLoanOutstandingValue: '',
    loanTenureYears: '',
    
    // Calculation assumptions
    lifespanYears: 85,
    incomeGrowthRate: 0.06,  // Income growth rate (editable)
    assetGrowthRate: 0.06,   // Asset growth rate (editable)
    inflationRate: 0.06,     // Inflation rate for discounting
    assetEquitySplit: 0.60,  // 60% equity, 40% debt
    assetEquityGrowthRate: 0.15,  // 15% equity growth
    assetDebtGrowthRate: 0.07    // 7% debt growth
  })
  
  // Dynamic goals and expenses
  const [goals, setGoals] = useState([])
  const [expenses, setExpenses] = useState([])
  const [assets, setAssets] = useState([])
  const [insurance, setInsurance] = useState([])
  
  // Get calculated values from store (ChatGPT's fix - single source of truth)
  const currentYear = new Date().getFullYear();
  const currentYearData = chartData?.find(d => d.year === currentYear) || {};

  // Handle user input changes (these should take precedence over detailed data)
  const handleUserInputChange = (field, value) => {
    setFormData({...formData, [field]: value})
    
    // Set source preference to main page (0) when user edits main inputs
    // Map fields to their corresponding source components
    // No longer using source preference - always use combined (detailed + unassigned)
    // No longer using source preference for assets - always use combined (detailed + unassigned)
    
    // Map form fields to store fields and update with user origin
    // Note: inflationRate, assetEquitySplit, assetEquityGrowthRate, assetDebtGrowthRate are frontend-only
    const storeFieldMap = {
      'currentAnnualGrossIncome': 'income0',
      'totalAssetGrossMarketValue': 'initialAssets', 
      'workTenureYears': 'workTenureYears',
      'age': 'age',
      'lifespanYears': 'lifespanYears',
      'incomeGrowthRate': 'g_income',
      'assetGrowthRate': 'r_assets'
    }
    
    const storeField = storeFieldMap[field]
    if (storeField) {
      setMainInputs({
        [storeField]: field === 'age' || field === 'workTenureYears' || field === 'lifespanYears' 
          ? parseInt(value) || 0
          : field === 'incomeGrowthRate' || field === 'assetGrowthRate'
          ? parseFloat(value) || 0
          : parseFloat(value) || 0
      }, { origin: 'user' })
    }
    
    // Save Quick Calculator assumptions to localStorage (frontend-only, not in DB)
    if (field === 'inflationRate' || field === 'assetEquitySplit' || 
        field === 'assetEquityGrowthRate' || field === 'assetDebtGrowthRate') {
      try {
        const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
        quickCalcAssumptions[field] = value;
        localStorage.setItem('quickCalcAssumptions', JSON.stringify(quickCalcAssumptions));
      } catch (e) {
        console.warn('Failed to save Quick Calculator assumptions to localStorage:', e);
      }
    }
  }

  // Handle loan changes
  const handleLoanChange = (index, field, value) => {
    updateLoan(index, field, value);
    // No longer using source preference - always use combined (detailed + unassigned)
  }

  // Handle expense changes
  const handleExpenseChange = (index, field, value) => {
    updateExpense(index, field, value);
    // No longer using source preference - always use combined (detailed + unassigned)
  }

  // Handle goal changes
  const handleGoalChange = (index, field, value) => {
    updateGoal(index, field, value);
    // No longer using source preference - always use combined (detailed + unassigned)
  }
  

  // Event dispatching for live chart updates (following Assets page pattern)
  const dispatchGoalsEvent = (updatedGoals) => {
    try {
      const payload = Array.isArray(updatedGoals) ? updatedGoals.map(g => ({ ...g })) : [];
      window.dispatchEvent(new CustomEvent('goalsUpdated', { detail: { goals: payload } }));
      console.log('🔄 LifeSheet: Dispatched goalsUpdated event with', payload.length, 'goals');
      console.log('🔄 LifeSheet: Goals data:', payload);
    } catch (e) {
      console.warn('Failed to dispatch goalsUpdated event:', e);
    }
  };

  const dispatchExpensesEvent = (updatedExpenses) => {
    try {
      const payload = Array.isArray(updatedExpenses) ? updatedExpenses.map(e => ({ ...e })) : [];
      window.dispatchEvent(new CustomEvent('expensesUpdated', { detail: { expenses: payload } }));
      console.log('🔄 LifeSheet: Dispatched expensesUpdated event with', payload.length, 'expenses');
      console.log('🔄 LifeSheet: Expenses data:', payload);
    } catch (e) {
      console.warn('Failed to dispatch expensesUpdated event:', e);
    }
  };

  const dispatchLoansEvent = (updatedLoans) => {
    try {
      const payload = Array.isArray(updatedLoans) ? updatedLoans.map(l => ({ ...l })) : [];
      window.dispatchEvent(new CustomEvent('loansUpdated', { detail: { loans: payload } }));
      console.log('🔄 LifeSheet: Dispatched loansUpdated event with', payload.length, 'loans');
      console.log('🔄 LifeSheet: Loans data:', payload);
    } catch (e) {
      console.warn('Failed to dispatch loansUpdated event:', e);
    }
  };

  const [financialProfile, setFinancialProfile] = useState(null)

  const [loans, setLoans] = useState([])

  // Calculate values from left pane cells (not chart data)
  const totalLoans = loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
  const totalGoals = goals.reduce((sum, goal) => sum + (parseFloat(goal.amount) || 0), 0);
  
  // Calculate values (Quick Calculator or Detailed based on source preferences)
  const calculateQuickCalculatorValues = () => {
    const { detail, sourcePreferences } = useLifeSheetStore.getState();
    // Always use combined (detailed + unassigned) if series exists - no source preference checks
    const useDetailedIncome = detail?.workIncome?.series;
    const useDetailedExpenses = detail?.expenses?.series;
    const useDetailedAssets = detail?.assets?.portfolioSeries;
    const useDetailedLoans = detail?.loans?.series;
    
    // If using detailed calculations, use them with inflation discounting
    if (useDetailedIncome || useDetailedExpenses || useDetailedAssets || useDetailedLoans) {
      return calculateDetailedValues();
    }
    
    // Otherwise use Quick Calculator logic
    const currentIncome = parseFloat(formData.currentAnnualGrossIncome) || 0;
    const workTenure = parseInt(formData.workTenureYears) || 0;
    const incomeGrowth = (formData.incomeGrowthRate !== undefined && formData.incomeGrowthRate !== null && formData.incomeGrowthRate !== '') 
      ? parseFloat(formData.incomeGrowthRate) : 0.06;
    const inflation = (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '') 
      ? parseFloat(formData.inflationRate) : 0.06;
    
    // Total Human Capital: Project income with growth rate, discount by inflation
    let totalHumanCapital = 0;
    for (let year = 0; year < workTenure; year++) {
      const projectedIncome = currentIncome * Math.pow(1 + incomeGrowth, year);
      const discountedIncome = projectedIncome / Math.pow(1 + inflation, year);
      totalHumanCapital += discountedIncome;
    }
    
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
    // For table: show present value of assets at end of work tenure
    let projectedEquity = equityPortion;
    let projectedDebt = debtPortion;
    for (let year = 0; year < workTenure; year++) {
      projectedEquity *= (1 + equityGrowth);
      projectedDebt *= (1 + debtGrowth);
      // Discount each year's growth
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
      totalProjectedExpenses += discountedExpense; // Net: just sum of base expenses
    }
    
    // EMIs: Discount by inflation (no projection) - include in expenses to avoid double counting
    const totalEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
    const discountedEmi = totalEmi / (1 + inflation); // Discount current year EMI
    
    // Total Future Expenses includes both regular expenses and EMIs (discounted)
    const totalFutureExpensesWithEmi = totalProjectedExpenses + discountedEmi;
    
    return {
      totalExistingAssets: totalProjectedAssets,
      totalExistingLiabilities: totalLoans,
      totalHumanCapital,
      totalFutureExpenses: totalFutureExpensesWithEmi,
      totalFinancialGoals: discountedGoals,
      discountedEmi,
      surplusDeficit: totalProjectedAssets + totalHumanCapital - totalLoans - totalFutureExpensesWithEmi - discountedGoals
    };
  };
  
  // Update portfolio series when totalAssetGrossMarketValue changes in FP calculator
  // This ensures unassigned assets are calculated even if user hasn't visited Assets page
  const updatePortfolioSeriesFromFpCalculator = async (fpCalculatorValue) => {
    console.log('🔄 FP Calculator: updatePortfolioSeriesFromFpCalculator called with value:', fpCalculatorValue);
    try {
      // Load current detailed assets from API (if any exist)
      let detailedAssets = [];
      try {
        const assetsResponse = isAdminMode
          ? await ApiService.getFinancialAssetsForUser(effectiveUserId)
          : await ApiService.getFinancialAssets(effectiveUserId);
        detailedAssets = assetsResponse.assets || [];
      } catch (error) {
        console.warn('No detailed assets found or error loading:', error);
      }
      
      // Calculate current value of detailed assets
      const detailedAssetsCurrentValue = detailedAssets.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0);
      
      // Calculate unassigned assets = FP calculator value - detailed assets current value
      const unassignedAssetsValue = Math.max(0, fpCalculatorValue - detailedAssetsCurrentValue);
      
      // Get growth assumptions
      const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const assetEquitySplit = parseFloat(quickCalcAssumptions.assetEquitySplit) || 0.60;
      const assetEquityGrowthRate = parseFloat(quickCalcAssumptions.assetEquityGrowthRate) || 0.15;
      const assetDebtGrowthRate = parseFloat(quickCalcAssumptions.assetDebtGrowthRate) || 0.07;
      const defaultAssetGrowthRate = (quickCalcAssumptions.assetGrowthRate || 0.06) * 100; // Convert to percentage
      
      // Calculate portfolio series for each year
      const currentYear = new Date().getFullYear();
      const portfolioSeries = {};
      
      for (let yearOffset = 0; yearOffset <= 50; yearOffset++) {
        const year = currentYear + yearOffset;
        let totalAssets = 0;
        
        // 1. Add detailed assets (with individual expectedReturn)
        detailedAssets.forEach(asset => {
          const value = parseFloat(asset.current_value) || 0;
          const customData = asset.custom_data || {};
          const expectedReturn = parseFloat(customData.expectedReturn) || defaultAssetGrowthRate;
          const growthRate = expectedReturn / 100;
          
          // Simple compound growth (no SIP for now, can be enhanced later)
          const grownValue = value * Math.pow(1 + growthRate, yearOffset);
          totalAssets += grownValue;
        });
        
        // 2. Add unassigned assets (with 60:40 split and equity/debt growth rates)
        if (unassignedAssetsValue > 0) {
          const equityPortion = unassignedAssetsValue * assetEquitySplit;
          const debtPortion = unassignedAssetsValue * (1 - assetEquitySplit);
          
          // Project equity portion
          const equityGrown = equityPortion * Math.pow(1 + assetEquityGrowthRate, yearOffset);
          // Project debt portion
          const debtGrown = debtPortion * Math.pow(1 + assetDebtGrowthRate, yearOffset);
          
          totalAssets += equityGrown + debtGrown;
        }
        
        portfolioSeries[year] = Math.round(totalAssets);
      }
      
      console.log('🔄 FP Calculator: Updating store with portfolio series:', portfolioSeries);
      console.log('🔄 FP Calculator: Detailed assets:', detailedAssets.length, 'Unassigned:', unassignedAssetsValue);
      setDetailAssets(portfolioSeries);
      
    } catch (error) {
      console.error('❌ Error updating portfolio series from FP calculator:', error);
    }
  };

  // Calculate using detailed data with inflation discounting
  const calculateDetailedValues = () => {
    const { detail, sourcePreferences, main } = useLifeSheetStore.getState();
    const inflation = (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '') 
      ? parseFloat(formData.inflationRate) : 0.06;
    
    const currentYear = new Date().getFullYear();
    const age = parseInt(formData.age || 30);
    const targetAge = 80;
    const projectionYears = Math.max(0, targetAge - age);
    const workTenure = parseInt(formData.workTenureYears) || 0;
    
    // Assets: Always use both detailed assets + unassigned assets (from FP calculator)
    let totalProjectedAssets = 0;
    
    // 1. Calculate detailed assets (if available)
    let detailedAssetsProjected = 0;
    if (detail?.assets?.portfolioSeries) {
      // portfolioSeries contains NOMINAL (projected) values
      const startingAssetsNominal = detail.assets.portfolioSeries[currentYear] || 0;
      const finalYear = currentYear + workTenure;
      const assetsNominal = detail.assets.portfolioSeries[finalYear] || startingAssetsNominal;
      
      // Discount the nominal value at end of work tenure back to present value
      detailedAssetsProjected = assetsNominal / Math.pow(1 + inflation, workTenure);
    }
    
    // 2. Calculate unassigned assets (FP calculator value - detailed assets current value)
    const fpCalculatorValue = parseFloat(formData.totalAssetGrossMarketValue) || 0;
    const detailedAssetsCurrentValue = detail?.assets?.portfolioSeries?.[currentYear] || 0;
    const unassignedAssetsValue = Math.max(0, fpCalculatorValue - detailedAssetsCurrentValue);
    
    // Project unassigned assets with 60:40 split
    if (unassignedAssetsValue > 0) {
      const equitySplit = (formData.assetEquitySplit !== undefined && formData.assetEquitySplit !== null && formData.assetEquitySplit !== '') 
        ? parseFloat(formData.assetEquitySplit) : 0.60;
      const equityPortion = unassignedAssetsValue * equitySplit;
      const debtPortion = unassignedAssetsValue * (1 - equitySplit);
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
      const unassignedAssetsProjected = projectedEquity + projectedDebt;
      totalProjectedAssets = detailedAssetsProjected + unassignedAssetsProjected;
    } else {
      totalProjectedAssets = detailedAssetsProjected;
    }
    
    // Human Capital: Always use combined (detailed + unassigned) if available
    let totalHumanCapital = 0;
    if (detail?.workIncome?.series) {
      // Sum detailed income over work tenure, discount by inflation
      for (let yearOffset = 0; yearOffset < workTenure; yearOffset++) {
        const year = currentYear + yearOffset;
        const incomeUnadjusted = detail.workIncome.series[year] || 0;
        const discountedIncome = incomeUnadjusted / Math.pow(1 + inflation, yearOffset);
        totalHumanCapital += discountedIncome;
      }
    } else {
      // Quick calculator human capital
      const currentIncome = parseFloat(formData.currentAnnualGrossIncome) || 0;
      const incomeGrowth = (formData.incomeGrowthRate !== undefined && formData.incomeGrowthRate !== null && formData.incomeGrowthRate !== '') 
        ? parseFloat(formData.incomeGrowthRate) : 0.06;
      for (let year = 0; year < workTenure; year++) {
        const projectedIncome = currentIncome * Math.pow(1 + incomeGrowth, year);
        const discountedIncome = projectedIncome / Math.pow(1 + inflation, year);
        totalHumanCapital += discountedIncome;
      }
    }
    
    // Expenses: living series and EMI series are stored separately
    const remainingLife = Math.max(0, (parseInt(formData.lifespanYears) || 85) - age);
    let totalFutureExpenses = 0;
    if (detail?.expenses?.series) {
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
      totalHumanCapital,
      totalFutureExpenses,
      totalFinancialGoals: discountedGoals,
      surplusDeficit: totalProjectedAssets + totalHumanCapital - totalLoans - totalFutureExpenses - discountedGoals
    };
  };
  
  const calculations = calculateQuickCalculatorValues();

  // Debug: Log calculations and chartData
  React.useEffect(() => {
    console.log('🔄 OriginalLifeSheet: Page mounted/updated');
    console.log('🔄 OriginalLifeSheet: calculations:', calculations);
    console.log('🔄 OriginalLifeSheet: chartData length:', chartData?.length);
    console.log('🔄 OriginalLifeSheet: chartData sample:', chartData?.slice(0, 3));
    console.log('🔄 OriginalLifeSheet: Full chartData:', chartData);
  }, [calculations, chartData]);

  // Update portfolio series when totalAssetGrossMarketValue changes
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId && formData.totalAssetGrossMarketValue) {
      const fpValue = parseFloat(formData.totalAssetGrossMarketValue);
      if (fpValue > 0) {
        updatePortfolioSeriesFromFpCalculator(fpValue);
      }
    }
  }, [formData.totalAssetGrossMarketValue, effectiveIsAuthenticated, effectiveUserId]);

  // Load Quick Calculator assumptions from localStorage on mount and when it changes
  useEffect(() => {
    const loadAssumptions = () => {
      try {
        const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
        if (Object.keys(quickCalcAssumptions).length > 0) {
          setFormData(prev => ({
            ...prev,
            assetGrowthRate: quickCalcAssumptions.assetGrowthRate !== undefined ? quickCalcAssumptions.assetGrowthRate : prev.assetGrowthRate,
            incomeGrowthRate: quickCalcAssumptions.incomeGrowthRate !== undefined ? quickCalcAssumptions.incomeGrowthRate : prev.incomeGrowthRate,
            inflationRate: quickCalcAssumptions.inflationRate !== undefined ? quickCalcAssumptions.inflationRate : prev.inflationRate,
            lifespanYears: quickCalcAssumptions.lifespanYears !== undefined ? quickCalcAssumptions.lifespanYears : prev.lifespanYears,
            assetEquitySplit: quickCalcAssumptions.assetEquitySplit !== undefined ? quickCalcAssumptions.assetEquitySplit : prev.assetEquitySplit,
            assetEquityGrowthRate: quickCalcAssumptions.assetEquityGrowthRate !== undefined ? quickCalcAssumptions.assetEquityGrowthRate : prev.assetEquityGrowthRate,
            assetDebtGrowthRate: quickCalcAssumptions.assetDebtGrowthRate !== undefined ? quickCalcAssumptions.assetDebtGrowthRate : prev.assetDebtGrowthRate
          }));
        }
      } catch (e) {
        console.warn('Failed to load Quick Calculator assumptions from localStorage:', e);
      }
    };

    // Load on mount
    loadAssumptions();

    // Listen for storage changes (when Growth Assumptions page saves)
    const handleStorageChange = (e) => {
      if (e.key === 'quickCalcAssumptions' || e.key === null) {
        loadAssumptions();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom event (for same-tab updates)
    const handleCustomStorageChange = () => {
      loadAssumptions();
    };
    window.addEventListener('quickCalcAssumptionsUpdated', handleCustomStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('quickCalcAssumptionsUpdated', handleCustomStorageChange);
    };
  }, []);

  // Load user's financial data when authenticated or in admin mode
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      loadFinancialData()
      
      // Load source preferences from database (only for regular users, not in admin mode)
      if (!isAdminMode) {
        loadSourcePreferences()
      }
      
      // Load loans based on source preference
      const loadLoansBasedOnSource = async () => {
        try {
          if (isAdminMode) {
            // Admin mode: Always load from database
            console.log('🏦 Admin mode: Loading loans for user', effectiveUserId);
            const res = await ApiService.getFinancialLoansForUser(effectiveUserId);
            console.log('🏦 Loans fetch response:', res)
            const mappedLoans = (res.loans || []).map(loan => ({
              ...loan,
              description: loan.provider || loan.lender || loan.name || ''
            }));
            setLoans(mappedLoans);
            dispatchLoansEvent(mappedLoans);
            const mappedLoansForStore = mappedLoans.map(loan => ({
              ...loan,
              principal_outstanding: loan.amount,
              lender: loan.description
            }))
            setStoreLoans(mappedLoansForStore);
          } else {
            // Regular user mode: Check source preference
            const sourcePrefs = await ApiService.getSourcePreferences();
            console.log('🏦 Current source preferences:', sourcePrefs);
            
            if (sourcePrefs.loans === 0) {
              console.log('🏦 Using Quick Calculator loan data from store');
              const { main } = useLifeSheetStore.getState();
              console.log('🏦 Store quickEmiByYear:', main.quickEmiByYear);
            } else {
              console.log('🏦 Using Detailed loan data from database');
              const res = await ApiService.getFinancialLoans(effectiveUserId);
              console.log('🏦 Loans fetch response:', res)
              const mappedLoans = (res.loans || []).map(loan => ({
                ...loan,
                description: loan.provider || loan.lender || loan.name || ''
              }));
              console.log('🏦 Mapped loans with descriptions:', mappedLoans.map(l => ({ id: l.id, description: l.description, lender: l.lender })));
              setLoans(mappedLoans);
              dispatchLoansEvent(mappedLoans);
              const mappedLoansForStore = mappedLoans.map(loan => ({
                ...loan,
                principal_outstanding: loan.amount,
                lender: loan.description
              }))
              setStoreLoans(mappedLoansForStore);
            }
          }
        } catch (error) {
          console.error('❌ Loans loading error:', error)
        }
      };
      
      loadLoansBasedOnSource();
      
      // Load goals
      const loadGoalsPromise = isAdminMode
        ? ApiService.getFinancialGoalsForUser(effectiveUserId)
        : ApiService.getFinancialGoals(effectiveUserId);
      
      loadGoalsPromise.then(res => {
        console.log('🎯 Goals fetch response:', res)
        const mappedGoals = (res.goals || []).map(goal => ({
          ...goal,
          amount: parseFloat(goal.target_amount) || parseFloat(goal.amount) || 0
        }));
        setGoals(mappedGoals);
        dispatchGoalsEvent(mappedGoals);
        setStoreGoals(mappedGoals);
      }).catch(error => {
        console.error('❌ Goals fetch error:', error)
      })
      
      // Load expenses
      const loadExpensesPromise = isAdminMode
        ? ApiService.getFinancialExpensesForUser(effectiveUserId)
        : ApiService.getFinancialExpenses(effectiveUserId);
      
      loadExpensesPromise.then(res => {
        console.log('💰 Expenses fetch response:', res)
        const expensesData = (res.expenses || []).map(expense => {
          // Convert expenses to annual amounts for front page display
          // If annual_budget exists, use it; otherwise calculate from amount * frequency
          let annualAmount = parseFloat(expense.amount) || 0;
          const frequency = expense.frequency || 'Monthly';
          
          // If annual_budget is stored, use it (for expenses from Expenses page)
          if (expense.annual_budget !== undefined && expense.annual_budget !== null) {
            annualAmount = parseFloat(expense.annual_budget) || 0;
          } else {
            // Calculate annual amount from frequency
            if (frequency === 'Weekly') annualAmount = annualAmount * 52;
            else if (frequency === 'Fortnightly') annualAmount = annualAmount * 26;
            else if (frequency === 'Monthly') annualAmount = annualAmount * 12;
            else if (frequency === 'Quarterly') annualAmount = annualAmount * 4;
            else if (frequency === 'Semi-Annually') annualAmount = annualAmount * 2;
            // If frequency is 'Annually', amount is already annual
          }
          
          return {
            ...expense,
            amount: annualAmount, // Store annual amount for front page
            frequency: 'Annually' // Front page always shows annual
          };
        });
        setExpenses(expensesData);
        dispatchExpensesEvent(expensesData);
        setStoreExpenses(expensesData);
      }).catch(error => {
        console.error('❌ Expenses fetch error:', error)
      })

      // Load assets
      const loadAssetsPromise = isAdminMode
        ? ApiService.getFinancialAssetsForUser(effectiveUserId)
        : ApiService.getFinancialAssets(effectiveUserId);
      
      loadAssetsPromise.then(res => {
        const assetsData = res.assets || [];
        setAssets(assetsData);
      }).catch(error => {
        console.error('❌ Assets fetch error:', error);
      });

      // Load insurance
      const loadInsurancePromise = isAdminMode
        ? ApiService.getFinancialInsuranceForUser(effectiveUserId)
        : ApiService.getFinancialInsurance(effectiveUserId);
      
      loadInsurancePromise.then(res => {
        const insuranceData = res.insurance || [];
        setInsurance(insuranceData);
      }).catch(error => {
        console.error('❌ Insurance fetch error:', error);
      });
    }
  }, [effectiveIsAuthenticated, effectiveUserId, isAdminMode])

  // Update store when local data changes (ChatGPT's fix - use hydrateMainInputs for system updates)
  useEffect(() => {
    if (isAuthenticated && user) {
      console.log('🔄 OriginalLifeSheet: Hydrating main inputs (system update)');
      
      // Calculate expenses0 from expenses array
      const totalExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
      
      // Calculate quickEmiByYear from loans array
      const quickEmiByYear = {};
      const currentYear = new Date().getFullYear();
      const horizonYears = (parseInt(formData.lifespanYears) || 85) - (parseInt(formData.age) || 0);
      
      console.log('🔄 EMI Calculation Debug:', {
        loans: loans.map(l => ({ id: l.id, emi: l.emi, description: l.description })),
        currentYear,
        horizonYears
      });
      
      for (let i = 0; i < horizonYears; i++) {
        const year = currentYear + i;
        const annualEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
        quickEmiByYear[year] = annualEmi;
        if (i < 3) { // Log first 3 years
          console.log(`🔄 Year ${year} EMI calculation:`, { annualEmi, loans: loans.map(l => ({ emi: l.emi, monthlyEmi: parseFloat(l.emi) || 0 })) });
        }
      }
      
      console.log('🔄 Final quickEmiByYear:', quickEmiByYear);
      
      // Hydrate main inputs for Net Worth system (doesn't bump lastEditedAt)
      hydrateMainInputs({
        initialAssets: parseFloat(formData.totalAssetGrossMarketValue) || 0,
        startYear: currentYear,
        horizonYears: horizonYears,
        r_assets: parseFloat(formData.assetGrowthRate) || 0.06,
        g_income: parseFloat(formData.incomeGrowthRate) || 0.06,
        i_expenses: parseFloat(formData.inflationRate) || 0.06, // Use expense inflation rate from Growth Assumptions
        workTenureYears: parseInt(formData.workTenureYears) || 35,
        income0: parseFloat(formData.currentAnnualGrossIncome) || 0,
        expenses0: totalExpenses, // Calculate from expenses array
        quickEmiByYear: quickEmiByYear // Calculate from loans array
      })
      
      // Also update legacy lifeSheet for compatibility
      updateLifeSheet({
        age: formData.age,
        currentAnnualGrossIncome: formData.currentAnnualGrossIncome,
        workTenureYears: formData.workTenureYears,
        totalAssetGrossMarketValue: formData.totalAssetGrossMarketValue,
        totalLoanOutstandingValue: formData.totalLoanOutstandingValue,
        lifespanYears: formData.lifespanYears,
        incomeGrowthRate: formData.incomeGrowthRate,
        assetGrowthRate: formData.assetGrowthRate,
        inflationRate: formData.inflationRate,
        assetEquitySplit: formData.assetEquitySplit,
        assetEquityGrowthRate: formData.assetEquityGrowthRate,
        assetDebtGrowthRate: formData.assetDebtGrowthRate
      })
    }
  }, [formData, expenses, loans, effectiveIsAuthenticated, effectiveUserId, hydrateMainInputs, updateLifeSheet])

  // Update store goals when local goals change
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      // Always sync goals to store, even if empty
      goals.forEach(goal => {
        if (goal.id && !goal.isNew) {
          updateStoreGoal(goal.id, {
            name: goal.description,
            targetAmount: goal.amount,
            targetDate: goal.target_date,
            recommendedAllocation: goal.recommended_allocation,
            fundingSource: goal.funding_source
          })
        }
      })
      // Also update the entire goals array in store
      setStoreGoals(goals)
    }
  }, [goals, effectiveIsAuthenticated, effectiveUserId, updateStoreGoal, setStoreGoals])

  // Update store expenses when local expenses change
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      // Always sync expenses to store, even if empty
      expenses.forEach(expense => {
        if (expense.id && !expense.isNew) {
          updateStoreExpense(expense.id, {
            description: expense.description,
            amount: expense.amount,
            frequency: expense.frequency,
            category: expense.category
          })
        }
      })
      // Also update the entire expenses array in store
      setStoreExpenses(expenses)
    }
  }, [expenses, isAuthenticated, user, updateStoreExpense, setStoreExpenses])

  // Update store loans when local loans change
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      // Always sync loans to store, even if empty
      loans.forEach(loan => {
        if (loan.id && !loan.isNew) {
          updateStoreLoan(loan.id, {
            lender: loan.description,
            principalOutstanding: loan.amount,
            emi: loan.emi
          })
        }
      })
      // Also update the entire loans array in store with correct field mapping
      const mappedLoansForStore = loans.map(loan => ({
        ...loan,
        principal_outstanding: loan.amount, // Map amount to principal_outstanding for store
        lender: loan.description // Map description to lender for store
      }))
      setStoreLoans(mappedLoansForStore)
    }
  }, [loans, effectiveIsAuthenticated, effectiveUserId, updateStoreLoan, setStoreLoans])

  // Calculations now come from ChartContext automatically

  const loadFinancialData = async () => {
    if (!effectiveUserId) return;
    try {
      setLoading(true)
      const response = isAdminMode
        ? await ApiService.getFinancialProfileForUser(effectiveUserId)
        : await ApiService.getFinancialProfile(effectiveUserId)
      if (response && response.profile) {
        const profile = response.profile
        // Load from database, but prioritize Quick Calculator assumptions from localStorage
        const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
        setFormData(prev => ({
          age: profile.age || '',
          currentAnnualGrossIncome: profile.current_annual_gross_income || '',
          workTenureYears: profile.work_tenure_years || '',
          totalAssetGrossMarketValue: profile.total_asset_gross_market_value || '',
          totalLoanOutstandingValue: profile.total_loan_outstanding_value || '',
          loanTenureYears: profile.loan_tenure_years || '',
          // Prioritize localStorage values over database values for growth rates
          incomeGrowthRate: quickCalcAssumptions.incomeGrowthRate !== undefined ? quickCalcAssumptions.incomeGrowthRate : (profile.income_growth_rate || 0.06),
          assetGrowthRate: quickCalcAssumptions.assetGrowthRate !== undefined ? quickCalcAssumptions.assetGrowthRate : (profile.asset_growth_rate || 0.06),
          // Quick Calculator assumptions (frontend-only, not in DB)
          inflationRate: quickCalcAssumptions.inflationRate !== undefined ? quickCalcAssumptions.inflationRate : (prev.inflationRate || 0.06),
          lifespanYears: quickCalcAssumptions.lifespanYears !== undefined ? quickCalcAssumptions.lifespanYears : (profile.lifespan_years || 85),
          assetEquitySplit: quickCalcAssumptions.assetEquitySplit !== undefined ? quickCalcAssumptions.assetEquitySplit : (prev.assetEquitySplit || 0.60),
          assetEquityGrowthRate: quickCalcAssumptions.assetEquityGrowthRate !== undefined ? quickCalcAssumptions.assetEquityGrowthRate : (prev.assetEquityGrowthRate || 0.15),
          assetDebtGrowthRate: quickCalcAssumptions.assetDebtGrowthRate !== undefined ? quickCalcAssumptions.assetDebtGrowthRate : (prev.assetDebtGrowthRate || 0.07)
        }))
        // Goals and expenses are now fetched separately
        setFinancialProfile(profile)
      } else {
        // If no profile, reset to defaults
        setFormData({
          age: '',
          currentAnnualGrossIncome: '',
          workTenureYears: '',
          totalAssetGrossMarketValue: '',
          totalLoanOutstandingValue: '',
          loanTenureYears: '',
          lifespanYears: 85,
          incomeGrowthRate: 0.06,
          assetGrowthRate: 0.06
        })
        setGoals([])
        setExpenses([])
        setLoans([])
        setFinancialProfile(null)
      }
    } catch (error) {
      // Handle error gracefully, do not crash
      setFormData({
        age: '',
        currentAnnualGrossIncome: '',
        workTenureYears: '',
        totalAssetGrossMarketValue: '',
        totalLoanOutstandingValue: '',
        loanTenureYears: '',
        lifespanYears: 85,
        incomeGrowthRate: 0.06,
        assetGrowthRate: 0.06,
        inflationRate: 0.06,
        assetEquitySplit: 0.60,
        assetEquityGrowthRate: 0.15,
        assetDebtGrowthRate: 0.07
      })
      setGoals([])
      setExpenses([])
      setLoans([])
      setFinancialProfile(null)
      // Only log unexpected errors
      if (!error.message || (!error.message.toLowerCase().includes('not authenticated') && !error.message.toLowerCase().includes('not found'))) {
        console.error('Error loading financial data:', error)
      }
    } finally {
      setLoading(false)
    }
  }

  // Field-level auto-save function
  const saveField = async (fieldName, value) => {
    if (!effectiveIsAuthenticated) {
      if (!isAdminMode) {
        setShowAuthModal(true)
      }
      return
    }

    try {
      setSaving(true)
      
      // Map field name to backend field name
      // Note: inflationRate, assetEquitySplit, assetEquityGrowthRate, assetDebtGrowthRate are frontend-only
      const fieldMapping = {
        age: 'age',
        currentAnnualGrossIncome: 'current_annual_gross_income',
        workTenureYears: 'work_tenure_years',
        totalAssetGrossMarketValue: 'total_asset_gross_market_value',
        totalLoanOutstandingValue: 'total_loan_outstanding_value',
        lifespanYears: 'lifespan_years',
        incomeGrowthRate: 'income_growth_rate',
        assetGrowthRate: 'asset_growth_rate'
      }
      
      const backendField = fieldMapping[fieldName]
      if (!backendField) {
        // Frontend-only fields (Quick Calculator assumptions) - don't save to DB
        return
      }
      
      // Convert value to appropriate type
      let convertedValue = value
      if (fieldName === 'age' || fieldName === 'workTenureYears' || fieldName === 'lifespanYears') {
        convertedValue = value ? parseInt(value) : undefined
      } else if (fieldName === 'currentAnnualGrossIncome' || fieldName === 'totalAssetGrossMarketValue' || 
                 fieldName === 'totalLoanOutstandingValue' || fieldName === 'incomeGrowthRate' || 
                 fieldName === 'assetGrowthRate') {
        convertedValue = value ? parseFloat(value) : undefined
      }
      
      if (convertedValue === undefined) return
      
      const payload = { [backendField]: convertedValue }
      
      let profileResponse
      if (financialProfile) {
        profileResponse = isAdminMode
          ? await ApiService.updateFinancialProfileForUser(financialProfile.id, payload, effectiveUserId)
          : await ApiService.updateFinancialProfile(financialProfile.id, payload)
      } else {
        profileResponse = isAdminMode
          ? await ApiService.createFinancialProfileForUser({ ...payload, userId: effectiveUserId }, effectiveUserId)
          : await ApiService.createFinancialProfile(payload)
      }
      
      if (profileResponse.profile) {
        setFinancialProfile(profileResponse.profile)
        setSaveStatus(`${fieldName} saved`)
        setTimeout(() => setSaveStatus(''), 1000)
        setSaveError('')
      }
    } catch (error) {
      setSaveError(`Error saving ${fieldName}`)
      setTimeout(() => setSaveError(''), 3000)
      console.error(`Error saving ${fieldName}:`, error)
    } finally {
      setSaving(false)
    }
  }

  // Save function for onBlur events
  const saveOnBlur = (fieldName, value) => {
    if (fieldName === 'goal' || fieldName === 'expense' || fieldName === 'loan') {
      // Handle goals, expenses, and loans separately
      saveItem(fieldName, value)
    } else {
      // Handle profile fields
      saveField(fieldName, value)
    }
  }

  // Save individual items (goals, expenses, loans)
  const saveItem = async (itemType, data) => {
    if (!effectiveIsAuthenticated) return

    try {
      setSaving(true)
      
      if (itemType === 'goal' && data.id) {
        if (isAdminMode) {
          await ApiService.updateFinancialGoalForUser(data.id, data, effectiveUserId)
        } else {
          await ApiService.updateFinancialGoal(data.id, data)
        }
        setSaveStatus('Goal updated')
      } else if (itemType === 'expense' && data.id) {
        if (isAdminMode) {
          await ApiService.updateFinancialExpenseForUser(data.id, data, effectiveUserId)
        } else {
          await ApiService.updateFinancialExpense(data.id, data)
        }
        setSaveStatus('Expense updated')
      } else if (itemType === 'loan' && data.id) {
        const payload = { ...data, name: data.description, emi: data.emi === '' ? null : data.emi }
        if (isAdminMode) {
          await ApiService.updateFinancialLoanForUser(data.id, payload, effectiveUserId)
        } else {
          await ApiService.updateFinancialLoan(data.id, payload)
        }
        setSaveStatus('Loan updated')
      }
      
      setTimeout(() => setSaveStatus(''), 1000)
      setSaveError('')
    } catch (error) {
      setSaveError(`Error saving ${itemType}`)
      setTimeout(() => setSaveError(''), 3000)
      console.error(`Error saving ${itemType}:`, error)
    } finally {
      setSaving(false)
    }
  }

  const saveFinancialData = async () => {
    // This function is now just for manual saves - individual fields auto-save
    setSaveStatus('All changes saved')
    setTimeout(() => setSaveStatus(''), 2000)
  }

  const handleLogout = async () => {
    try {
      await logout()
      // Reset all data
      setFormData({
        age: '',
        currentAnnualGrossIncome: '',
        workTenureYears: '',
        totalAssetGrossMarketValue: '',
        totalLoanOutstandingValue: '',
        loanTenureYears: '',
        lifespanYears: 85,
        incomeGrowthRate: 0.06,
        assetGrowthRate: 0.06,
        inflationRate: 0.06,
        assetEquitySplit: 0.60,
        assetEquityGrowthRate: 0.15,
        assetDebtGrowthRate: 0.07
      })
      setGoals([])
      setExpenses([])
      setLoans([])
      // Calculations now come from ChartContext
      setFinancialProfile(null)
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }

  const handleGuestReset = () => {
    setFormData({
      age: '',
      currentAnnualGrossIncome: '',
      workTenureYears: '',
      totalAssetGrossMarketValue: '',
      totalLoanOutstandingValue: '',
      loanTenureYears: '',
      lifespanYears: 85,
      incomeGrowthRate: 0.06,
      assetGrowthRate: 0.06,
      inflationRate: 0.06,
      assetEquitySplit: 0.60,
      assetEquityGrowthRate: 0.15,
      assetDebtGrowthRate: 0.07
    })
    setGoals([])
    setExpenses([])
    setLoans([])
  }

  React.useEffect(() => {
    const handler = (event) => {
      const tab = event?.detail?.tab || 'login'
      setAuthModalTab(tab)
      setShowAuthModal(true)
    }
    window.addEventListener('openAuthModal', handler)
    return () => window.removeEventListener('openAuthModal', handler)
  }, [])

  // calculateFinancials now comes from ChartContext (exactly as specified)


  // Dynamic Goals Management
  const addGoal = () => {
    const newGoal = {
      description: `Goal ${goals.length + 1}`,
      amount: 0,
      orderIndex: goals.length + 1,
      isNew: true
    }
    const updatedGoals = [...goals, newGoal]
    setGoals(updatedGoals)
    dispatchGoalsEvent(updatedGoals)
  }

  const updateGoal = (index, field, value) => {
    const updatedGoals = [...goals]
    updatedGoals[index] = { ...updatedGoals[index], [field]: value }
    setGoals(updatedGoals)
    dispatchGoalsEvent(updatedGoals)
    // No longer using source preference - always use combined (detailed + unassigned)
  }

  const saveGoalOnBlur = async (index, field, value) => {
    if (!isAuthenticated) return
    
    const goal = goals[index]
    if (goal.id) {
      // Update existing goal
      saveOnBlur('goal', { id: goal.id, [field]: value })
    } else if (goal.isNew) {
      // Create new goal
      try {
        setSaving(true)
        const payload = {
          user_id: effectiveUserId,
          profile_id: financialProfile?.id,
          name: goal.description || '',
          target_amount: goal.amount || 0,
          term: 'LT',
          on_track: false
        }
        
        // Only add optional fields if they have valid values
        if (goal.target_date) {
          payload.target_date = goal.target_date
        }
        if (goal.recommended_allocation) {
          payload.recommended_allocation = goal.recommended_allocation
        }
        if (goal.funding_source) {
          payload.funding_source = goal.funding_source
        }
        
        console.log('🎯 Goal creation payload:', payload)
        const response = isAdminMode
          ? await ApiService.createFinancialGoalForUser(payload, effectiveUserId)
          : await ApiService.createFinancialGoal(payload)
        if (response.goal) {
          // Update local state with the new ID
          const updatedGoals = [...goals]
          updatedGoals[index] = { ...goal, id: response.goal.id, isNew: false }
          setGoals(updatedGoals)
          setSaveStatus('Goal created')
          setTimeout(() => setSaveStatus(''), 1000)
        }
      } catch (error) {
        setSaveError('Error creating goal')
        setTimeout(() => setSaveError(''), 3000)
        console.error('Error creating goal:', error)
      } finally {
        setSaving(false)
      }
    }
  }

  const removeGoal = async (index) => {
    const goalToRemove = goals[index];
    if (goalToRemove.id) {
      try {
        if (isAdminMode) {
          await ApiService.deleteFinancialGoalForUser(goalToRemove.id, effectiveUserId)
        } else {
          await ApiService.deleteFinancialGoal(goalToRemove.id)
        }
      } catch (error) {
        console.error('Failed to delete goal from backend:', error);
      }
    }
    const updatedGoals = goals.filter((_, i) => i !== index);
    setGoals(updatedGoals);
    dispatchGoalsEvent(updatedGoals);
  }

  // Dynamic Expenses Management
  const addExpense = () => {
    const newExpense = {
      description: `Expense ${expenses.length + 1}`,
      amount: 0,
      orderIndex: expenses.length + 1,
      isNew: true
    }
    const updatedExpenses = [...expenses, newExpense]
    setExpenses(updatedExpenses)
    dispatchExpensesEvent(updatedExpenses)
  }

  const updateExpense = (index, field, value) => {
    const updatedExpenses = [...expenses]
    updatedExpenses[index] = { ...updatedExpenses[index], [field]: value }
    setExpenses(updatedExpenses)
    dispatchExpensesEvent(updatedExpenses)
    // No longer using source preference - always use combined (detailed + unassigned)
  }

  const saveExpenseOnBlur = async (index, field, value) => {
    if (!isAuthenticated) return
    
    const expense = expenses[index]
    if (expense.id) {
      // Update existing expense
      saveOnBlur('expense', { id: expense.id, [field]: value })
    } else if (expense.isNew) {
      // Create new expense
      try {
        setSaving(true)
        const payload = {
          user_id: effectiveUserId,
          profile_id: financialProfile?.id,
          description: expense.description || 'General',
          amount: expense.amount || 0,
          frequency: 'Annually', // Front page expenses are always annual
          personal_inflation: 0.06,
          source: 'manual',
          notes: null
        }
        
        console.log('💰 Expense creation payload:', payload)
        const response = isAdminMode
          ? await ApiService.createFinancialExpenseForUser(payload, effectiveUserId)
          : await ApiService.createFinancialExpense(payload)
        if (response.expense) {
          // Update local state with the new ID
          const updatedExpenses = [...expenses]
          updatedExpenses[index] = { ...expense, id: response.expense.id, isNew: false }
          setExpenses(updatedExpenses)
          setSaveStatus('Expense created')
          setTimeout(() => setSaveStatus(''), 1000)
        }
      } catch (error) {
        setSaveError('Error creating expense')
        setTimeout(() => setSaveError(''), 3000)
        console.error('Error creating expense:', error)
      } finally {
        setSaving(false)
      }
    }
  }

  const removeExpense = (index) => {
    console.log('🗑️ Main page removeExpense called with index:', index);
    console.log('🗑️ Current expenses:', expenses);
    
    const expenseToRemove = expenses[index];
    if (!expenseToRemove) {
      console.log('❌ Expense not found');
      return;
    }
    
    // Main page only removes from local state - does NOT delete from database
    // This ensures Expenses page is not affected
    console.log('🗑️ Main page: Removing expense from local state only (not from database)');
    
    // No longer using source preference - always use combined (detailed + unassigned)
    
    const updatedExpenses = expenses.filter((_, i) => i !== index);
    setExpenses(updatedExpenses);
    dispatchExpensesEvent(updatedExpenses);
    
    // Update store with new expenses array
    setStoreExpenses(updatedExpenses);
    
    // Trigger immediate recalculation
    const totalExpenses = updatedExpenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
    const currentYear = new Date().getFullYear();
    const horizonYears = (parseInt(formData.lifespanYears) || 85) - (parseInt(formData.age) || 0);
    
    const quickEmiByYear = {};
    for (let i = 0; i < horizonYears; i++) {
      const year = currentYear + i;
      const annualEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
      quickEmiByYear[year] = annualEmi;
    }
    
    // Update main inputs with new values
    setMainInputs({
      expenses0: totalExpenses,
      quickEmiByYear: quickEmiByYear
    }, { origin: 'user' });
    
    setSaveStatus('Expense removed from main page');
    setTimeout(() => setSaveStatus(''), 1000);
  }

  // Loan CRUD handlers using backend
  const addLoan = () => {
    const newLoan = { 
      description: '', 
      amount: '', 
      emi: '', 
      isNew: true,
      _tempId: Date.now() + Math.random() // Unique temporary ID
    };
    const updatedLoans = [...loans, newLoan]
    setLoans(updatedLoans);
    dispatchLoansEvent(updatedLoans);
  }

  const updateLoan = (loanKey, field, value) => {
    console.log('🔄 updateLoan called:', { loanKey, field, value });
    setLoans(loans => {
      const updatedLoans = loans.map((loan, idx) => {
        // Match by ID if it exists, otherwise by tempId, otherwise by index
        const isMatch = loan.id ? loan.id === loanKey : 
                       loan._tempId ? loan._tempId === loanKey : 
                       idx === loanKey;
        if (isMatch) {
          console.log('🔄 Updating loan:', { before: loan, field, value, after: { ...loan, [field]: value } });
        }
        return isMatch ? { ...loan, [field]: value } : loan;
      });
      console.log('🔄 Updated loans array:', updatedLoans.map(l => ({ id: l.id, description: l.description })));
      dispatchLoansEvent(updatedLoans);
      return updatedLoans;
    });
    // No longer using source preference - always use combined (detailed + unassigned)
  }

  const saveLoanOnBlur = async (loanKey, field, value) => {
    if (!isAuthenticated) return
    
    const loan = loans.find((l, idx) => 
      l.id ? l.id === loanKey : 
      l._tempId ? l._tempId === loanKey : 
      idx === loanKey
    );
    
    if (loan && loan.id) {
      // Update existing loan
      saveOnBlur('loan', { id: loan.id, [field]: value })
    } else if (loan && loan.isNew) {
      // Create new loan
      try {
        setSaving(true)
        const payload = {
          user_id: effectiveUserId,
          profile_id: financialProfile?.id,
          lender: loan.description || 'Loan',
          principal_outstanding: loan.amount || 0,
          emi: loan.emi || null
        }
        
        console.log('🏦 Loan creation payload:', payload)
        const response = isAdminMode
          ? await ApiService.createFinancialLoanForUser(payload, effectiveUserId)
          : await ApiService.createFinancialLoan(payload)
        if (response.loan) {
          // Update local state with the new ID
          const updatedLoans = loans.map((l, idx) => {
            const isMatch = l.id ? l.id === loanKey : 
                           l._tempId ? l._tempId === loanKey : 
                           idx === loanKey;
            return isMatch ? { ...l, id: response.loan.id, isNew: false } : l;
          })
          setLoans(updatedLoans)
          setSaveStatus('Loan created')
          setTimeout(() => setSaveStatus(''), 1000)
        }
      } catch (error) {
        setSaveError('Error creating loan')
        setTimeout(() => setSaveError(''), 3000)
        console.error('Error creating loan:', error)
      } finally {
        setSaving(false)
      }
    }
  }

  const removeLoan = (loanKey) => {
    console.log('🗑️ Main page removeLoan called with loanKey:', loanKey);
    console.log('🗑️ Current loans:', loans);
    
    let loanToRemove;
    let loanIndex = -1;
    
    if (typeof loanKey === 'number') {
      // If it's a number, it should be an index
      if (loanKey < loans.length) {
        loanToRemove = loans[loanKey];
        loanIndex = loanKey;
        console.log('🗑️ Found loan by index:', loanToRemove);
      } else {
        console.log('❌ Invalid index:', loanKey, 'loans length:', loans.length);
        return;
      }
    } else {
      // If it's not a number, find by ID or tempId
      loanToRemove = loans.find((loan, idx) => {
        if (loan.id === loanKey || loan._tempId === loanKey) {
          loanIndex = idx;
          return true;
        }
        return false;
      });
      console.log('🗑️ Found loan by ID/tempId:', loanToRemove, 'at index:', loanIndex);
    }
    
    if (!loanToRemove) {
      console.log('❌ Loan not found');
      return;
    }
    
    // Main page only removes from local state - does NOT delete from database
    // This ensures Loans page is not affected
    console.log('🗑️ Main page: Removing loan from local state only (not from database)');
    
    // No longer using source preference - always use combined (detailed + unassigned)
    
    setLoans(loans => {
      const updatedLoans = loans.filter((_, idx) => idx !== loanIndex);
      dispatchLoansEvent(updatedLoans);
      
      // Update store with new loans array
      const mappedLoansForStore = updatedLoans.map(loan => ({
        ...loan,
        principal_outstanding: loan.amount,
        lender: loan.description
      }));
      setStoreLoans(mappedLoansForStore);
      
      // Trigger immediate recalculation
      const totalExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);
      const currentYear = new Date().getFullYear();
      const horizonYears = (parseInt(formData.lifespanYears) || 85) - (parseInt(formData.age) || 0);
      
      const quickEmiByYear = {};
      for (let i = 0; i < horizonYears; i++) {
        const year = currentYear + i;
        const annualEmi = updatedLoans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0) * 12, 0);
        quickEmiByYear[year] = annualEmi;
      }
      
      // Update main inputs with new values
      setMainInputs({
        expenses0: totalExpenses,
        quickEmiByYear: quickEmiByYear
      }, { origin: 'user' });
      
      return updatedLoans;
    });
    
    setSaveStatus('Loan removed from main page');
    setTimeout(() => setSaveStatus(''), 1000);
  }

  const formatCurrency = (amount) => {
    // Convert to number if it's not already
    const numAmount = typeof amount === 'number' ? amount : parseFloat(amount) || 0
    
    // Handle negative values
    const isNegative = numAmount < 0
    const absAmount = Math.abs(numAmount)
    
    let formatted
    if (absAmount >= 10000000) {
      formatted = `${(absAmount / 10000000).toFixed(1)}Cr`
    } else if (absAmount >= 100000) {
      formatted = `${(absAmount / 100000).toFixed(1)}L`
    } else if (absAmount >= 1000) {
      formatted = `${(absAmount / 1000).toFixed(1)}K`
    } else {
      formatted = `${absAmount.toFixed(0)}`
    }
    
    return `${isNegative ? '-' : ''}₹${formatted}`
  }

  // Calculate totals including both detailed data and Quick Calculator values
  const detailedAssetsTotal = assets.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0)
  const quickCalcAssetsTotal = parseFloat(formData.totalAssetGrossMarketValue) || 0
  const assetsTotal = detailedAssetsTotal > 0 ? detailedAssetsTotal : quickCalcAssetsTotal

  const detailedLiabilitiesTotal = loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0)
  const quickCalcLiabilitiesTotal = parseFloat(formData.totalLoanOutstandingValue) || 0
  const liabilitiesTotal = detailedLiabilitiesTotal > 0 ? detailedLiabilitiesTotal : quickCalcLiabilitiesTotal

  // Comprehensive progress calculation based on all modules
  // Check if growth assumptions are set (at least income growth and inflation rate)
  const hasGrowthAssumptions = (
    (formData.incomeGrowthRate !== undefined && formData.incomeGrowthRate !== null && formData.incomeGrowthRate !== '' && parseFloat(formData.incomeGrowthRate) > 0) &&
    (formData.inflationRate !== undefined && formData.inflationRate !== null && formData.inflationRate !== '' && parseFloat(formData.inflationRate) > 0)
  )

  // Helper to check if a value is actually filled (not empty string, null, undefined, or 0)
  const isFilled = (value) => {
    if (value === null || value === undefined || value === '') return false
    const num = parseFloat(value)
    return !isNaN(num) && num > 0
  }

  const profileSections = [
    { key: 'profile', label: 'Your Profile', icon: UserCircle, complete: isFilled(formData.age) && isFilled(formData.currentAnnualGrossIncome) && isFilled(formData.workTenureYears) },
    { key: 'assets', label: 'Assets', icon: PiggyBank, complete: assets.length > 0 || isFilled(formData.totalAssetGrossMarketValue) },
    { key: 'workAssets', label: 'Work Assets', icon: Briefcase, complete: isFilled(formData.currentAnnualGrossIncome) && isFilled(formData.workTenureYears) },
    { key: 'goals', label: 'Goals', icon: Target, complete: goals.length > 0 },
    { key: 'loans', label: 'Loans', icon: CreditCard, complete: loans.length > 0 },
    { key: 'expenses', label: 'Expenses', icon: ShoppingCart, complete: expenses.length > 0 },
    { key: 'insurance', label: 'Insurance', icon: Shield, complete: insurance.length > 0 },
    { key: 'growthAssumptions', label: 'Growth Assumptions', icon: TrendingUp, complete: hasGrowthAssumptions }
  ]

  const completedSections = profileSections.filter(section => section.complete).length
  const progressPercent = profileSections.length > 0
    ? Math.round((completedSections / profileSections.length) * 100)
    : 0

  // Debug logging (remove in production)
  if (process.env.NODE_ENV === 'development') {
    console.log('📊 Progress Calculation:', {
      completedSections,
      totalSections: profileSections.length,
      progressPercent,
      sections: profileSections.map(s => ({ key: s.key, complete: s.complete }))
    })
  }

  const dataSourceItems = [
    { label: 'Assets', color: 'bg-emerald-500', source: 'Combined (Assets Page + Unassigned)' },
    { label: 'Work Assets', color: 'bg-blue-500', source: 'Combined (Work Assets Page + Unassigned)' },
    { label: 'Goals', color: 'bg-purple-500', source: 'Goals Page' },
    { label: 'Loans', color: 'bg-red-500', source: 'Combined (Loans Page + Unassigned)' },
    { label: 'Expenses', color: 'bg-orange-500', source: 'Expenses Page' },
    { label: 'Assumptions', color: 'bg-slate-400', source: 'Growth Rate Assumptions' }
  ]

  // Build liabilities list - use detailed loans if available, otherwise use Quick Calculator value
  const liabilitiesList = loans.length > 0
    ? loans.map(loan => ({
        name: loan.description || loan.provider || loan.lender || 'Liability',
        amount: parseFloat(loan.amount) || 0
      }))
    : (quickCalcLiabilitiesTotal > 0 ? [{ name: 'Total Loans', amount: quickCalcLiabilitiesTotal }] : [])

  // Build assets list - use detailed assets if available, otherwise use Quick Calculator value
  const assetsList = assets.length > 0
    ? assets.map(asset => ({
        name: asset.name || 'Asset',
        amount: parseFloat(asset.current_value) || 0
      }))
    : (quickCalcAssetsTotal > 0 ? [{ name: 'Total Assets', amount: quickCalcAssetsTotal }] : [])

  const maxNetworthRows = Math.max(liabilitiesList.length, assetsList.length, 1)
  const networthRows = Array.from({ length: maxNetworthRows }).map((_, index) => ({
    liability: liabilitiesList[index],
    asset: assetsList[index]
  }))

  const currentAgeNum = parseInt(formData.age) || 0
  const workTillAge = currentAgeNum + (parseInt(formData.workTenureYears) || 0)
  const lifeToAge = parseInt(formData.lifespanYears) || 85
  const chartStartYear = parseInt(chartData?.[0]?.year) || new Date().getFullYear()
  const workStopYear = chartStartYear + (parseInt(formData.workTenureYears) || 0)
  const lastChartPoint = chartData?.[chartData.length - 1]
  const freedomPoint = (chartData || []).find((d) => parseInt(d.year) >= workStopYear && (d.netWorth || 0) > 0)
  const freedomReached = Boolean(freedomPoint && lastChartPoint && (lastChartPoint.netWorth || 0) > 0)
  const freedomAge = freedomReached
    ? currentAgeNum + (parseInt(freedomPoint.year) - chartStartYear)
    : null
  const yearsToFreedom = freedomAge && currentAgeNum ? Math.max(0, freedomAge - currentAgeNum) : null
  const salary = parseFloat(formData.currentAnnualGrossIncome) || 0
  const annualExpenses = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0)
  const annualEmi = loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0), 0) * 12
  const currentSurplus = salary - annualExpenses - annualEmi
  const surplusRatio = salary > 0 ? (currentSurplus / salary) * 100 : 0

  return (
    <div>
      {/* Saved status indicator */}
      {saveStatus && (
        <div style={{position: 'fixed', top: 16, right: 24, zIndex: 1000}} className="professional-badge professional-badge-success shadow-lg animate-pulse">
          {saveStatus}
        </div>
      )}
      {/* Error status indicator */}
      {saveError && (
        <div style={{position: 'fixed', top: 56, right: 24, zIndex: 1000}} className="bg-red-100 text-red-700 px-4 py-2 rounded shadow transition-opacity duration-500">
          {saveError}
        </div>
      )}

      <section className="lm-hero" id="top">
        <div className="lm-hero-glow" />
        <div className="lm-wrap">
          <div className="lm-eyebrow">Financial freedom</div>
          <h1>
            When could work become optional?
            <button
              type="button"
              className="lm-pmore"
              aria-expanded={heroOpen}
              aria-label="What this chart shows"
              onClick={() => setHeroOpen((v) => !v)}
            />
          </h1>
          <div className={`lm-pdesc ${heroOpen ? 'open' : ''}`}>
            <p className="sub">If you carry on earning, spending and investing roughly as you do now, this shows when salary could become optional. Your salary still continues in the projection until the working age you choose below.</p>
          </div>

          <div className="lm-ffgrid">
            <div className="lm-panel">
              <div className="lm-chead">
                <span className="lbl">Financial assets against the corpus you'd need</span>
                <span className="lm-legend">
                  <span className="lm-lg"><i style={{ background: 'var(--lm-teal)' }} />Projected net worth</span>
                  <span className="lm-lg"><i style={{ background: '#8fb8ea' }} />Expenses</span>
                </span>
              </div>
              {chartData && chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="networthFillHero" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#75cfc2" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#75cfc2" stopOpacity={0.04} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.09)" strokeDasharray="3 4" />
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#7d93b7' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#7d93b7' }} axisLine={false} tickLine={false} tickFormatter={(value) => formatCurrency(value)} />
                    <Tooltip
                      contentStyle={{ borderRadius: 11, border: '1px solid #e2e8f2' }}
                      formatter={(value) => formatCurrency(value)}
                      labelFormatter={(label) => `Year: ${label}`}
                    />
                    <Area type="monotone" dataKey="netWorth" stroke="#75cfc2" fill="url(#networthFillHero)" strokeWidth={2} />
                    <Area type="monotone" dataKey="expenses" stroke="#8fb8ea" fill="none" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ color: '#8fa6c9', padding: '48px 0', textAlign: 'center' }}>
                  Enter your details below to see the freedom chart.
                </div>
              )}
            </div>

            <div className="lm-panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="lm-ffbig">Estimated financial-freedom age</div>
              <div className={`lm-ffage ${freedomAge ? '' : 'none'}`}>
                {freedomAge ? `Age ${freedomAge}` : 'Not reached'}
              </div>
              <div className="lm-ffsub">
                {freedomAge
                  ? `${yearsToFreedom} year${yearsToFreedom === 1 ? '' : 's'} from now`
                  : 'Add income, assets and expenses to estimate when salary could become optional.'}
              </div>
              <div className="lm-ffrange">
                <div className="k">Planning range</div>
                <div className="v">Age {currentAgeNum || '—'} → {lifeToAge}</div>
              </div>
              <div className="lm-ffrows">
                <div className="lm-ffrow"><span>Net worth then</span><b>{formatCurrency(freedomPoint?.netWorth || 0)}</b></div>
                <div className="lm-ffrow"><span>Financial assets then</span><b>{formatCurrency(freedomPoint?.assets || freedomPoint?.portfolio || 0)}</b></div>
                <div className="lm-ffrow"><span>Salary included until</span><b>Age {workTillAge || '—'}</b></div>
                <div className="lm-ffrow"><span>Financial assets at age {lifeToAge}</span><b>{formatCurrency(lastChartPoint?.assets || lastChartPoint?.netWorth || 0)}</b></div>
              </div>
              <div className="lm-ffcav">This is an estimate, not a promise. Financial freedom means salary has become optional; the projection may still include salary until your selected working age.</div>
            </div>
          </div>
        </div>
      </section>

      {!effectiveIsAuthenticated && !isAdminMode && (
        <div className="lm-body" style={{ paddingBottom: 0 }}>
          <div className="lm-alert">
            <AlertTriangle className="h-4 w-4" />
            <span>
              You're in guest mode. You can use the calculator, but your data will not be
              saved unless you log in.
            </span>
          </div>
        </div>
      )}

      <div className="lm-body" style={{ paddingTop: 36 }}>
      <div id="inputs" className="lifemap-panel">
        <div className="lifemap-panel-header">
          <div className="lifemap-panel-title">
            <Calculator className="h-4 w-4 text-blue-600" />
            Enter your data
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            *Mandatory fields
            {!effectiveIsAuthenticated && !isAdminMode && (
              <button type="button" className="text-red-500" onClick={handleGuestReset}>
                Reset
              </button>
            )}
          </div>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="lifemap-soft-card p-4">
              <Label htmlFor="age" className="text-xs text-slate-500">Age*</Label>
              <Input
                id="age"
                type="number"
                value={formData.age}
                onChange={(e) => handleUserInputChange('age', e.target.value)}
                onBlur={(e) => saveOnBlur('age', e.target.value)}
              />
            </div>
            <div className="lifemap-soft-card p-4">
              <Label htmlFor="income" className="text-xs text-slate-500">Current annual gross income*</Label>
              <Input
                id="income"
                type="number"
                value={formData.currentAnnualGrossIncome}
                onChange={(e) => handleUserInputChange('currentAnnualGrossIncome', e.target.value)}
                onBlur={(e) => saveOnBlur('currentAnnualGrossIncome', e.target.value)}
              />
            </div>
            <div className="lifemap-soft-card p-4">
              <Label htmlFor="tenure" className="text-xs text-slate-500">Current work tenure*</Label>
              <Input
                id="tenure"
                type="number"
                value={formData.workTenureYears}
                onChange={(e) => handleUserInputChange('workTenureYears', e.target.value)}
                onBlur={(e) => saveOnBlur('workTenureYears', e.target.value)}
              />
            </div>
          </div>

          <div className="lifemap-soft-card p-4">
            <Label htmlFor="assets" className="text-xs text-slate-500">Total Asset Gross Market Value*</Label>
            <Input
              id="assets"
              type="number"
              value={formData.totalAssetGrossMarketValue}
              onChange={(e) => handleUserInputChange('totalAssetGrossMarketValue', e.target.value)}
              onBlur={(e) => saveOnBlur('totalAssetGrossMarketValue', e.target.value)}
            />
          </div>

          <div className="lifemap-soft-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-slate-500">Outstanding loans*</Label>
              <span className="text-xs text-slate-400">
                {formatCurrency(loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0))}
              </span>
            </div>
            {loans.map((loan, index) => (
              <div key={loan.id || loan._tempId || index} className="grid grid-cols-3 gap-2 items-center">
                <Input
                  placeholder="Loan name"
                  value={loan.description || ''}
                  onChange={e => handleLoanChange(loan.id || loan._tempId || index, 'description', e.target.value)}
                  onBlur={e => saveLoanOnBlur(loan.id || loan._tempId || index, 'description', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  value={loan.amount === "" ? "" : loan.amount}
                  onChange={e => {
                    const val = e.target.value;
                    handleLoanChange(loan.id || loan._tempId || index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                  onBlur={e => {
                    const val = e.target.value;
                    saveLoanOnBlur(loan.id || loan._tempId || index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                />
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="EMI"
                    value={loan.emi === "" ? "" : loan.emi}
                    onChange={e => {
                      const val = e.target.value;
                      handleLoanChange(loan.id || loan._tempId || index, 'emi', val === "" ? "" : parseFloat(val));
                    }}
                    onBlur={e => {
                      const val = e.target.value;
                      saveLoanOnBlur(loan.id || loan._tempId || index, 'emi', val === "" ? "" : parseFloat(val));
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLoan(index)}
                    className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            <Button onClick={addLoan} variant="outline" size="sm" className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Loan
            </Button>
          </div>

          <div className="lifemap-soft-card p-4 space-y-3">
            <Label className="text-xs text-slate-500">Specific Financial Goals*</Label>
            {goals.map((goal, index) => (
              <div key={goal.id || index} className="grid grid-cols-3 gap-2 items-center">
                <Input
                  placeholder="Goal"
                  value={goal.description || ''}
                  onChange={e => handleGoalChange(index, 'description', e.target.value)}
                  onBlur={e => saveGoalOnBlur(index, 'description', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  value={goal.amount === "" ? "" : goal.amount}
                  onChange={e => {
                    const val = e.target.value;
                    handleGoalChange(index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                  onBlur={e => {
                    const val = e.target.value;
                    saveGoalOnBlur(index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeGoal(index)}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button onClick={addGoal} variant="outline" size="sm" className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Goal
            </Button>
          </div>

          <div className="lifemap-soft-card p-4 space-y-3">
            <Label className="text-xs text-slate-500">All Inclusive Annual Expenses*</Label>
            {expenses.map((expense, index) => (
              <div key={expense.id || index} className="grid grid-cols-3 gap-2 items-center">
                <Input
                  placeholder="Expense"
                  value={expense.description || ''}
                  onChange={e => handleExpenseChange(index, 'description', e.target.value)}
                  onBlur={e => saveExpenseOnBlur(index, 'description', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Amount"
                  value={expense.amount === "" ? "" : expense.amount}
                  onChange={e => {
                    const val = e.target.value;
                    handleExpenseChange(index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                  onBlur={e => {
                    const val = e.target.value;
                    saveExpenseOnBlur(index, 'amount', val === "" ? "" : parseFloat(val));
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeExpense(index)}
                  className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button onClick={addExpense} variant="outline" size="sm" className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </Button>
          </div>
        </div>
      </div>

      {!effectiveIsAuthenticated && !isAdminMode && (
        <div className="lifemap-alert">
          <AlertTriangle className="h-4 w-4" />
          <div className="flex-1">
            Your data won’t be saved if you are not signed in. Ask your advisor to create
            an account, then sign in to use the calculator to its full potential.
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => {
              setAuthModalTab('login')
              setShowAuthModal(true)
            }}>Sign in</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        {profileSections.map(section => {
          const Icon = section.icon
          return (
            <div key={section.key} className="lifemap-soft-card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
                <Icon className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-sm font-medium text-slate-700">{section.label}*</div>
            </div>
          )
        })}
      </div>

      <div id="today" className="lifemap-panel">
        <div className="lifemap-panel-header">
          <div className="lifemap-panel-title">Where you stand today</div>
          <div className="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-full text-slate-600 dark:text-slate-300">
            Surplus: {formatCurrency(((parseFloat(formData.totalAssetGrossMarketValue) || 0) + ((parseFloat(formData.currentAnnualGrossIncome) || 0) * (parseInt(formData.workTenureYears) || 0))) - (calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals))}
          </div>
        </div>
        <div className="p-6">
          {assetsTotal === 0 && liabilitiesTotal === 0 && !isFilled(formData.age) && !isFilled(formData.currentAnnualGrossIncome) && !isFilled(formData.workTenureYears) ? (
            <div className="lifemap-soft-card p-10 flex flex-col items-center text-center gap-4 text-slate-600">
              <AlertTriangle className="h-12 w-12 text-red-500" />
              <div>
                <div className="text-lg font-semibold text-slate-700">Please set up your financial profile to view results</div>
              </div>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden bg-white dark:bg-slate-800">
              <div className="grid grid-cols-2 gap-6 p-6">
                {/* Assets Column */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Total Existing Assets</span>
                    <span className="text-lg font-bold text-green-600 dark:text-green-400">
                      + {formatCurrency(parseFloat(formData.totalAssetGrossMarketValue) || 0)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Total Human Capital</span>
                    <span className="text-lg font-bold text-green-600 dark:text-green-400">
                      + {formatCurrency((parseFloat(formData.currentAnnualGrossIncome) || 0) * (parseInt(formData.workTenureYears) || 0))}
                    </span>
                  </div>
                  
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Total</span>
                      <span className="text-lg font-bold text-green-600 dark:text-green-400">
                        + {formatCurrency((parseFloat(formData.totalAssetGrossMarketValue) || 0) + ((parseFloat(formData.currentAnnualGrossIncome) || 0) * (parseInt(formData.workTenureYears) || 0)))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Liabilities/Expenses Column */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Total Existing Liabilities</span>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">
                      - {formatCurrency(calculations.totalExistingLiabilities)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Total Future Expense</span>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">
                      - {formatCurrency(calculations.totalFutureExpenses)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Cumulative Financial Goal</span>
                    <span className="text-lg font-bold text-red-600 dark:text-red-400">
                      - {formatCurrency(calculations.totalFinancialGoals)}
                    </span>
                  </div>
                  
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Total</span>
                      <span className="text-lg font-bold text-red-600 dark:text-red-400">
                        - {formatCurrency(calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lifemap-panel">
        <div className="lifemap-panel-header">
          <div className="lifemap-panel-title">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Your Networth
          </div>
        </div>
        <div className="p-6 pb-0">
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400">
            <span className="float-right text-emerald-600 dark:text-emerald-400 font-semibold">
              {formatCurrency(assetsTotal - liabilitiesTotal)}
            </span>
          </div>
        </div>
        <div className="p-6">
          {chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="networthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => formatCurrency(value)} />
                <Tooltip formatter={(value) => formatCurrency(value)} labelFormatter={(label) => `Year: ${label}`} />
                <Area type="monotone" dataKey="netWorth" stroke="#3b82f6" fill="url(#networthFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="lifemap-soft-card p-10 flex flex-col items-center text-center gap-4 text-slate-600">
              <AlertTriangle className="h-12 w-12 text-red-500" />
              <div className="text-lg font-semibold text-slate-700">Please set up your financial profile to view results</div>
            </div>
          )}
        </div>
        <div className="px-6 pb-6">
          <div className="text-xs text-slate-500 mb-2">Data Sources</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
            {dataSourceItems.map(item => (
              <div key={item.label} className="flex items-center gap-2 text-slate-500">
                <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                <div>
                  <div className="font-medium text-slate-700">{item.label}</div>
                  <div className="text-[10px]">{item.source}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lifemap-panel">
        <div className="lifemap-panel-header">
          <div className="lifemap-panel-title">
            <Calculator className="h-4 w-4 text-blue-600" />
            Growth Rate Assumptions
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Asset Growth Rate</span>
              <span>{(parseFloat(formData.assetGrowthRate || 0.06) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Income Growth Rate</span>
              <span>{(parseFloat(formData.incomeGrowthRate || 0.06) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Expense Inflation Rate</span>
              <span>{(parseFloat(formData.inflationRate || 0.06) * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Work Tenure</span>
              <span>{formData.workTenureYears || 0} years</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Project Horizon</span>
              <span>{formData.lifespanYears - parseInt(formData.age || 0)} years</span>
            </div>
          </div>
        </div>
      </div>
      </div>

      <section className="lm-wall" id="register">
        <div className="lm-wrap">
          <div className="lm-wallcard">
            <div>
              <h2>{effectiveIsAuthenticated ? 'The next layer is unlocked' : 'The next layer is locked'}</h2>
              <p>
                {effectiveIsAuthenticated
                  ? 'Replace the rough totals above with asset-by-asset, goal-by-goal and expense-by-expense detail. Each page feeds this chart.'
                  : 'Your freedom age rests on a handful of rough numbers. A free account lets you replace each one with the real detail — and LifeMap starts answering questions instead of just adding up.'}
              </p>
              <ul className="lm-unlocks">
                <li><b>Asset-by-asset register</b><span>Tag each holding and set a return per asset class</span></li>
                <li><b>Goals linked to assets</b><span>See which goal is funded and what each one needs</span></li>
                <li><b>Protection gap</b><span>How much life cover you actually need</span></li>
                <li><b>Saved and shareable</b><span>Come back any time; pick up where you left off</span></li>
              </ul>
              <div className="lm-wallcta">
                {effectiveIsAuthenticated ? (
                  <>
                    <Link className="lm-btn" to="/assets">Open Assets</Link>
                    <Link className="lm-btn lm-btn-ghost" to="/goals">Open Goals</Link>
                  </>
                ) : (
                  <>
                    <button type="button" className="lm-btn" onClick={() => { setAuthModalTab('login'); setShowAuthModal(true) }}>Sign in</button>
                    <small>Accounts are created by an admin.</small>
                  </>
                )}
              </div>
            </div>
            <div className="lm-preview" aria-hidden="true">
              <div className="stack">
                <div className="lm-pv">
                  <div className="t">Goal funding</div>
                  <div className="b"><b>{progressPercent}%</b><span style={{ color: 'var(--lm-muted)', fontSize: 13 }}>of your profile is filled</span></div>
                  <div className="lm-bars">
                    <i style={{ height: '40%' }} />
                    <i style={{ height: '55%' }} />
                    <i style={{ height: '72%' }} />
                    <i style={{ height: '100%', background: 'var(--lm-teal)' }} />
                  </div>
                </div>
                <div className="lm-pv">
                  <div className="t">This year&apos;s surplus</div>
                  <div className="b">
                    <b>{formatCurrency(currentSurplus)}</b>
                    <span style={{ color: surplusRatio < 10 ? 'var(--lm-coral)' : 'var(--lm-green)', fontSize: 13 }}>{surplusRatio.toFixed(0)}% of salary</span>
                  </div>
                </div>
              </div>
              {!effectiveIsAuthenticated && (
                <div className="lm-lockover"><span className="lm-lockpill">LOCKED — FREE ACCOUNT REQUIRED</span></div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <div className="hidden">
        
        {/* Left Column - Input Form */}
        <div className="lg:col-span-1">
          <Card className="professional-card fade-in">
            <CardHeader className="professional-header">
              <CardTitle className="flex items-center space-x-2">
                <Calculator className="w-5 h-5" />
                <span>Financial Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              
              {/* Core Financial Inputs */}
              <div className="space-y-4">
                <div className="professional-section">
                  <div className="professional-section-content">
                    <Label htmlFor="age" className="text-sm font-medium text-gray-700 mb-2 block">Age</Label>
                    <Input
                      id="age"
                      type="number"
                      placeholder="Enter your age"
                      value={formData.age}
                      onChange={(e) => handleUserInputChange('age', e.target.value)}
                      onBlur={(e) => saveOnBlur('age', e.target.value)}
                      className="professional-input"
                    />
                  </div>
                </div>

                <div className="professional-section">
                  <div className="professional-section-content">
                    <Label htmlFor="income" className="text-sm font-medium text-gray-700 mb-2 block">
                      Current Annual Gross Income & Work Tenure
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        id="income"
                        type="number"
                        placeholder="Rs. XX,XXX"
                        value={formData.currentAnnualGrossIncome}
                        onChange={(e) => handleUserInputChange('currentAnnualGrossIncome', e.target.value)}
                        onBlur={(e) => saveOnBlur('currentAnnualGrossIncome', e.target.value)}
                        className="professional-input"
                      />
                      <Input
                        type="number"
                        placeholder="XX years"
                        value={formData.workTenureYears}
                        onChange={(e) => handleUserInputChange('workTenureYears', e.target.value)}
                        onBlur={(e) => saveOnBlur('workTenureYears', e.target.value)}
                        className="professional-input"
                      />
                    </div>
                  </div>
                </div>

                <div className="border border-teal-300 rounded-lg p-3 bg-teal-50/30">
                  <Label htmlFor="assets" className="text-sm font-medium text-gray-700">
                    Total Asset Gross Market Value
                  </Label>
                  <Input
                    id="assets"
                    type="number"
                    placeholder="Enter your Gross Market Value"
                    value={formData.totalAssetGrossMarketValue}
                    onChange={(e) => handleUserInputChange('totalAssetGrossMarketValue', e.target.value)}
                    onBlur={(e) => saveOnBlur('totalAssetGrossMarketValue', e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Calculated from Assets module: {/* This would be calculated from assets */} assets
                  </p>
                </div>

                {/* Outstanding Loans Section */}
                <div className="border border-teal-300 rounded-lg p-3 bg-teal-50/30">
                  <Label className="text-sm font-medium text-gray-700">Outstanding Loans</Label>
                  <Input
                    type="number"
                    value={loans.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0)}
                    readOnly
                    className="mt-1 bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Calculated from Loans module: {loans.length} loans
                  </p>
                  
                  {/* Loan entries */}
                  <div className="space-y-2 mt-3">
                    {loans.map((loan, index) => (
                      <div key={loan.id || loan._tempId || index} className="grid grid-cols-3 gap-2 items-center">
                        <Input
                          placeholder="Description"
                          value={loan.description || ''}
                          onChange={e => handleLoanChange(loan.id || loan._tempId || index, 'description', e.target.value)}
                          onBlur={e => saveLoanOnBlur(loan.id || loan._tempId || index, 'description', e.target.value)}
                          className="text-sm"
                        />
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={loan.amount === "" ? "" : loan.amount}
                          onChange={e => {
                            const val = e.target.value;
                            handleLoanChange(loan.id || loan._tempId || index, 'amount', val === "" ? "" : parseFloat(val));
                          }}
                          onBlur={e => {
                            const val = e.target.value;
                            saveLoanOnBlur(loan.id || loan._tempId || index, 'amount', val === "" ? "" : parseFloat(val));
                          }}
                          className="text-sm"
                        />
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            placeholder="EMI"
                            value={loan.emi === "" ? "" : loan.emi}
                            onChange={e => {
                              const val = e.target.value;
                              handleLoanChange(loan.id || loan._tempId || index, 'emi', val === "" ? "" : parseFloat(val));
                            }}
                            onBlur={e => {
                              const val = e.target.value;
                              saveLoanOnBlur(loan.id || loan._tempId || index, 'emi', val === "" ? "" : parseFloat(val));
                            }}
                            className="text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLoan(index)}
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Button
                    onClick={addLoan}
                    className="professional-button professional-button-success w-full mt-3"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Loan
                  </Button>
                </div>

                {/* Financial Goals Section */}
                <div className="border border-teal-300 rounded-lg p-3 bg-teal-50/30">
                  <Label className="text-sm font-medium text-gray-700">Specific Financial Goals</Label>
                  <Input
                    type="number"
                    value={goals.reduce((sum, goal) => sum + (parseFloat(goal.amount) || 0), 0)}
                    readOnly
                    className="mt-1 bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Total from Goals module: {goals.length} goals
                  </p>
                  
                  {/* Goal entries */}
                  <div className="space-y-2 mt-3">
                    {goals.map((goal, index) => (
                      <div key={goal.id || index} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Goal {index + 1}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeGoal(index)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <Input
                          placeholder="Goal description"
                          value={goal.description || ''}
                          onChange={e => handleGoalChange(index, 'description', e.target.value)}
                          onBlur={e => saveGoalOnBlur(index, 'description', e.target.value)}
                          className="text-sm"
                        />
                        <Input
                          type="number"
                          placeholder="Amount"
                          value={goal.amount === "" ? "" : goal.amount}
                          onChange={e => {
                            const val = e.target.value;
                            handleGoalChange(index, 'amount', val === "" ? "" : parseFloat(val));
                          }}
                          onBlur={e => {
                            const val = e.target.value;
                            saveGoalOnBlur(index, 'amount', val === "" ? "" : parseFloat(val));
                          }}
                          className="text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  
                  <Button
                    onClick={addGoal}
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 border-teal-300 text-teal-700 hover:bg-teal-50"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Goal
                  </Button>
                </div>

                {/* Expenses Section */}
                <div className="border border-teal-300 rounded-lg p-3 bg-teal-50/30">
                  <Label className="text-sm font-medium text-gray-700">All Inclusive Annual Expenses</Label>
                  <Input
                    type="number"
                    value={expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0)}
                    readOnly
                    className="mt-1 bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Calculated from Expenses module: {expenses.length} expenses
                  </p>
                  
                  {/* Expense entries */}
                  <div className="space-y-2 mt-3">
                    {expenses.map((expense, index) => (
                      <div key={expense.id || index} className="grid grid-cols-2 gap-2 items-center">
                        <Input
                          placeholder="Expense description"
                          value={expense.description || ''}
                          onChange={e => handleExpenseChange(index, 'description', e.target.value)}
                          onBlur={e => saveExpenseOnBlur(index, 'description', e.target.value)}
                          className="text-sm"
                        />
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            placeholder="Amount"
                            value={expense.amount === "" ? "" : expense.amount}
                            onChange={e => {
                              const val = e.target.value;
                              handleExpenseChange(index, 'amount', val === "" ? "" : parseFloat(val));
                            }}
                            onBlur={e => {
                              const val = e.target.value;
                              saveExpenseOnBlur(index, 'amount', val === "" ? "" : parseFloat(val));
                            }}
                            className="text-sm"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeExpense(index)}
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <Button
                    onClick={addExpense}
                    variant="outline"
                    size="sm"
                    className="w-full mt-3 border-teal-300 text-teal-700 hover:bg-teal-50"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Expense
                  </Button>
                </div>
                
                {/* Growth Rate Assumptions */}
                <div className="border border-blue-300 rounded-lg p-3 bg-blue-50/30 mt-4">
                  <Label className="text-sm font-medium text-gray-700 mb-3 block">Growth Rate Assumptions</Label>
                  
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="incomeGrowthRate" className="text-xs text-gray-600">Income Growth Rate (%)</Label>
                      <Input
                        id="incomeGrowthRate"
                        type="number"
                        step="0.01"
                        placeholder="6.0"
                        value={formData.incomeGrowthRate !== undefined && formData.incomeGrowthRate !== null 
                          ? parseFloat((parseFloat(formData.incomeGrowthRate) * 100).toFixed(2)) 
                          : ''}
                        onChange={(e) => {
                          const inputVal = e.target.value;
                          if (inputVal === '' || inputVal === '-') {
                            handleUserInputChange('incomeGrowthRate', '');
                            return;
                          }
                          const val = parseFloat(inputVal);
                          if (!isNaN(val)) {
                            handleUserInputChange('incomeGrowthRate', val / 100);
                          }
                        }}
                        className="mt-1 text-sm"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="inflationRate" className="text-xs text-gray-600">Inflation Rate (%)</Label>
                      <Input
                        id="inflationRate"
                        type="number"
                        step="0.01"
                        placeholder="6.0"
                        value={formData.inflationRate !== undefined && formData.inflationRate !== null 
                          ? parseFloat((parseFloat(formData.inflationRate) * 100).toFixed(2)) 
                          : ''}
                        onChange={(e) => {
                          const inputVal = e.target.value;
                          if (inputVal === '' || inputVal === '-') {
                            handleUserInputChange('inflationRate', '');
                            return;
                          }
                          const val = parseFloat(inputVal);
                          if (!isNaN(val)) {
                            handleUserInputChange('inflationRate', val / 100);
                          }
                        }}
                        className="mt-1 text-sm"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="assetEquitySplit" className="text-xs text-gray-600">Asset Equity Split (%)</Label>
                      <Input
                        id="assetEquitySplit"
                        type="number"
                        step="0.01"
                        placeholder="60.0"
                        value={formData.assetEquitySplit !== undefined && formData.assetEquitySplit !== null 
                          ? parseFloat((parseFloat(formData.assetEquitySplit) * 100).toFixed(2)) 
                          : ''}
                        onChange={(e) => {
                          const inputVal = e.target.value;
                          if (inputVal === '' || inputVal === '-') {
                            handleUserInputChange('assetEquitySplit', '');
                            return;
                          }
                          const val = parseFloat(inputVal);
                          if (!isNaN(val)) {
                            handleUserInputChange('assetEquitySplit', val / 100);
                          }
                        }}
                        className="mt-1 text-sm"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="assetEquityGrowthRate" className="text-xs text-gray-600">Equity Growth (%)</Label>
                        <Input
                          id="assetEquityGrowthRate"
                          type="number"
                          step="0.01"
                          placeholder="15.0"
                          value={formData.assetEquityGrowthRate !== undefined && formData.assetEquityGrowthRate !== null 
                            ? parseFloat((parseFloat(formData.assetEquityGrowthRate) * 100).toFixed(2)) 
                            : ''}
                          onChange={(e) => {
                            const inputVal = e.target.value;
                            if (inputVal === '' || inputVal === '-') {
                              handleUserInputChange('assetEquityGrowthRate', '');
                              return;
                            }
                            const val = parseFloat(inputVal);
                            if (!isNaN(val)) {
                              handleUserInputChange('assetEquityGrowthRate', val / 100);
                            }
                          }}
                          className="mt-1 text-sm"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="assetDebtGrowthRate" className="text-xs text-gray-600">Debt Growth (%)</Label>
                        <Input
                          id="assetDebtGrowthRate"
                          type="number"
                          step="0.01"
                          placeholder="7.0"
                          value={formData.assetDebtGrowthRate !== undefined && formData.assetDebtGrowthRate !== null 
                            ? parseFloat((parseFloat(formData.assetDebtGrowthRate) * 100).toFixed(2)) 
                            : ''}
                          onChange={(e) => {
                            const inputVal = e.target.value;
                            if (inputVal === '' || inputVal === '-') {
                              handleUserInputChange('assetDebtGrowthRate', '');
                              return;
                            }
                            const val = parseFloat(inputVal);
                            if (!isNaN(val)) {
                              handleUserInputChange('assetDebtGrowthRate', val / 100);
                            }
                          }}
                          className="mt-1 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Life Sheet Display */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Life Sheet Summary - now full width */}
          <Card className="shadow-lg border-0 bg-white/80 backdrop-blur w-full">
            <CardHeader className="bg-gradient-to-r from-teal-500 to-green-500 text-white rounded-t-lg">
              <CardTitle className="flex items-center justify-between">
                <span>Life Sheet</span>
                <Badge variant="secondary" className="bg-white/20 text-white border-white/30">
                  Surplus: {formatCurrency(assetsTotal - liabilitiesTotal)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 gap-6">
                
                {/* Assets Column */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Total Existing Assets</span>
                    <span className="text-lg font-bold text-green-600">
                      + {formatCurrency(calculations.totalExistingAssets)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Total Human Capital</span>
                    <span className="text-lg font-bold text-green-600">
                      + {formatCurrency(calculations.totalHumanCapital)}
                    </span>
                  </div>
                  
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-gray-800">Total</span>
                      <span className="text-xl font-bold text-green-600">
                        + {formatCurrency(calculations.totalExistingAssets + calculations.totalHumanCapital)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Liabilities Column */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Total Existing Liabilities</span>
                    <span className="text-lg font-bold text-red-600">
                      - {formatCurrency(calculations.totalExistingLiabilities)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Total Future Expense</span>
                    <span className="text-lg font-bold text-red-600">
                      - {formatCurrency(calculations.totalFutureExpenses)}
                    </span>
                  </div>
                  
                  {/* Replace individual Financial Goals with Cumulative Financial Goal */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-600">Cumulative Financial Goal</span>
                    <span className="text-lg font-bold text-red-600">
                      - {formatCurrency(calculations.totalFinancialGoals)}
                    </span>
                  </div>
                  
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-gray-800">Total</span>
                      <span className="text-xl font-bold text-red-600">
                        - {formatCurrency(calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Net Total Row */}
              <div className="border-t-2 pt-4 mt-4">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-bold text-gray-900">Net Total</span>
                  <span className={`text-2xl font-bold ${(calculations.totalExistingAssets + calculations.totalHumanCapital) - (calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency((calculations.totalExistingAssets + calculations.totalHumanCapital) - (calculations.totalExistingLiabilities + calculations.totalFutureExpenses + calculations.totalFinancialGoals))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Chart Section - now below Life Sheet */}
          <Card className="mt-0 shadow-lg border-0 bg-white/80 backdrop-blur w-full">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5 text-teal-600" />
                <span>Graph Heading</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {console.log('🔄 Chart: chartData length:', chartData.length, 'chartData:', chartData) || chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
             <LineChart data={chartData}>
               <CartesianGrid strokeDasharray="3 3" />
               <XAxis 
                 dataKey="year" 
                 label={{ value: 'Life Tenure', position: 'insideBottom', offset: -5 }}
               />
               <YAxis 
                 label={{ value: 'Net Worth', angle: -90, position: 'insideLeft' }}
                 tickFormatter={(value) => formatCurrency(value)}
                 domain={['dataMin', 'dataMax']}
               />
               <Tooltip 
                 formatter={(value, name) => [formatCurrency(value), name]}
                 labelFormatter={(label) => `Year: ${label}`}
               />
               <Line dataKey="netWorth" name="Net Worth" stroke="#10B981" strokeWidth={3} dot={false} />
             </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Calculator className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>Enter your financial information to see projections</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Source Indicators */}
          <Card className="mt-4 shadow-lg border-0 bg-white/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Target className="w-5 h-5 text-purple-600" />
                <span>Chart Data Sources</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <p className="text-sm font-medium">Assets</p>
                    <p className="text-xs text-gray-600">
                      Combined (Assets Page + Unassigned)
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <p className="text-sm font-medium">Work Assets</p>
                    <p className="text-xs text-gray-600">
                      Combined (Work Assets Page + Unassigned)
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <p className="text-sm font-medium">Liabilities</p>
                    <p className="text-xs text-gray-600">
                      Combined (Loans Page + Unassigned)
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <div>
                    <p className="text-sm font-medium">Expenses</p>
                    <p className="text-xs text-gray-600">
                      Detailed (Expenses Page)
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-600">
                  <strong>Legend:</strong> 
                  <span className="inline-flex items-center ml-2">
                    <div className="w-3 h-3 rounded-full bg-green-500 mr-1"></div>
                    Detailed (from respective pages)
                  </span>
                  <span className="inline-flex items-center ml-4">
                    <div className="w-3 h-3 rounded-full bg-blue-500 mr-1"></div>
                    Quick Calculator (from main page)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Growth Rate Assumptions */}
          <Card className="mt-4 shadow-lg border-0 bg-white/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Calculator className="w-5 h-5 text-blue-600" />
                <span>Growth Rate Assumptions</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Growth Rate Assumptions */}
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3">Growth Rate Assumptions</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Asset Growth Rate:</span>
                      <span className="font-medium">{(parseFloat(formData.assetGrowthRate) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Income Growth Rate:</span>
                      <span className="font-medium">{(parseFloat(formData.incomeGrowthRate) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Expense Inflation Rate:</span>
                      <span className="font-medium">{(parseFloat(formData.inflationRate || 0.06) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Work Tenure:</span>
                      <span className="font-medium">{formData.workTenureYears} years</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Projection Horizon:</span>
                      <span className="font-medium">{formData.lifespanYears - parseInt(formData.age)} years</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Current Inputs Summary */}
              <div className="border-t pt-4">
                <h4 className="font-semibold text-gray-800 mb-3">Current Inputs</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Initial Assets:</span>
                    <p className="font-medium">{formatCurrency(formData.totalAssetGrossMarketValue)}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Annual Income:</span>
                    <p className="font-medium">{formatCurrency(formData.currentAnnualGrossIncome)}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Annual Expenses:</span>
                    <p className="font-medium">{formatCurrency(calculations.totalFutureExpenses / (formData.lifespanYears - parseInt(formData.age)))}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Annual EMIs:</span>
                    <p className="font-medium">{formatCurrency(loans.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0), 0) * 12)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          defaultTab={authModalTab}
        />
      )}

    </div>
  )
}

