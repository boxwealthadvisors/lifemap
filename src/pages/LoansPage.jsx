import React, { useEffect, useState } from 'react'
import EditableGrid from '@/components/EditableGrid.jsx'
import { useAuth } from '../contexts/AuthContext'
import { useAdminUser } from '../contexts/AdminUserContext'
import { useLifeSheetStore } from '../store/enhanced-store'
import ApiService from '../services/api'
import LoansChart from '@/components/LoansChart.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/PageHeader.jsx'
import PagePager from '@/components/PagePager.jsx'
import { horizonYears } from '../lib/planLinks'

const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '₹0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num >= 10000000) {
    return `₹${(num / 10000000).toFixed(2)}Cr`;
  } else if (num >= 100000) {
    return `₹${(num / 100000).toFixed(2)}L`;
  } else {
    return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
};

export default function LoansPage() {
  const { user, isAuthenticated } = useAuth();
  const adminUser = useAdminUser();
  const { setDetailEmi, setSourcePreference } = useLifeSheetStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingRows, setSavingRows] = useState(new Set());
  const [fpCalculatorLoans, setFpCalculatorLoans] = useState(0);
  
  // Determine if we're in admin mode and get the correct userId
  const isAdminMode = !!adminUser?.userId;
  const userId = isAdminMode ? adminUser.userId : (user?.id || null);
  const effectiveIsAuthenticated = isAdminMode || isAuthenticated;

  // Load FP calculator loans (totalLoanOutstandingValue)
  useEffect(() => {
    const loadFpCalculatorLoans = async () => {
      if (effectiveIsAuthenticated && userId) {
        try {
          const response = isAdminMode
            ? await ApiService.getFinancialProfileForUser(userId)
            : await ApiService.getFinancialProfile(userId);
          if (response && response.profile) {
            const fpValue = parseFloat(response.profile.total_loan_outstanding_value) || 0;
            setFpCalculatorLoans(fpValue);
          }
        } catch (error) {
          console.error('❌ Error loading financial profile:', error);
        }
      }
    };
    loadFpCalculatorLoans();
  }, [effectiveIsAuthenticated, userId, isAdminMode]);

  // Event dispatching for live chart updates (following WorkAssetsPage pattern)
  const dispatchLoansEvent = (updatedLoans) => {
    try {
      const payload = Array.isArray(updatedLoans) ? updatedLoans.map(l => ({ ...l })) : [];
      window.dispatchEvent(new CustomEvent('loansUpdated', { detail: { loans: payload } }));
    } catch (e) {
      console.warn('Failed to dispatch loansUpdated event:', e);
    }
  };

  // Calculate EMI time series and update store
  // Now includes unassigned loans (from FP calculator)
  const updateStoreWithEmiTimeSeries = (loansData) => {
    console.log('🔄 Loans: updateStoreWithEmiTimeSeries called with loans:', loansData.length);
    try {
      const currentYear = new Date().getFullYear();
      const emiSeries = {};
      const assumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const years = horizonYears(assumptions.age, assumptions.lifespanYears);
      
      // Calculate current detailed loans total outstanding
      const detailedLoansTotal = loansData.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
      
      // Calculate unassigned loans = FP calculator value - detailed loans total
      const unassignedLoansValue = Math.max(0, fpCalculatorLoans - detailedLoansTotal);
      
      // For unassigned loans, estimate annual EMI based on typical loan terms
      // Use average interest rate and remaining tenure from FP calculator or defaults
      const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const defaultLoanRate = 0.10; // 10% default
      const defaultLoanTenure = 10; // 10 years default
      let unassignedAnnualEmi = 0;
      if (unassignedLoansValue > 0) {
        // Calculate EMI using standard formula: EMI = P * r * (1+r)^n / ((1+r)^n - 1)
        const monthlyRate = defaultLoanRate / 12;
        const numMonths = defaultLoanTenure * 12;
        const emi = unassignedLoansValue * monthlyRate * Math.pow(1 + monthlyRate, numMonths) / (Math.pow(1 + monthlyRate, numMonths) - 1);
        unassignedAnnualEmi = emi * 12;
      }
      
      // For each year, calculate total EMI payments
      for (let yearOffset = 0; yearOffset <= years; yearOffset++) {
        const year = currentYear + yearOffset;
        let totalEmi = 0;
        
        // 1. Add detailed loans EMI
        loansData.forEach(loan => {
          const principal = parseFloat(loan.amount) || 0;
          const emi = parseFloat(loan.emi) || 0;
          const loanExpiry = parseInt(loan.loanExpiry) || 0;
          
          // Only include EMI if the loan is still active (before expiry year)
          if (loanExpiry > 0 && year <= loanExpiry && emi > 0) {
            totalEmi += emi * 12; // Convert monthly EMI to annual
          }
        });
        
        // 2. Add unassigned loans EMI (only for remaining loan tenure)
        if (unassignedAnnualEmi > 0 && yearOffset < defaultLoanTenure) {
          totalEmi += unassignedAnnualEmi;
        }
        
        emiSeries[year] = totalEmi;
      }
      
      console.log('🔄 Loans: Calculated EMI series (includes unassigned):', 
        Object.keys(emiSeries).slice(0, 5).map(y => [y, emiSeries[y]]));
      console.log('🔄 Loans: Unassigned loans value:', unassignedLoansValue, 'Annual EMI:', unassignedAnnualEmi);
      
      // Update store with combined EMI data (no source preference needed)
      setDetailEmi(emiSeries);
      console.log('🔄 Loans: setDetailEmi called successfully');
      
    } catch (error) {
      console.error('❌ Error updating store with EMI time series:', error);
    }
  };

  // Load loans from database
  useEffect(() => {
    if (userId) {
      loadLoans();
    }
  }, [userId]);

  const loadLoans = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = isAdminMode 
        ? await ApiService.getFinancialLoansForUser(userId)
        : await ApiService.getFinancialLoans(userId);
      console.log('💰 Loans response:', response);
      
      // Handle the response format - backend returns { loans: [...] }
      const loans = response.loans || response || [];
      console.log('💰 Loans array:', loans);
      console.log('💰 First loan loanExpiry:', loans[0]?.loanExpiry);
      console.log('💰 First loan end_date from DB:', loans[0]?.end_date);
      const mappedLoans = loans.map(loan => ({
        ...loan,
        loanName: loan.loanName || loan.type || loan.name || ''
      }));
      setRows(mappedLoans);
      
      // Dispatch event for live chart updates (following WorkAssetsPage pattern)
      dispatchLoansEvent(loans);
      
      // Update store with detailed EMI time series
      updateStoreWithEmiTimeSeries(loans);
    } catch (error) {
      console.error('Error loading loans:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    const newRow = { 
      id: `temp_${Date.now()}`, 
      loanName: '',
      provider: '', 
      amount: 0, 
      interestRate: 0, 
      emi: 0, 
      frequency: 'Monthly',
      loanExpiry: new Date().getFullYear() + 35 // Default to 35 years from now
    };
    setRows([...rows, newRow]);
  };

  const delRow = async (idx) => {
    const row = rows[idx];
    if (row.id && !row.id.toString().startsWith('temp_')) {
      try {
        if (isAdminMode) {
          await ApiService.deleteFinancialLoanForUser(row.id, userId);
        } else {
          await ApiService.deleteFinancialLoan(row.id);
        }
      } catch (error) {
        console.error('Error deleting loan:', error);
      }
    }
    const updatedRows = rows.filter((_, i) => i !== idx);
    setRows(updatedRows);
    
    // Dispatch event for live chart updates (following WorkAssetsPage pattern)
    dispatchLoansEvent(updatedRows);
  };

  const handleCellChange = (rowIndex, field, value) => {
    try {
      const updatedRows = [...rows];
      updatedRows[rowIndex] = { ...updatedRows[rowIndex], [field]: value };
      setRows(updatedRows);

      // Dispatch event for live chart updates (following WorkAssetsPage pattern)
      dispatchLoansEvent(updatedRows);
      
      // Update store with detailed EMI time series
      updateStoreWithEmiTimeSeries(updatedRows);

      const row = updatedRows[rowIndex];
      
      // Clear any existing timeout for this row
      const timeoutKey = `row_${rowIndex}`;
      clearTimeout(window[timeoutKey]);
      
      // Set a new timeout for auto-save (debounce)
      window[timeoutKey] = setTimeout(() => {
        // Check if row is already being saved
        if (savingRows.has(rowIndex)) {
          return;
        }
        
        // Auto-save to database
        if (row.id && !row.id.toString().startsWith('temp_')) {
          // Update existing row - only if we have both provider and amount
          if (row.provider && row.amount) {
            setSavingRows(prev => new Set(prev).add(rowIndex));
            const endDate = row.loanExpiry ? `${parseInt(row.loanExpiry)}-12-31` : null;
            console.log('💾 Saving loan with expiry:', { loanExpiry: row.loanExpiry, endDate });
            
            const updatePromise = isAdminMode
              ? ApiService.updateFinancialLoanForUser(row.id, {
                  lender: row.provider,
                  type: row.loanName || 'Personal',
                  principal_outstanding: parseFloat(row.amount) || 0,
                  rate: parseFloat(row.interestRate) || 0,
                  emi: parseFloat(row.emi) || 0,
                  end_date: endDate
                }, userId)
              : ApiService.updateFinancialLoan(row.id, {
                  lender: row.provider,
                  type: row.loanName || 'Personal',
                  principal_outstanding: parseFloat(row.amount) || 0,
                  rate: parseFloat(row.interestRate) || 0,
                  emi: parseFloat(row.emi) || 0,
                  end_date: endDate
                });
            
            updatePromise.finally(() => {
              setSavingRows(prev => {
                const newSet = new Set(prev);
                newSet.delete(rowIndex);
                return newSet;
              });
            }).catch(error => console.error('Error updating loan:', error));
          }
        } else if (row.provider && row.amount && row.emi && row.id && row.id.toString().startsWith('temp_')) {
          // Create new row - only for temp rows with both provider and amount
          setSavingRows(prev => new Set(prev).add(rowIndex));
          const endDate = row.loanExpiry ? `${parseInt(row.loanExpiry)}-12-31` : null;
          console.log('💾 Creating loan with expiry:', { loanExpiry: row.loanExpiry, endDate });
          
          const loanPayload = {
            lender: row.provider,
            type: row.loanName || 'Personal',
            principal_outstanding: parseFloat(row.amount) || 0,
            rate: parseFloat(row.interestRate) || 0,
            emi: parseFloat(row.emi) || 0,
            start_date: new Date().toISOString().split('T')[0],
            end_date: endDate
          };
          
          console.log('💾 Creating loan with payload:', loanPayload);
          console.log('💾 Row data:', { 
            provider: row.provider, 
            amount: row.amount, 
            interestRate: row.interestRate, 
            emi: row.emi 
          });
          
          const createPromise = isAdminMode
            ? ApiService.createFinancialLoanForUser(loanPayload, userId)
            : ApiService.createFinancialLoan(loanPayload);
          
          createPromise.then(response => {
            const newLoan = response.loan || response;
            // Update the row with the new ID
            const updatedRowsWithId = [...rows];
            updatedRowsWithId[rowIndex] = { ...row, id: newLoan.id };
            setRows(updatedRowsWithId);
          }).finally(() => {
            setSavingRows(prev => {
              const newSet = new Set(prev);
              newSet.delete(rowIndex);
              return newSet;
            });
          }).catch(error => console.error('Error creating loan:', error));
        }
      }, 1000); // 1 second debounce
    } catch (error) {
      console.error('Error in handleCellChange:', error);
    }
  };

  const handleReset = () => {
    loadLoans();
  };

  const handleExportCsv = () => {
    const headers = ['Provider', 'Loan Name', 'Amount', 'Interest Rate %', 'EMI', 'Frequency', 'Loan Expiry'];
    const csvRows = rows.map(row => ([
      row.provider || '',
      row.loanName || '',
      row.amount ?? '',
      row.interestRate ?? '',
      row.emi ?? '',
      row.frequency || '',
      row.loanExpiry ?? ''
    ]));
    const content = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `loans-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear all timeouts
      for (let i = 0; i < 100; i++) {
        clearTimeout(window[`row_${i}`]);
      }
    };
  }, []);

  // Calculate summary statistics
  const totalPrincipal = rows.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0)
  const totalEMI = rows.reduce((sum, loan) => sum + (parseFloat(loan.emi) || 0), 0)
  const totalOutstanding = totalPrincipal
  const totalMonthlyEmi = totalEMI
  const totalAnnualEmi = totalEMI * 12
  const unassignedLoans = Math.max(0, fpCalculatorLoans - totalPrincipal)
  // Calculate weighted average interest rate based on loan amounts
  const averageRate = (() => {
    if (rows.length === 0) return 0;
    
    const totalWeightedRate = rows.reduce((sum, loan) => {
      const amount = parseFloat(loan.amount) || 0;
      const rate = parseFloat(loan.interestRate) || 0;
      return sum + (amount * rate);
    }, 0);
    
    const totalAmount = rows.reduce((sum, loan) => sum + (parseFloat(loan.amount) || 0), 0);
    
    return totalAmount > 0 ? totalWeightedRate / totalAmount : 0;
  })()

  const columns = [
    { field: 'provider', headerName: 'Provider' },
    { field: 'loanName', headerName: 'Loan Name' },
    { field: 'amount', headerName: 'Amount', type: 'number' },
    { field: 'interestRate', headerName: 'Interest Rate %', type: 'number' },
    { field: 'emi', headerName: 'EMI', type: 'number' },
    { 
      field: 'frequency', 
      headerName: 'Frequency',
      type: 'select',
      options: ['Monthly', 'Quarterly', 'Semi-Annually', 'Annually']
    },
    { field: 'loanExpiry', headerName: 'Loan Expiry', type: 'number' }
  ];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="lm-body">
      <PageHeader
        title="What you owe"
        description="Every loan, with its real repayment schedule. Enter the balance, the rate and the instalment — LifeMap works out when each one actually clears and what it will have cost you by then."
      />
        {rows.length === 0 && (
          <div className="lm-alert">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Start adding your first loan in the loan register below to get an output on the
              chart. You may add as many loans as you want.
            </span>
          </div>
        )}

      <div id="sec-schedule" className="lm-card" style={{ padding: '18px 20px 14px', marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>Path to debt-free</h3>
        <LoansChart loans={rows} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm font-semibold text-slate-700">
          Manage your loan portfolio and EMI schedules
        </div>
        <div className="flex gap-2">
          <span className="px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-xs">
            Total Outstanding: ₹{totalPrincipal.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div id="sec-mix" className="lifemap-stat-grid">
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Detailed Loans</p>
          <div className="lifemap-stat-value text-emerald-600">
            {formatCurrency(totalPrincipal)}
          </div>
          <p className="text-xs text-slate-500">{rows.length} loans</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Unassigned Loans</p>
          <div className="lifemap-stat-value text-orange-600">
            {formatCurrency(unassignedLoans)}
          </div>
          <p className="text-xs text-slate-500">From FP Calculator</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Total Outstanding</p>
          <div className="lifemap-stat-value text-red-600">
            {formatCurrency(Math.max(fpCalculatorLoans, totalPrincipal))}
          </div>
          <p className="text-xs text-slate-500">{rows.length} detailed + unassigned</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Monthly EMI</p>
          <div className="lifemap-stat-value text-orange-600">
            {formatCurrency(totalMonthlyEmi)}
          </div>
          <p className="text-xs text-slate-500">Total monthly outflow</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Average Rate</p>
          <div className="lifemap-stat-value text-blue-600">
            {averageRate.toFixed(2)}%
          </div>
          <p className="text-xs text-slate-500">Weighted Average</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Annual Outflow</p>
          <div className="lifemap-stat-value text-purple-600">
            {formatCurrency(totalAnnualEmi)}
          </div>
          <p className="text-xs text-slate-500">EMI x 12 months</p>
        </div>
      </div>

      {/* Loan Register */}
      {columns && Array.isArray(columns) && rows && Array.isArray(rows) ? (
        <div id="sec-register" className="lm-card">
          <div className="lm-reghead">
            <h3>Current loans</h3>
            <span className="count">{rows.length} loans</span>
            <div className="r">
            <Button size="sm" className="lm-ghost primary" onClick={addRow}>+ Add loan</Button>
            <Button size="sm" variant="outline" className="lm-ghost" onClick={handleExportCsv}>Export CSV</Button>
              <Button size="sm" variant="ghost" className="lm-ghost" onClick={handleReset}>Reset</Button>
            </div>
          </div>
          <div className="p-6">
            <EditableGrid 
              columns={columns} 
              rows={rows} 
              onChange={setRows} 
              onAdd={addRow} 
              onDelete={delRow}
              onCellChange={handleCellChange}
            />
            {savingRows.size > 0 && (
              <div className="mt-2 text-sm text-blue-600">
                Saving {savingRows.size} row(s)...
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 text-gray-500">Loading loans...</div>
      )}

      {/* Important Note */}
      <div className="text-sm text-gray-500 bg-blue-50 p-3 rounded-lg border-l-4 border-blue-400" style={{ marginTop: 16 }}>
        <p>
          <strong>Note:</strong> EMI payments are automatically excluded from your Expenses module 
          to avoid double counting. Loan EMIs are tracked separately here and included in your 
          financial projections.
        </p>
      </div>
      <PagePager />
    </div>
  )
}

