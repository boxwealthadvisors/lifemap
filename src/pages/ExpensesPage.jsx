
import React, { useEffect, useState } from 'react';
import EditableGrid from '@/components/EditableGrid.jsx';
import ExpensesChart from '@/components/ExpensesChart.jsx';
import ExpenseCategoriesModal from '@/components/ExpenseCategoriesModal.jsx';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminUser } from '@/contexts/AdminUserContext';
import { useLifeSheetStore } from '../store/enhanced-store';
import ApiService from '@/services/api';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader.jsx';
import PagePager from '@/components/PagePager.jsx';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Settings2 } from 'lucide-react';
import { horizonYears } from '../lib/planLinks';

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

export default function ExpensesPage() {
  const { user } = useAuth();
  const adminUser = useAdminUser();
  
  // Check if we're in admin mode
  const isAdminMode = !!adminUser?.userId;
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null);
  const effectiveIsAuthenticated = isAdminMode || !!user;
  const { setDetailExpenses, setSourcePreference, setExpenses } = useLifeSheetStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingRows, setSavingRows] = useState(new Set());
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('category');

  // Event dispatching for live chart updates (following WorkAssetsPage pattern)
  const dispatchExpensesEvent = (updatedExpenses) => {
    try {
      const payload = Array.isArray(updatedExpenses) ? updatedExpenses.map(e => ({ ...e })) : [];
      window.dispatchEvent(new CustomEvent('expensesUpdated', { detail: { expenses: payload } }));
    } catch (e) {
      console.warn('Failed to dispatch expensesUpdated event:', e);
    }
  };

  // Calculate expenses time series and update store
  const updateStoreWithExpensesTimeSeries = (expensesData) => {
    console.log('🔄 Expenses: updateStoreWithExpensesTimeSeries called with expenses:', expensesData.length);
    try {
      const currentYear = new Date().getFullYear();
      const expensesSeries = {};
      const assumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const years = horizonYears(assumptions.age, assumptions.lifespanYears);
      
      // For each year, calculate total expenses with inflation
      for (let yearOffset = 0; yearOffset <= years; yearOffset++) {
        const year = currentYear + yearOffset;
        let totalExpenses = 0;
        
        expensesData.forEach(expense => {
          const annualAmount = parseFloat(expense.annual_budget) || 0;
          const inflationRate = (parseFloat(expense.personal_inflation) || 6) / 100;
          
          // Apply inflation for each year
          const inflatedAmount = annualAmount * Math.pow(1 + inflationRate, yearOffset);
          totalExpenses += inflatedAmount;
        });
        
        expensesSeries[year] = totalExpenses;
      }
      
      console.log('🔄 Expenses: Calculated expenses series for first 5 years:', 
        Object.keys(expensesSeries).slice(0, 5).map(y => [y, expensesSeries[y]]));
      
      // Update store with detailed expenses data
      setDetailExpenses(expensesSeries);
      // No longer using source preference for expenses - always use detailed expenses
      console.log('🔄 Expenses: setDetailExpenses called successfully');
      console.log('🔄 Expenses: Source preference set to detailed (1)');
      
    } catch (error) {
      console.error('❌ Error updating store with expenses time series:', error);
    }
  };

  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      loadExpenses();
    } else if (!effectiveIsAuthenticated) {
      // If not authenticated, set loading to false immediately
      setLoading(false);
    }
  }, [effectiveIsAuthenticated, effectiveUserId]);

  const loadExpenses = async () => {
    if (!effectiveUserId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const response = isAdminMode
        ? await ApiService.getFinancialExpensesForUser(effectiveUserId)
        : await ApiService.getFinancialExpenses(effectiveUserId);
      const expenses = response.expenses || response || [];
      
      // Map database fields to frontend field names
      const mappedExpenses = expenses.map(expense => {
        const amount = parseFloat(expense.amount) || 0;
        const frequency = expense.frequency || 'Monthly';
        
        // Calculate annual budget based on frequency
        let annualBudget = amount;
        if (frequency === 'Weekly') annualBudget = amount * 52;
        else if (frequency === 'Fortnightly') annualBudget = amount * 26;
        else if (frequency === 'Monthly') annualBudget = amount * 12;
        else if (frequency === 'Quarterly') annualBudget = amount * 4;
        else if (frequency === 'Semi-Annually') annualBudget = amount * 2;
        else if (frequency === 'Annually') annualBudget = amount;
        
        return {
          id: expense.id,
          description: expense.description || '', // Specific Goods/Service
          amount: amount, // Price/Unit
          frequency: frequency, // Expense Frequency
          annual_budget: annualBudget, // Annual Budget (calculated)
          category: expense.category || '',
          subcategory: expense.subcategory || '',
          tag_for: expense.tag_for || '', // For tag
          lifestyle_level: expense.lifestyle_level || '', // Lifestyle level
          payment_from: expense.payment_from || '', // Payment From
          expiry: expense.expiry ? (typeof expense.expiry === 'string' ? parseInt(expense.expiry.split('-')[0]) : expense.expiry.getFullYear()) : '', // Expiry year (like loan expiry)
          source: expense.source,
          personal_inflation: parseFloat(expense.personal_inflation) || 6,
          notes: expense.notes || '',
          loan_id: expense.loan_id || null, // Link to loan if this is a loan EMI expense
          insurance_id: expense.insurance_id || null, // Link to insurance if this is an insurance premium expense
          user_id: expense.user_id,
          created_at: expense.created_at,
          updated_at: expense.updated_at
        };
      });
      
      setRows(mappedExpenses);
      
      // Update store with expenses array (for ExpensesChart to read)
      setExpenses(mappedExpenses);
      
      // Dispatch event for live chart updates (following WorkAssetsPage pattern)
      dispatchExpensesEvent(mappedExpenses);
      
      // Update store with detailed expenses time series
      updateStoreWithExpensesTimeSeries(mappedExpenses);
    } catch (error) {
      console.error('Error loading expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    const newRow = {
      id: `temp_${Date.now()}`,
      description: '', // Specific Goods/Service
      amount: 0, // Price/Unit
      frequency: 'Monthly', // Expense Frequency
      annual_budget: 0, // Annual Budget (calculated)
      category: '', // Will be auto-classified by LLM
      subcategory: '', // Will be auto-classified by LLM
      tag_for: '', // For tag
      lifestyle_level: '', // Lifestyle level
      payment_from: '', // Payment From
      expiry: '', // Expiry date
      source: '',
      personal_inflation: 6,
      notes: ''
    };
    setRows([...rows, newRow]);
  };

  const delRow = async (rowIndex) => {
    const row = rows[rowIndex];
    
    const updatedRows = rows.filter((_, i) => i !== rowIndex);
    
    if (row.id && !row.id.toString().startsWith('temp_')) {
      try {
        // Check if this expense is linked to a loan (has loan_id)
        if (row.loan_id) {
          console.log('🗑️ Deleting expense with loan_id, will also delete associated loan:', row.loan_id);
          try {
            // Delete the associated loan first
            await ApiService.deleteFinancialLoan(row.loan_id);
            console.log('✅ Deleted associated loan:', row.loan_id);
          } catch (loanError) {
            console.error('Error deleting associated loan:', loanError);
            // Continue with expense deletion even if loan deletion fails
          }
        }
        
        // Check if this expense is linked to insurance (has insurance_id)
        if (row.insurance_id) {
          console.log('🗑️ Deleting expense with insurance_id, will also delete associated insurance:', row.insurance_id);
          try {
            // Delete the associated insurance
            await ApiService.deleteFinancialInsurance(row.insurance_id);
            console.log('✅ Deleted associated insurance:', row.insurance_id);
          } catch (insuranceError) {
            console.error('Error deleting associated insurance:', insuranceError);
            // Continue with expense deletion even if insurance deletion fails
          }
        }
        
        // Delete the expense
        await ApiService.deleteFinancialExpense(row.id);
      } catch (error) {
        console.error('Error deleting expense:', error);
      }
    }
    
    setRows(updatedRows);
    
    // Update store with expenses array
    setExpenses(updatedRows);
    
    // Dispatch event for live chart updates (following WorkAssetsPage pattern)
    dispatchExpensesEvent(updatedRows);
  };

  // Save row to database (used after classification and on blur)
  const saveRowToDb = async (rowIndex, overrideTags = null) => {
    if (savingRows.has(rowIndex)) {
      return;
    }
    
    // Get current row data from state
    const row = rows[rowIndex];
    if (!row) return;
    
    if (row.id && !row.id.toString().startsWith('temp_')) {
      // Update existing row
      if (row.description && row.amount) {
        setSavingRows(prev => new Set(prev).add(rowIndex));
        
        const updatePayload = {
          description: row.description || row.category || '',
          amount: parseFloat(row.amount) || 0,
          frequency: row.frequency || 'Monthly',
          personal_inflation: parseFloat(row.personal_inflation) / 100 || 0.06,
        };
        
        if (row.category && row.category.trim()) {
          updatePayload.category = row.category.trim();
        }
        if (row.subcategory && row.subcategory.trim()) {
          updatePayload.subcategory = row.subcategory.trim();
        }
        
        // Use override tags if provided, otherwise use row values
        if (overrideTags) {
          // Always include tag fields when overrideTags is provided (even if empty to clear them)
          // Send null for empty strings so backend can clear the field
          updatePayload.tag_for = overrideTags.tag_for && overrideTags.tag_for.trim() ? overrideTags.tag_for.trim() : null;
          updatePayload.lifestyle_level = overrideTags.lifestyle_level && overrideTags.lifestyle_level.trim() ? overrideTags.lifestyle_level.trim() : null;
          updatePayload.payment_from = overrideTags.payment_from && overrideTags.payment_from.trim() ? overrideTags.payment_from.trim() : null;
          console.log('💾 Saving with override tags:', updatePayload);
        } else {
          if (row.tag_for && row.tag_for.trim()) {
            updatePayload.tag_for = row.tag_for.trim();
          }
          if (row.lifestyle_level && row.lifestyle_level.trim()) {
            updatePayload.lifestyle_level = row.lifestyle_level.trim();
          }
          if (row.payment_from && row.payment_from.trim()) {
            updatePayload.payment_from = row.payment_from.trim();
          }
        }
        if (row.expiry) {
          // Convert year to date format (YYYY-12-31) like loans
          const expiryYear = typeof row.expiry === 'number' ? row.expiry : parseInt(row.expiry);
          if (!isNaN(expiryYear)) {
            updatePayload.expiry = `${expiryYear}-12-31`;
          }
        }
        if (row.source && row.source.trim()) {
          updatePayload.source = row.source.trim();
        }
        if (row.notes && row.notes.trim()) {
          updatePayload.notes = row.notes.trim();
        }
        
        try {
          const response = await ApiService.updateFinancialExpense(row.id, updatePayload);
          console.log('✅ Expense updated successfully:', response);
        } catch (error) {
          console.error('❌ Error updating expense:', error);
        } finally {
          setSavingRows(prev => {
            const newSet = new Set(prev);
            newSet.delete(rowIndex);
            return newSet;
          });
        }
      }
    }
    
    if (row.description && row.amount && row.id && row.id.toString().startsWith('temp_')) {
      // Create new row
      setSavingRows(prev => new Set(prev).add(rowIndex));
        
        const createPayload = {
          description: row.description || row.category || '',
          amount: parseFloat(row.amount) || 0,
          frequency: row.frequency || 'Monthly',
          personal_inflation: parseFloat(row.personal_inflation) / 100 || 0.06,
        };
        
        if (row.category && row.category.trim()) {
          createPayload.category = row.category.trim();
        }
        if (row.subcategory && row.subcategory.trim()) {
          createPayload.subcategory = row.subcategory.trim();
        }
        
        // Use override tags if provided, otherwise use row values
        if (overrideTags) {
          // Always include tag fields when overrideTags is provided (even if empty)
          createPayload.tag_for = overrideTags.tag_for ? overrideTags.tag_for.trim() : '';
          createPayload.lifestyle_level = overrideTags.lifestyle_level ? overrideTags.lifestyle_level.trim() : '';
          createPayload.payment_from = overrideTags.payment_from ? overrideTags.payment_from.trim() : '';
        } else {
          if (row.tag_for && row.tag_for.trim()) {
            createPayload.tag_for = row.tag_for.trim();
          }
          if (row.lifestyle_level && row.lifestyle_level.trim()) {
            createPayload.lifestyle_level = row.lifestyle_level.trim();
          }
          if (row.payment_from && row.payment_from.trim()) {
            createPayload.payment_from = row.payment_from.trim();
          }
        }
        if (row.expiry) {
          // Convert year to date format (YYYY-12-31) like loans
          const expiryYear = typeof row.expiry === 'number' ? row.expiry : parseInt(row.expiry);
          if (!isNaN(expiryYear)) {
            createPayload.expiry = `${expiryYear}-12-31`;
          }
        }
        if (row.source && row.source.trim()) {
          createPayload.source = row.source.trim();
        }
        if (row.notes && row.notes.trim()) {
          createPayload.notes = row.notes.trim();
        }
        
        ApiService.createFinancialExpense(createPayload).then(newExpense => {
          setRows(prevRows => {
            const updatedRows = [...prevRows];
            updatedRows[rowIndex] = { ...row, id: newExpense.expense.id };
            return updatedRows;
          });
        }).finally(() => {
          setSavingRows(prev => {
            const newSet = new Set(prev);
            newSet.delete(rowIndex);
            return newSet;
          });
        }).catch(error => console.error('Error creating expense:', error));
    }
  };

  // Handle LLM classification on description blur

  const handleCellChange = async (rowIndex, field, value) => {
    try {
      console.log(`handleCellChange: rowIndex=${rowIndex}, field=${field}, value=${value}`);
      
      // Use functional update to avoid stale closure issues - do everything in one call
      setRows(prevRows => {
        const updatedRows = [...prevRows];
        const nextRow = { ...updatedRows[rowIndex], [field]: value };
        if (field === 'category' && (!nextRow.description || nextRow.description.trim() === '')) {
          nextRow.description = value;
        }
        updatedRows[rowIndex] = nextRow;
        console.log(`Updated row ${rowIndex}:`, updatedRows[rowIndex]);
        
        // Recalculate annual_budget when amount or frequency changes
        if (field === 'amount' || field === 'frequency') {
          const amount = parseFloat(updatedRows[rowIndex].amount) || 0;
          const frequency = updatedRows[rowIndex].frequency || 'Monthly';
          
          let annualBudget = amount;
          if (frequency === 'Weekly') annualBudget = amount * 52;
          else if (frequency === 'Fortnightly') annualBudget = amount * 26;
          else if (frequency === 'Monthly') annualBudget = amount * 12;
          else if (frequency === 'Quarterly') annualBudget = amount * 4;
          else if (frequency === 'Semi-Annually') annualBudget = amount * 2;
          else if (frequency === 'Annually') annualBudget = amount;
          
          updatedRows[rowIndex].annual_budget = annualBudget;
        }
        
        // Update store with expenses array
        setExpenses(updatedRows);
        
        // Dispatch event for live chart updates (use updatedRows, not prevRows)
        dispatchExpensesEvent(updatedRows);
        
        // Update store with detailed expenses time series (use updatedRows)
        updateStoreWithExpensesTimeSeries(updatedRows);
        
        return updatedRows;
      });

      // Debounce auto-save on blur (like LoansPage pattern)
      const timeoutKey = `expense_row_${rowIndex}`;
      clearTimeout(window[timeoutKey]);
      
      window[timeoutKey] = setTimeout(() => {
        saveRowToDb(rowIndex);
      }, 1000); // 1 second debounce
    } catch (error) {
      console.error('Error in handleCellChange:', error);
    }
  };

  const handleReset = () => {
    loadExpenses();
  };

  const handleExportCsv = () => {
    const headers = ['Category', 'Amount', 'Frequency', 'Subcategory', 'Inflation %', 'Source', 'Notes'];
    const csvRows = rows.map(row => ([
      row.category || '',
      row.amount ?? '',
      row.frequency || '',
      row.subcategory || '',
      row.personal_inflation ?? '',
      row.source || '',
      row.notes || ''
    ]));
    const content = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `expenses-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Calculate summary statistics
  const totalAnnualExpenses = rows.reduce((sum, expense) => {
    return sum + (parseFloat(expense.annual_budget) || 0);
  }, 0);

  const columns = [
    { field: 'category', headerName: 'Category' },
    { field: 'amount', headerName: 'Amount (₹)', type: 'number' },
    { 
      field: 'frequency', 
      headerName: 'Frequency',
      type: 'select',
      options: ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Semi-Annually', 'Annually']
    },
    { field: 'subcategory', headerName: 'Subcategory' },
    { field: 'personal_inflation', headerName: 'Inflation %', type: 'number' },
    { field: 'source', headerName: 'Source' },
    { field: 'notes', headerName: 'Notes' }
  ];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-lg">Loading expenses...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="lm-body">
      <PageHeader
        title="What you spend"
        description="Every recurring cost, in one register, with the years of your life it actually applies to. School fees stop, instalments end, healthcare climbs — so the curve steps rather than sweeps."
      />
        {rows.length === 0 && (
          <div className="lm-alert">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Start adding your expenses in the expense register below to get an output on
              the chart. You may add as many expenses as you want.
            </span>
          </div>
        )}

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          className={`lm-ghost ${activeTab === 'category' ? 'primary' : ''}`}
          onClick={() => setActiveTab('category')}
        >
          Category Mix Over Time
        </button>
        <button
          type="button"
          className={`lm-ghost ${activeTab === 'nws' ? 'primary' : ''}`}
          onClick={() => setActiveTab('nws')}
        >
          Needs / Wants / Savings
        </button>
      </div>

      {/* Summary Cards */}
      <div id="sec-mix" className="lifemap-stat-grid">
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Total Annual Expenses</p>
          <div className="lifemap-stat-value text-emerald-600">
            {formatCurrency(totalAnnualExpenses)}
          </div>
          <p className="text-xs text-slate-500">{rows.length} expense entries</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm font-semibold text-slate-700">
            Track your recurring expenses and their growth
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-slate-700 underline"
              onClick={handleReset}
            >
              Reset
            </button>
          </div>
        </div>

        <div id="sec-register" className="lm-card">
          <div className="lm-reghead">
            <h3>Expense register</h3>
            <span className="count">{rows.length} items</span>
            <div className="r">
              <Button size="sm" className="lm-ghost primary" onClick={addRow}>
                + Add row
              </Button>
              <Button size="sm" variant="outline" className="lm-ghost" onClick={handleExportCsv}>
                Export CSV
              </Button>
            </div>
          </div>
          <div className="p-6">
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <Input placeholder="Search by keyword" className="h-8 w-44" />
              <Select defaultValue="all">
                <SelectTrigger className="h-8 w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tags</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
      </div>

      <div id="sec-growth">
        <div id="sec-rule" className="lm-card" style={{ padding: '18px 20px', marginTop: 16 }}>
          <ExpensesChart activeView={activeTab} />
        </div>
      </div>

      {savingRows.size > 0 && (
        <div className="text-sm text-blue-600 bg-blue-50 p-2 rounded">
          Saving changes...
        </div>
      )}

      {user?.id && (
        <ExpenseCategoriesModal
          userId={user.id}
          open={categoriesModalOpen}
          onOpenChange={setCategoriesModalOpen}
        />
      )}
      <PagePager />
    </div>
  );
}
