
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EditableGrid from '@/components/EditableGrid.jsx';
import { useAuth } from '../contexts/AuthContext';
import { useAdminUser } from '../contexts/AdminUserContext';
import { useLifeSheetStore } from '../store/enhanced-store';
import ApiService from '../services/api';
import UnifiedChart from '@/components/UnifiedChart.jsx';
import PageHeader from '@/components/PageHeader.jsx';
import PagePager from '@/components/PagePager.jsx';
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

export default function WorkAssetsPage() {
  const { user, isAuthenticated } = useAuth();
  const adminUser = useAdminUser();
  const { lifeSheet, updateWorkAssets, setDetailIncome, setSourcePreference } = useLifeSheetStore();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fpCalculatorWorkAssets, setFpCalculatorWorkAssets] = useState(0);
  
  // Check if we're in admin mode
  const isAdminMode = !!adminUser?.userId;
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null);
  const effectiveIsAuthenticated = isAdminMode || isAuthenticated;

  // Load FP calculator work assets (currentAnnualGrossIncome * workTenureYears)
  useEffect(() => {
    const loadFpCalculatorWorkAssets = async () => {
      if (effectiveIsAuthenticated && effectiveUserId) {
        try {
          const response = isAdminMode
            ? await ApiService.getFinancialProfileForUser(effectiveUserId)
            : await ApiService.getFinancialProfile(effectiveUserId);
          if (response && response.profile) {
            const income = parseFloat(response.profile.current_annual_gross_income) || 0;
            const tenure = parseInt(response.profile.work_tenure_years) || 0;
            const fpValue = income * tenure;
            setFpCalculatorWorkAssets(fpValue);
          }
        } catch (error) {
          console.error('❌ Error loading financial profile:', error);
        }
      }
    };
    loadFpCalculatorWorkAssets();
  }, [effectiveIsAuthenticated, effectiveUserId, isAdminMode]);
  
  

  // Fallback: broadcast updates so UnifiedChart can react even without store actions
  const dispatchWorkAssetsEvent = (rows) => {
    try {
      const payload = Array.isArray(rows) ? rows.map(r => ({ ...r })) : [];
      window.dispatchEvent(new CustomEvent('workAssetsUpdated', { detail: { workAssets: payload } }));
    } catch (e) {
      console.warn('Failed to dispatch workAssetsUpdated event:', e);
    }
  };

  // Calculate work income time series and update store
  // Now includes unassigned work assets (from FP calculator)
  const updateStoreWithWorkIncomeTimeSeries = (workAssetsData) => {
    console.log('🔄 Work Assets: updateStoreWithWorkIncomeTimeSeries called with work assets:', workAssetsData.length);
    try {
      const currentYear = new Date().getFullYear();
      const incomeSeries = {};
      
      // Calculate current year detailed work assets annual total
      const detailedWorkAssetsAnnualTotal = workAssetsData.reduce((sum, asset) => {
        const ageInYear = currentAge;
        const startAge = currentAge;
        const endAge = parseInt(asset.endAge) || 65;
        if (ageInYear >= startAge && ageInYear <= endAge) {
          return sum + (parseFloat(asset.amount) || 0);
        }
        return sum;
      }, 0);
      
      // Calculate unassigned work assets annual income
      // FP calculator: currentAnnualGrossIncome (annual) * workTenureYears = Total Human Capital
      // Unassigned annual = FP calculator annual - detailed annual
      const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const incomeGrowthRate = parseFloat(quickCalcAssumptions.incomeGrowthRate) || 0.06;
      
      // Get FP calculator annual income
      const workTenure = parseInt(lifeSheet.workTenureYears) || 1;
      const fpAnnualIncome = fpCalculatorWorkAssets > 0 ? fpCalculatorWorkAssets / workTenure : 0;
      const unassignedAnnualIncome = Math.max(0, fpAnnualIncome - detailedWorkAssetsAnnualTotal);
      
      // For each year, calculate total work income
      const years = horizonYears(lifeSheet.age, lifeSheet.lifespanYears);
      for (let yearOffset = 0; yearOffset <= years; yearOffset++) {
        const year = currentYear + yearOffset;
        let totalIncome = 0;
        
        // 1. Add detailed work assets
        workAssetsData.forEach(asset => {
          const startAge = currentAge;
          const endAge = parseInt(asset.endAge) || 65;
          const ageInYear = startAge + yearOffset;
          
          // Only include income if current age is within the work period
          if (ageInYear >= startAge && ageInYear <= endAge) {
            const yearsFromStart = yearOffset;
            const growthRate = (parseFloat(asset.growthRate) || 0) / 100;
            const annualAmount = parseFloat(asset.amount) || 0;
            const inflatedAmount = annualAmount * Math.pow(1 + growthRate, yearsFromStart);
            totalIncome += inflatedAmount;
          }
        });
        
        // 2. Add unassigned work assets (from FP calculator)
        // Project unassigned annual income with growth rate, only for remaining work tenure
        if (unassignedAnnualIncome > 0 && yearOffset < workTenure) {
          const unassignedIncome = unassignedAnnualIncome * Math.pow(1 + incomeGrowthRate, yearOffset);
          totalIncome += unassignedIncome;
        }
        
        incomeSeries[year] = totalIncome;
      }
      
      console.log('🔄 Work Assets: Calculated income series (includes unassigned):', 
        Object.keys(incomeSeries).slice(0, 5).map(y => [y, incomeSeries[y]]));
      console.log('🔄 Work Assets: Unassigned annual income:', unassignedAnnualIncome);
      
      // Update store with combined income data (no source preference needed)
      setDetailIncome(incomeSeries);
      console.log('🔄 Work Assets: setDetailIncome called successfully');
      
    } catch (error) {
      console.error('❌ Error updating store with work income time series:', error);
    }
  };

// Get current age from the store (same as main page)
  const currentAge = parseInt(lifeSheet.age) || 30;

  // Load work assets from database
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      loadWorkAssets();
    }
  }, [effectiveIsAuthenticated, effectiveUserId]);

  const loadWorkAssets = async () => {
    if (!effectiveUserId) return;
    try {
      setLoading(true);
      const workAssetsPromise = isAdminMode
        ? ApiService.getWorkAssetsForUser(effectiveUserId)
        : ApiService.getWorkAssets(effectiveUserId);
      const workAssets = await workAssetsPromise;
      console.log('🔍 Work assets from API:', workAssets);
      setRows(workAssets);
    
      // keep charts in sync via event
      dispatchWorkAssetsEvent(workAssets);
      
      // Update store with detailed work income time series
      updateStoreWithWorkIncomeTimeSeries(workAssets);
} catch (error) {
      console.error('Error loading work assets:', error);
    } finally {
      setLoading(false);
    }
  };


  const addRow = () => {
    const newRow = { 
      id: `temp_${Date.now()}`, 
      stream: '', 
      amount: 0, 
      growthRate: 3, // This will be treated as 3% in the calculation
      endAge: Math.max(currentAge + 10, 65) // Ensure end age is at least 10 years from current age
    };
    setRows([...rows, newRow]);
  };

  const delRow = async (idx) => {
    const row = rows[idx];
    if (row.id && !row.id.toString().startsWith('temp_')) {
      try {
        if (isAdminMode) {
          await ApiService.deleteWorkAssetForUser(row.id, effectiveUserId);
        } else {
          await ApiService.deleteWorkAsset(row.id);
        }
        // Emit event to notify chart of work asset update
        const updatedRows = rows.filter((_, i) => i !== idx);
        window.dispatchEvent(new CustomEvent('workAssetsUpdated', { 
          detail: { workAssets: updatedRows } 
        }));
      } catch (error) {
        console.error('Error deleting work asset:', error);
      }
    }
    setRows(rows.filter((_, i) => i !== idx));
  };

  const handleCellChange = async (rowIndex, field, value) => {
    const updatedRows = [...rows];
    updatedRows[rowIndex] = { ...updatedRows[rowIndex], [field]: value };
    setRows(updatedRows);

    // event-based live update for charts
    dispatchWorkAssetsEvent(updatedRows);
    
    // Update store with detailed work income time series
    updateStoreWithWorkIncomeTimeSeries(updatedRows);

        const row = updatedRows[rowIndex];
    
    // Auto-save to database
    try {
      if (row.id && !row.id.toString().startsWith('temp_')) {
        // Update existing row
        const updatePromise = isAdminMode
          ? ApiService.updateWorkAssetForUser(row.id, {
              stream: row.stream,
              amount: parseFloat(row.amount) || 0,
              growthRate: parseFloat(row.growthRate) || 0,
              endAge: parseInt(row.endAge) || 65
            }, effectiveUserId)
          : ApiService.updateWorkAsset(row.id, {
              stream: row.stream,
              amount: parseFloat(row.amount) || 0,
              growthRate: parseFloat(row.growthRate) || 0,
              endAge: parseInt(row.endAge) || 65
            });
        await updatePromise;
        // Emit event to notify chart of work asset update
        window.dispatchEvent(new CustomEvent('workAssetsUpdated', { 
          detail: { workAssets: updatedRows } 
        }));
      } else if (row.stream && row.amount) {
        // Create new row
        const createPromise = isAdminMode
          ? ApiService.createWorkAssetForUser({
              stream: row.stream,
              amount: parseFloat(row.amount) || 0,
              growthRate: parseFloat(row.growthRate) || 3,
              endAge: parseInt(row.endAge) || 65
            }, effectiveUserId)
          : ApiService.createWorkAsset({
              stream: row.stream,
              amount: parseFloat(row.amount) || 0,
              growthRate: parseFloat(row.growthRate) || 3,
              endAge: parseInt(row.endAge) || 65
            });
        const newAsset = await createPromise;
        
        // Update the row with the new ID
        updatedRows[rowIndex] = { ...row, id: newAsset.id };
        setRows(updatedRows);
        // Emit event to notify chart of work asset update
        window.dispatchEvent(new CustomEvent('workAssetsUpdated', { 
          detail: { workAssets: updatedRows } 
        }));
      }
    } catch (error) {
      console.error('Error saving work asset:', error);
    }
  };

  const handleReset = () => {
    loadWorkAssets();
  };

  const handleExportCsv = () => {
    const headers = ['Income Stream', 'Annual Amount', 'Growth Rate %', 'End Age'];
    const csvRows = rows.map(row => ([
      row.stream || '',
      row.amount ?? '',
      row.growthRate ?? '',
      row.endAge ?? ''
    ]));
    const content = [headers, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `work-assets-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };


  const columns = [
    { field:'stream', headerName:'Income Stream' }, 
    { field:'amount', headerName:'Annual Amount', type:'number' },
    { field:'growthRate', headerName:'Growth Rate %', type:'number' },
    { field:'endAge', headerName:'End Age', type:'number' }
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
        title="What you earn"
        description="Your income streams beyond regular salary can be valuable work assets — each one is worth what it will still pay you before it stops. Set what each pays this year, how fast it grows and the age it ends, and the mix and the curve below rebuild themselves."
      >
        <div className="lm-assume">
          <label className="lm-agebox">
            Your age today
            <input type="number" readOnly value={currentAge} />
          </label>
          <span className="ahint" style={{ fontSize: 12.5, color: 'var(--lm-slate)', fontWeight: 500 }}>
            Every stream runs from this age until the end age you give it.
          </span>
        </div>
      </PageHeader>
        {rows.length === 0 && (
          <div className="lm-alert">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Start adding your first work asset in the work asset register below. You may
              add as many assets as you want.
            </span>
          </div>
        )}

      <div id="sec-mix">
        <div id="sec-growth" className="lm-card" style={{ padding: '18px 20px 14px', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, marginBottom: 10 }}>Income over time</h3>
          <UnifiedChart defaultEnabled={['workAssets']} />
        </div>
      </div>

      {/* Summary Cards */}
      {(() => {
        const workTenure = parseInt(lifeSheet.workTenureYears) || 1;
        const detailedWorkAssetsAnnualTotal = rows.reduce((sum, row) => {
          const ageInYear = currentAge;
          const startAge = currentAge;
          const endAge = parseInt(row.endAge) || 65;
          if (ageInYear >= startAge && ageInYear <= endAge) {
            return sum + (parseFloat(row.amount) || 0);
          }
          return sum;
        }, 0);
        const detailedWorkAssetsTotal = detailedWorkAssetsAnnualTotal * workTenure;
        const fpAnnualIncome = fpCalculatorWorkAssets > 0 ? fpCalculatorWorkAssets / workTenure : 0;
        const unassignedAnnualIncome = Math.max(0, fpAnnualIncome - detailedWorkAssetsAnnualTotal);
        const unassignedWorkAssets = unassignedAnnualIncome * workTenure;
        
        return (
          <div className="lifemap-stat-grid">
            <div className="lifemap-stat-card">
              <p className="lifemap-stat-title">Detailed Work Assets</p>
              <div className="lifemap-stat-value text-emerald-600">
                {formatCurrency(detailedWorkAssetsTotal)}
              </div>
              <p className="text-xs text-slate-500">{rows.length} income streams</p>
            </div>
            <div className="lifemap-stat-card">
              <p className="lifemap-stat-title">Unassigned Work Assets</p>
              <div className="lifemap-stat-value text-orange-600">
                {formatCurrency(unassignedWorkAssets)}
              </div>
              <p className="text-xs text-slate-500">From FP Calculator</p>
            </div>
            <div className="lifemap-stat-card">
              <p className="lifemap-stat-title">Total Work Assets</p>
              <div className="lifemap-stat-value text-purple-600">
                {formatCurrency(detailedWorkAssetsTotal + unassignedWorkAssets)}
              </div>
              <p className="text-xs text-slate-500">{rows.length} detailed + unassigned</p>
            </div>
          </div>
        );
      })()}

      <div id="sec-register" className="lm-card">
        <div className="lm-reghead">
          <h3>Work asset register</h3>
          <span className="count">{rows.length} streams</span>
          <div className="r">
            <Button size="sm" className="lm-ghost primary" onClick={addRow}>+ Add row</Button>
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
        </div>
      </div>
      <PagePager />
    </div>
  );
}
