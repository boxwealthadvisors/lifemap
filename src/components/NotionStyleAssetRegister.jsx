import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Plus, Trash2, Search, Download, Filter, MoreHorizontal, RefreshCw, GripVertical, PiggyBank } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAdminUser } from '@/contexts/AdminUserContext'
import { eventBus } from '@/lib/eventBus'
import { syncEarmarkingData } from '@/lib/goalCalculations'
import ApiService from '@/services/api'
import { useLifeSheetStore } from '@/store/enhanced-store'
import EarmarkingInput from './EarmarkingInput'
import { CORE_COLUMNS } from '@/constants/columns'
import { horizonYears } from '@/lib/planLinks'

const NotionStyleAssetRegister = () => {
  const { user, isAuthenticated } = useAuth()
  const adminUser = useAdminUser()
  
  // Check if we're in admin mode
  const isAdminMode = !!adminUser?.userId
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null)
  const effectiveIsAuthenticated = isAdminMode || isAuthenticated
  const [assets, setAssets] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTag, setFilterTag] = useState('all')
  const [editingCell, setEditingCell] = useState(null)
  const [tempValue, setTempValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Auto-clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [error])
  const [customColumns, setCustomColumns] = useState([])
  const [editingColumn, setEditingColumn] = useState(null)
  const [newColumnName, setNewColumnName] = useState('')
  const [newColumnType, setNewColumnType] = useState('text')
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
  const [showTagModal, setShowTagModal] = useState(false)
  const [availableTags, setAvailableTags] = useState([])
  const [newTag, setNewTag] = useState('')
  const [loadingTags, setLoadingTags] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [goals, setGoals] = useState([])
  const [showAllColumns, setShowAllColumns] = useState(false)
  const [draggedColumn, setDraggedColumn] = useState(null)
  const [isReordering, setIsReordering] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Reset loaded state when user changes
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId) {
      setHasLoaded(false)
    }
  }, [effectiveIsAuthenticated, effectiveUserId])

  // Listen for goal linked assets changes from Goals page
  useEffect(() => {
    console.log('🔧 Assets page setting up eventBus listener for goalLinkedAssetsChanged');

    const handleGoalLinkedAssetsChange = (data) => {
      console.log('🔄 Assets page received goal linked assets change event:', data);
      setAssets(prevAssets => {
        console.log('🔄 Current assets before sync:', prevAssets.length);
        console.log('🔄 Goals data received:', data.allGoals?.length);
        
        // Sync assets with the updated goals
        const { updatedAssets } = syncEarmarkingData(prevAssets, data.allGoals);
        console.log('🔄 Synced assets after goal linked assets change:', updatedAssets.length);
        console.log('🔄 Updated assets details:', updatedAssets.map(a => ({
          id: a.id,
          name: a.name,
          goalEarmarks: a.custom_data?.goalEarmarks
        })));
        return updatedAssets;
      });
    };

    const unsubscribe = eventBus.subscribe('goalLinkedAssetsChanged', handleGoalLinkedAssetsChange);
    console.log('🔧 Assets page eventBus listener registered');

    return () => {
      console.log('🔧 Assets page eventBus listener unregistered');
      unsubscribe();
    };
  }, []); // ⬅️ mount once

  // Load assets and columns from database
  useEffect(() => {
    if (effectiveIsAuthenticated && effectiveUserId && !hasLoaded && !isLoading) {
      setIsLoading(true)
      const loadAllData = async () => {
        try {
          // Load in sequence to avoid overwhelming the API and to catch errors better
          await loadAssets()
          await loadCustomColumns()
          await loadUserTags()
          await loadGoals()
          
          // Note: Sync will happen in separate useEffect after both assets and goals are loaded
          
          setHasLoaded(true)
        } catch (error) {
          console.error('Error loading initial data:', error)
          setError(`Failed to load data: ${error.message || 'Unknown error'}`)
          // Still set hasLoaded to true to prevent infinite retries
          setHasLoaded(true)
        } finally {
          setIsLoading(false)
        }
      }
      loadAllData()
    }
  }, [effectiveIsAuthenticated, effectiveUserId])

  // Don't auto-sync assets with goals during page load to preserve deletions
  // The sync will happen when needed through user actions
  // useEffect(() => {
  //   if (hasLoaded && assets.length > 0 && goals.length > 0) {
  //     console.log('🔄 Syncing assets with goals after load...')
  //     const { updatedAssets } = syncEarmarkingData(assets, goals)
  //     console.log('🔄 Synced assets:', updatedAssets)
  //     setAssets(updatedAssets)
  //   }
  // }, [hasLoaded, assets.length, goals.length])

  const loadAssets = async () => {
    try {
      const response = isAdminMode
        ? await ApiService.getFinancialAssetsForUser(effectiveUserId)
        : await ApiService.getFinancialAssets(effectiveUserId)
      console.log('📊 Assets fetch response:', response)
      const assetsData = response.assets || []
      setAssets(assetsData)
      // Dispatch event for AssetsPage to track count
      try {
        window.dispatchEvent(new CustomEvent('assetsUpdated', { detail: { assets: assetsData } }))
      } catch (e) {
        console.warn('Failed to dispatch assetsUpdated event:', e)
      }
    } catch (error) {
      console.error('❌ Assets fetch error:', error)
      setError('Failed to load assets')
      throw error // Re-throw to be caught by Promise.all
    }
  }

  const loadCustomColumns = async () => {
    try {
      const response = isAdminMode
        ? await ApiService.getAssetColumnsForUser(effectiveUserId)
        : await ApiService.getAssetColumns(effectiveUserId)
      console.log('📊 Columns fetch response:', response)
      
      // Backend will automatically create default columns if none exist
      const columns = response.columns.map(col => ({
        id: col.id,
        key: col.column_key,
        label: col.column_label,
        type: col.column_type,
        column_order: col.column_order
      }))
      
      
      // Ensure goal earmarks column exists
      const hasGoalEarmarksColumn = columns.some(col => col.key === 'goalEarmarks')
      if (!hasGoalEarmarksColumn) {
        try {
          await ApiService.createAssetColumn({
            column_key: 'goalEarmarks',
            column_label: 'Goal Earmarks',
            column_type: 'text',
            column_order: columns.length
          })
          columns.push({
            id: 'goalEarmarks',
            key: 'goalEarmarks',
            label: 'Goal Earmarks',
            type: 'text'
          })
        } catch (error) {
          console.error('❌ Failed to create goal earmarks column:', error)
        }
      }
      
      setCustomColumns(columns)
    } catch (error) {
      console.error('❌ Columns fetch error:', error)
      setCustomColumns([])
      throw error // Re-throw to be caught by Promise.all
    }
  }

  const loadUserTags = async () => {
    try {
      const response = isAdminMode
        ? await ApiService.getUserTagsForUser(effectiveUserId)
        : await ApiService.getUserTags(effectiveUserId)
      console.log('🏷️ Tags fetch response:', response)
      
      // Backend will automatically create default tags if none exist
      setAvailableTags(response.tags.map(tag => tag.tag_name))
    } catch (error) {
      console.error('❌ Tags fetch error:', error)
      setAvailableTags(['Investment', 'Personal', 'Emergency', 'Retirement']) // Fallback
      throw error // Re-throw to be caught by Promise.all
    }
  }

  const loadGoals = async () => {
    try {
      const response = isAdminMode
        ? await ApiService.getFinancialGoalsForUser(effectiveUserId)
        : await ApiService.getFinancialGoals(effectiveUserId)
      console.log('🎯 Goals fetch response:', response)
      const goalsData = response.goals || []
      setGoals(goalsData)
      console.log('🎯 Goals loaded:', goalsData.length, 'goals')
      return goalsData
    } catch (error) {
      console.error('❌ Goals fetch error:', error)
      setGoals([])
      throw error // Re-throw to be caught by Promise.all
    }
  }

  // Filter columns based on showAllColumns setting
  const getVisibleColumns = () => {
    // Columns to exclude completely
    const excludedColumns = ['owner', 'units', 'costBasis', 'currency', 'updated_at']
    
    // Filter out excluded columns and sort by column_order
    let filteredColumns = customColumns
      .filter(col => !excludedColumns.includes(col.key))
      .sort((a, b) => (a.column_order || 0) - (b.column_order || 0))
    
    if (showAllColumns) {
      // When showing all, prioritize important columns first (excluding goalEarmarks for now)
      const importantColumns = filteredColumns.filter(col => 
        CORE_COLUMNS.filter(key => key !== 'goalEarmarks').includes(col.key)
      )
      const otherColumns = filteredColumns.filter(col => 
        !CORE_COLUMNS.includes(col.key)
      )
      const goalEarmarksColumn = filteredColumns.filter(col => col.key === 'goalEarmarks')
      
      // Return: important columns + other columns + goal earmarks (at the end)
      return [...importantColumns, ...otherColumns, ...goalEarmarksColumn]
    }
    
    // Default: show core columns (always visible) and all user-created custom columns
    const visibleColumns = filteredColumns.filter(column => {
      // Always show core columns (non-deletable, always visible)
      if (CORE_COLUMNS.includes(column.key)) {
        return true
      }
      
      // Show all user-created custom columns (even if empty)
      // This allows users to see and edit their custom columns
      return true
    })
    
    // Separate goalEarmarks and add it at the end
    const goalEarmarksColumn = visibleColumns.filter(col => col.key === 'goalEarmarks')
    const otherVisibleColumns = visibleColumns.filter(col => col.key !== 'goalEarmarks')
    
    return [...otherVisibleColumns, ...goalEarmarksColumn]
  }

  const visibleColumns = getVisibleColumns()


  const filteredAssets = assets.filter(asset => {
    const customData = asset.custom_data || {}
    const matchesSearch = (asset.name && asset.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (customData.subType && customData.subType.toLowerCase().includes(searchTerm.toLowerCase())) ||
                         (customData.owner && customData.owner.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesFilter = filterTag === 'all' || asset.tag === filterTag
    return matchesSearch && matchesFilter
  })

  // Sort assets based on sortConfig
  const sortedAssets = [...filteredAssets].sort((a, b) => {
    if (!sortConfig.key) return 0

    let aValue, bValue

    // Get values based on sort key
    if (['name', 'tag', 'current_value'].includes(sortConfig.key)) {
      aValue = a[sortConfig.key]
      bValue = b[sortConfig.key]
    } else {
      // Custom column data
      aValue = (a.custom_data && a.custom_data[sortConfig.key]) || ''
      bValue = (b.custom_data && b.custom_data[sortConfig.key]) || ''
    }

    // Handle different data types for sorting
    const column = customColumns.find(col => col.key === sortConfig.key)
    const columnType = (column && column.type) || 'text'

    if (columnType === 'number' || columnType === 'currency') {
      aValue = parseFloat(aValue) || 0
      bValue = parseFloat(bValue) || 0
    } else if (columnType === 'date') {
      aValue = new Date(aValue).getTime() || 0
      bValue = new Date(bValue).getTime() || 0
    } else {
      // Text, email, url - case insensitive string comparison
      aValue = String(aValue).toLowerCase()
      bValue = String(bValue).toLowerCase()
    }

    if (aValue < bValue) {
      return sortConfig.direction === 'asc' ? -1 : 1
    }
    if (aValue > bValue) {
      return sortConfig.direction === 'asc' ? 1 : -1
    }
    return 0
  })

  const handleAddAsset = async () => {
    try {
      setLoading(true)
      const assetData = {
        name: 'New Asset',
        tag: 'Investment',
        current_value: 0,
        custom_data: {
          subType: '',
          owner: '',
          currency: 'INR',
          units: 0,
          costBasis: 0,
          notes: '',
          expectedReturn: (() => {
            try {
              const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
              return (quickCalcAssumptions.assetGrowthRate || 0.06) * 100; // Convert to percentage
            } catch {
              return 6; // Default 6% if localStorage fails
            }
          })(),
          sipExpiryDate: ''
        }
      }
      
      const createPromise = isAdminMode
        ? ApiService.createFinancialAssetForUser(assetData, effectiveUserId)
        : ApiService.createFinancialAsset(assetData)
      
      const response = await createPromise
      
      if (response.asset) {
        const updatedAssets = [...assets, response.asset]
        setAssets(updatedAssets)
        
        // Emit event to notify chart of asset addition (legacy)
        eventBus.emit('assetUpdated', {
          action: 'add',
          assetId: response.asset.id,
          updatedAsset: response.asset,
          allAssets: updatedAssets
        })
        
        // Dispatch event for live chart updates (following WorkAssetsPage pattern)
        dispatchAssetsEvent(updatedAssets)
      }
    } catch (error) {
      console.error('❌ Asset creation error:', error)
      setError('Failed to create asset')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAsset = async (assetId) => {
    if (!assetId) return
    
    try {
      setLoading(true)
      if (isAdminMode) {
        await ApiService.deleteFinancialAssetForUser(assetId, effectiveUserId)
      } else {
        await ApiService.deleteFinancialAsset(assetId)
      }
      const updatedAssets = assets.filter(asset => asset.id !== assetId)
      setAssets(updatedAssets)
      
      // Emit event to notify chart of asset deletion (legacy)
      eventBus.emit('assetUpdated', {
        action: 'delete',
        assetId,
        allAssets: updatedAssets
      })
      
      // Dispatch event for live chart updates (following WorkAssetsPage pattern)
      dispatchAssetsEvent(updatedAssets)
    } catch (error) {
      console.error('❌ Asset deletion error:', error)
      setError('Failed to delete asset')
    } finally {
      setLoading(false)
    }
  }

  const handleCellEdit = (assetId, field, value) => {
    setEditingCell({ assetId, field })
    setTempValue(value)
  }

  // Event dispatching for live chart updates (following WorkAssetsPage pattern)
  const dispatchAssetsEvent = (updatedAssets) => {
    try {
      const payload = Array.isArray(updatedAssets) ? updatedAssets.map(a => ({ ...a })) : [];
      window.dispatchEvent(new CustomEvent('assetsUpdated', { detail: { assets: payload } }));
      
      // Also update the store with detailed time series for main page
      updateStoreWithAssetTimeSeries(updatedAssets);
    } catch (e) {
      console.warn('Failed to dispatch assetsUpdated event:', e);
    }
  };

  // Calculate detailed asset time series and update store (using same logic as UnifiedChart)
  // Now includes unassigned assets (from FP calculator) with 60:40 split
  const updateStoreWithAssetTimeSeries = (assetsData) => {
    console.log('🔄 Assets: updateStoreWithAssetTimeSeries called with assets:', assetsData.length);
    try {
      const { setDetailAssets } = useLifeSheetStore.getState();
      console.log('🔄 Assets: setDetailAssets function:', typeof setDetailAssets);
      
      // Get unassigned assets (FP calculator value - sum of detailed assets)
      const detailedAssetsTotal = assetsData.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0);
      const unassignedAssetsValue = Math.max(0, fpCalculatorAssets - detailedAssetsTotal);
      
      // Get growth assumptions
      const quickCalcAssumptions = JSON.parse(localStorage.getItem('quickCalcAssumptions') || '{}');
      const assetEquitySplit = parseFloat(quickCalcAssumptions.assetEquitySplit) || 0.60;
      const assetEquityGrowthRate = parseFloat(quickCalcAssumptions.assetEquityGrowthRate) || 0.15;
      const assetDebtGrowthRate = parseFloat(quickCalcAssumptions.assetDebtGrowthRate) || 0.07;
      const defaultAssetGrowthRate = (quickCalcAssumptions.assetGrowthRate || 0.06) * 100; // Convert to percentage
      
      // Calculate portfolio series for each year
      const currentYear = new Date().getFullYear();
      const portfolioSeries = {};
      const years = horizonYears(quickCalcAssumptions.age, quickCalcAssumptions.lifespanYears);
      
      for (let yearOffset = 0; yearOffset <= years; yearOffset++) {
        const year = currentYear + yearOffset;
        let totalAssets = 0;
        
        // 1. Add detailed assets (with individual expectedReturn)
        assetsData.forEach(asset => {
          const value = parseFloat(asset.current_value) || 0;
          const customData = asset.custom_data || {};
          const expectedReturn = parseFloat(customData.expectedReturn) || defaultAssetGrowthRate;
          const growthRate = expectedReturn / 100;
          
          const grownValue = calculateSIPProjection({
            initial: value,
            sipAmount: parseFloat(customData.sipAmount) || 0,
            sipFrequency: customData.sipFrequency || '',
            annualRate: growthRate,
            years: yearOffset,
            sipExpiryDate: customData.sipExpiryDate || ''
          });
          
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
      
      console.log('🔄 Assets: Updating store with portfolio series (includes unassigned):', portfolioSeries);
      console.log('🔄 Assets: Unassigned assets value:', unassignedAssetsValue);
      console.log('🔄 Assets: Sample values:', {
        year2025: portfolioSeries[2025],
        year2030: portfolioSeries[2030],
        year2035: portfolioSeries[2035]
      });
      setDetailAssets(portfolioSeries);
      console.log('🔄 Assets: setDetailAssets called successfully');
      
    } catch (error) {
      console.error('❌ Error updating store with asset time series:', error);
    }
  };

  // SIP projection function (same as UnifiedChart)
  const calculateSIPProjection = ({ initial, sipAmount, sipFrequency, annualRate, years, sipExpiryDate }) => {
    if (sipAmount <= 0 || !sipFrequency) {
      // No SIP, just return initial value with compound growth
      return initial * Math.pow(1 + annualRate, years);
    }

    // Convert SIP frequency to monthly contributions
    let monthlySIP = 0;
    switch (sipFrequency) {
      case 'Weekly':
        monthlySIP = sipAmount * 4.33; // ~4.33 weeks per month
        break;
      case 'Bi-weekly':
        monthlySIP = sipAmount * 2.17; // ~2.17 bi-weeks per month
        break;
      case 'Monthly':
        monthlySIP = sipAmount;
        break;
      case 'Bi-monthly':
        monthlySIP = sipAmount * 2;
        break;
      case 'Quarterly':
        monthlySIP = sipAmount / 3;
        break;
      case 'Semi-annual':
        monthlySIP = sipAmount / 6;
        break;
      case 'Annual':
        monthlySIP = sipAmount / 12;
        break;
      case 'Lumpsum':
        monthlySIP = 0; // One-time only
        break;
      default:
        monthlySIP = 0;
    }

    // Calculate SIP months (how long SIP runs)
    let sipMonths = years * 12; // Default: SIP runs for all years
    if (sipExpiryDate) {
      const expiryYear = new Date(sipExpiryDate).getFullYear();
      const currentYear = new Date().getFullYear();
      const maxSipYears = Math.max(0, expiryYear - currentYear);
      sipMonths = Math.min(years * 12, maxSipYears * 12);
    }

    const monthlyRate = annualRate / 12;
    const totalMonths = years * 12;

    // Lump sum part (grows throughout the entire period)
    const lumpValue = initial * Math.pow(1 + monthlyRate, totalMonths);

    // SIP part (accumulate up to SIP expiry, then let it compound)
    let sipValue = 0;
    if (monthlySIP > 0 && sipMonths > 0) {
      // Calculate SIP accumulated up to expiry
      const sipAccumulated = monthlySIP * ((Math.pow(1 + monthlyRate, sipMonths) - 1) / monthlyRate);
      
      // After SIP stops, let the accumulated SIP pot continue compounding
      const remainingMonths = totalMonths - sipMonths;
      sipValue = sipAccumulated * Math.pow(1 + monthlyRate, remainingMonths);
    }

    return lumpValue + sipValue;
  };

  const handleCellSave = async (assetId, field, value = null) => {
    if (editingCell && editingCell.assetId === assetId && editingCell.field === field) {
      try {
        setLoading(true)
        
        // Use provided value or tempValue
        const saveValue = value !== null ? value : tempValue
        
        // Determine if it's a core field or custom data field
        let updateData = {}
        if (['name', 'tag', 'current_value'].includes(field)) {
          updateData[field] = saveValue
          if (field === 'tag') {
            console.log('🏷️ Tag update data:', { field, saveValue, updateData })
          }
        } else {
          // Update custom_data
          const asset = assets.find(a => a.id === assetId)
          const customData = (asset && asset.custom_data) || {}
          updateData.custom_data = {
            ...customData,
            [field]: saveValue
          }
        }
        
        console.log('💾 Saving asset field:', { assetId, field, updateData })
        
        
        const updatePromise = isAdminMode
          ? ApiService.updateFinancialAssetForUser(assetId, updateData, effectiveUserId)
          : ApiService.updateFinancialAsset(assetId, updateData)
        const response = await updatePromise
        
        if (response.asset) {
          const updatedAssets = assets.map(asset => 
            asset.id === assetId ? response.asset : asset
          )
          setAssets(updatedAssets)
          console.log('✅ Asset updated successfully')
          
          // Emit event to notify chart of asset update (legacy)
          eventBus.emit('assetUpdated', {
            assetId,
            field,
            value: saveValue,
            updatedAsset: response.asset,
            allAssets: updatedAssets
          })
          
          // Dispatch event for live chart updates (following WorkAssetsPage pattern)
          dispatchAssetsEvent(updatedAssets)
        }
        
        setEditingCell(null)
        setTempValue('')
      } catch (error) {
        console.error('❌ Asset update error:', error)
        setError('Failed to update asset')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleCellCancel = () => {
    setEditingCell(null)
    setTempValue('')
  }

  // Tab navigation to move to next cell
  const handleTabNavigation = (e, currentAssetId, currentField) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      
      console.log('🔍 Tab pressed on field:', currentField)
      console.log('🔍 Current tempValue:', tempValue)
      console.log('🔍 Current editingCell:', editingCell)
      
      // First save the current cell if we're in edit mode
      if (editingCell && editingCell.assetId === currentAssetId && editingCell.field === currentField) {
        console.log('🔍 Calling handleCellSave...')
        handleCellSave(currentAssetId, currentField)
      } else {
        console.log('🔍 Not in edit mode, skipping save')
      }
      
      // Then move to next cell after a small delay to ensure save completes
      setTimeout(() => {
        // Define the actual table column order (including basic fields)
        const visibleColumns = getVisibleColumns()
        console.log('🔍 Visible columns from getVisibleColumns():', visibleColumns)
        // Skip sipFrequency due to dropdown issues, go directly from sipAmount to sipExpiryDate
        const customColumns = visibleColumns.map(col => col.key).filter(key => key !== 'sipFrequency')
        const tableColumnOrder = ['name', 'current_value', ...customColumns]
        console.log('🔍 Table column order:', tableColumnOrder)
        console.log('🔍 Table column order length:', tableColumnOrder.length)
        
        const currentFieldIndex = tableColumnOrder.findIndex(field => field === currentField)
        console.log('🔍 Current field index:', currentFieldIndex, 'for field:', currentField)
        
        if (currentFieldIndex !== -1) {
          // If not at the last column, move to next column
          if (currentFieldIndex < tableColumnOrder.length - 1) {
            const nextField = tableColumnOrder[currentFieldIndex + 1]
            console.log('🔍 Moving to next field:', nextField)
            const currentAsset = assets.find(asset => asset.id === currentAssetId)
            if (currentAsset) {
              // Get value from custom_data for custom columns, or directly for basic fields
              let nextValue = ''
              if (['name', 'current_value'].includes(nextField)) {
                nextValue = currentAsset[nextField] || ''
              } else {
                nextValue = currentAsset.custom_data?.[nextField] || ''
              }
              console.log('🔍 Next value for', nextField, ':', nextValue)
              handleCellEdit(currentAssetId, nextField, nextValue)
              
              // Ensure focus after state update
              setTimeout(() => {
                const nextInput = document.querySelector(`input[data-asset-id="${currentAssetId}"][data-field="${nextField}"]`)
                if (nextInput) {
                  nextInput.focus()
                  nextInput.select()
                }
              }, 50)
            }
          } else {
            console.log('🔍 At last column, moving to next row')
            // If at last column, move to first column of next row
            const currentAssetIndex = assets.findIndex(asset => asset.id === currentAssetId)
            if (currentAssetIndex < assets.length - 1) {
              const nextAsset = assets[currentAssetIndex + 1]
              const firstField = tableColumnOrder[0]
              // Get value from custom_data for custom columns, or directly for basic fields
              let nextValue = ''
              if (['name', 'current_value'].includes(firstField)) {
                nextValue = nextAsset[firstField] || ''
              } else {
                nextValue = nextAsset.custom_data?.[firstField] || ''
              }
              console.log('🔍 Moving to next row, first field:', firstField, 'value:', nextValue)
              handleCellEdit(nextAsset.id, firstField, nextValue)
            }
          }
        }
      }, 50) // Small delay to ensure save completes
    }
  }

  const handleAddColumn = async () => {
    console.log('🔧 handleAddColumn called:', { newColumnName, newColumnType, customColumnsLength: customColumns.length })
    
    if (newColumnName.trim()) {
      try {
        setLoading(true)
        const columnKey = newColumnName.toLowerCase().replace(/\s+/g, '')
        
        console.log('📡 Creating column with data:', {
          column_key: columnKey,
          column_label: newColumnName.trim(),
          column_type: newColumnType,
          column_order: customColumns.length
        })
        
        const response = await ApiService.createAssetColumn({
          column_key: columnKey,
          column_label: newColumnName.trim(),
          column_type: newColumnType,
          column_order: customColumns.length
        })
        
        console.log('📡 API response:', response)
        
        if (response.column) {
          const newColumn = {
            id: response.column.id,
            key: response.column.column_key,
            label: response.column.column_label,
            type: response.column.column_type
          }
          setCustomColumns([...customColumns, newColumn])
          console.log('✅ Column created successfully:', newColumn)
          console.log('📊 Updated customColumns:', [...customColumns, newColumn])
        } else {
          console.error('❌ No column returned from API')
          setError('Failed to create column - no response')
        }
        
        setNewColumnName('')
        setEditingColumn(null)
      } catch (error) {
        console.error('❌ Column creation error:', error)
        setError('Failed to create column: ' + (error.message || 'Unknown error'))
      } finally {
        setLoading(false)
      }
    } else {
      console.log('❌ Column name is empty')
      setError('Please enter a column name')
    }
  }

  const handleDeleteColumn = async (columnKey) => {
    // Prevent deletion of core columns
    if (CORE_COLUMNS.includes(columnKey)) {
      setError('Cannot delete core columns (SIP Amount, SIP Frequency, SIP Expiry Date, Expected Return %, Notes, Goal Earmarks)')
      return
    }

    try {
      const column = customColumns.find(col => col.key === columnKey)
      if (column && column.id) {
        setLoading(true)
        await ApiService.deleteAssetColumn(column.id)
        setCustomColumns(customColumns.filter(col => col.key !== columnKey))
        console.log('✅ Column deleted successfully:', columnKey)
      } else {
        // Fallback for columns without ID (default columns)
        setCustomColumns(customColumns.filter(col => col.key !== columnKey))
      }
    } catch (error) {
      console.error('❌ Column deletion error:', error)
      setError('Failed to delete column')
    } finally {
      setLoading(false)
    }
  }

  const handleRenameColumn = (columnKey, newLabel) => {
    setCustomColumns(customColumns.map(col => 
      col.key === columnKey ? { ...col, label: newLabel } : col
    ))
  }

  const handleDragStart = (e, columnKey) => {
    console.log('🔄 Drag started for column:', columnKey)
    setDraggedColumn(columnKey)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', e.target.outerHTML)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e, targetColumnKey) => {
    e.preventDefault()
    console.log('🎯 Drop event:', { draggedColumn, targetColumnKey })
    
    if (!draggedColumn || draggedColumn === targetColumnKey) {
      console.log('❌ Invalid drop: same column or no dragged column')
      setDraggedColumn(null)
      return
    }

    try {
      setIsReordering(true)
      
      // Get current column order
      const currentColumns = [...customColumns]
      const draggedIndex = currentColumns.findIndex(col => col.key === draggedColumn)
      const targetIndex = currentColumns.findIndex(col => col.key === targetColumnKey)
      
      if (draggedIndex === -1 || targetIndex === -1) return

      // Reorder columns
      const reorderedColumns = [...currentColumns]
      const [draggedCol] = reorderedColumns.splice(draggedIndex, 1)
      reorderedColumns.splice(targetIndex, 0, draggedCol)

      // Update column_order for each column
      const updatedColumns = reorderedColumns.map((col, index) => ({
        ...col,
        column_order: index
      }))

      // Update local state immediately for UI responsiveness
      setCustomColumns(updatedColumns)

      // Update database
      for (const column of updatedColumns) {
        if (column.id) {
          await ApiService.updateAssetColumn(column.id, {
            column_order: column.column_order
          })
        }
      }

      console.log('✅ Column order updated successfully')
    } catch (error) {
      console.error('❌ Error updating column order:', error)
      setError('Failed to update column order')
      // Revert local state on error
      loadCustomColumns()
    } finally {
      setIsReordering(false)
      setDraggedColumn(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedColumn(null)
  }

  const handleSort = (key) => {
    let direction = 'asc'
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc'
    }
    setSortConfig({ key, direction })
  }

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) {
      return <span className="text-gray-400 dark:text-slate-500">↕️</span>
    }
    return sortConfig.direction === 'asc' ? <span className="text-blue-500">↑</span> : <span className="text-blue-500">↓</span>
  }

  const handleAddTag = async () => {
    if (newTag.trim() && !availableTags.includes(newTag.trim())) {
      try {
        setLoadingTags(true)
        const response = await ApiService.createUserTag({
          tag_name: newTag.trim(),
          tag_order: availableTags.length
        })
        
        console.log('✅ Tag created:', response.tag)
        setAvailableTags([...availableTags, newTag.trim()])
        setNewTag('')
      } catch (error) {
        console.error('❌ Error creating tag:', error)
        setError('Failed to create tag: ' + (error.message || 'Unknown error'))
      } finally {
        setLoadingTags(false)
      }
    }
  }

  const handleRemoveTag = async (tagToRemove) => {
    if (availableTags.length > 1) { // Keep at least one tag
      try {
        setLoadingTags(true)
        
        // Find the tag ID from the database
        const response = isAdminMode
        ? await ApiService.getUserTagsForUser(effectiveUserId)
        : await ApiService.getUserTags(effectiveUserId)
        const tagToDelete = response.tags.find(tag => tag.tag_name === tagToRemove)
        
        if (tagToDelete) {
          await ApiService.deleteUserTag(tagToDelete.id)
          console.log('✅ Tag deleted:', tagToRemove)
          setAvailableTags(availableTags.filter(tag => tag !== tagToRemove))
        }
      } catch (error) {
        console.error('❌ Error deleting tag:', error)
        setError('Failed to delete tag: ' + (error.message || 'Unknown error'))
      } finally {
        setLoadingTags(false)
      }
    }
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  const handleRefresh = async () => {
    if (isLoading) return
    
    setIsLoading(true)
    setHasLoaded(false)
    try {
      await Promise.all([
        loadAssets(),
        loadCustomColumns(),
        loadUserTags(),
        loadGoals()
      ])
      setHasLoaded(true)
    } catch (error) {
      console.error('Error refreshing data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleEarmarkingChange = async (assetId, earmarks) => {
    console.log('💾 handleEarmarkingChange called:', { assetId, earmarks, assetsLength: assets.length })
    
    try {
      setLoading(true)
      
      const asset = assets.find(a => a.id === assetId)
      console.log('🔍 Found asset:', asset)
      
      if (!asset) {
        console.error('❌ Asset not found:', assetId)
        setError('Asset not found')
        return
      }
      
      const customData = (asset && asset.custom_data) || {}
      console.log('🔍 Current custom_data:', customData)
      
      // Handle cross-table deletion: Remove goals that are no longer earmarked
      console.log('🗑️ Checking for goals to remove from linked assets...');
      const currentEarmarkedGoalIds = earmarks.map(e => e.goalId);
      const previousEarmarkedGoalIds = (customData.goalEarmarks || []).map(e => e.goalId);
      const removedGoalIds = previousEarmarkedGoalIds.filter(id => !currentEarmarkedGoalIds.includes(id));
      
      console.log('🗑️ Removed goal IDs:', removedGoalIds);
      
      // For each removed goal, remove this asset from its linked assets
      for (const removedGoalId of removedGoalIds) {
        const goal = goals.find(g => g.id === removedGoalId);
        if (goal) {
          console.log('🗑️ Removing asset from goal linked assets:', { goalId: removedGoalId, goalName: goal.description, assetId: assetId });
          
          // Update goal's custom_data to remove this asset from linked assets
          const updatedGoalLinkedAssets = (goal.custom_data?.linkedAssets || []).filter(
            linkedAsset => linkedAsset.assetId !== assetId
          );
          
          const updatedGoalCustomData = {
            ...goal.custom_data,
            linkedAssets: updatedGoalLinkedAssets
          };
          
          ApiService.updateFinancialGoal(removedGoalId, {
            custom_data: updatedGoalCustomData
          }).then(response => {
            console.log('🗑️ Goal linked assets updated after asset removal:', response);
          }).catch(error => {
            console.error('❌ Error updating goal linked assets after asset removal:', error);
          });
        }
      }

      // Handle cross-table sync: Update goals with new earmarking data
      console.log('🔄 Syncing earmarking changes to goals...');
      console.log('🔄 Available goals for sync:', goals.length, goals);
      
      if (goals.length === 0) {
        console.log('⚠️ No goals available for cross-sync, skipping...');
        return;
      }
      
      for (const earmark of earmarks) {
        const goal = goals.find(g => g.id === earmark.goalId);
        if (goal) {
          console.log('🔄 Updating goal linked assets for earmark:', { goalId: earmark.goalId, goalName: goal.description, assetId: assetId, percentage: earmark.percent });
          
          // Get current linked assets for this goal
          const currentLinkedAssets = goal.custom_data?.linkedAssets || [];
          
          // Check if this asset is already linked to this goal
          const existingLinkedAssetIndex = currentLinkedAssets.findIndex(la => la.assetId === assetId);
          
          let updatedLinkedAssets;
          if (existingLinkedAssetIndex >= 0) {
            // Update existing linked asset
            updatedLinkedAssets = [...currentLinkedAssets];
            updatedLinkedAssets[existingLinkedAssetIndex] = {
              assetId: assetId,
              assetName: asset.name,
              percent: earmark.percent,
              goalId: earmark.goalId,
              goalName: earmark.goalName
            };
          } else {
            // Add new linked asset
            updatedLinkedAssets = [...currentLinkedAssets, {
              assetId: assetId,
              assetName: asset.name,
              percent: earmark.percent,
              goalId: earmark.goalId,
              goalName: earmark.goalName
            }];
          }
          
          const updatedGoalCustomData = {
            ...goal.custom_data,
            linkedAssets: updatedLinkedAssets
          };
          
          ApiService.updateFinancialGoal(earmark.goalId, {
            custom_data: updatedGoalCustomData
          }).then(response => {
            console.log('🔄 Goal linked assets updated after earmark sync:', response);
          }).catch(error => {
            console.error('❌ Error updating goal linked assets after earmark sync:', error);
          });
        }
      }
      
      const updateData = {
        custom_data: {
          ...customData,
          goalEarmarks: earmarks
        }
      }
      
      console.log('💾 Saving earmarking data:', { assetId, updateData })
      
      const response = await ApiService.updateFinancialAsset(assetId, updateData)
      console.log('📡 API response:', response)
      
      if (response.asset) {
        const updatedAssets = assets.map(asset => 
          asset.id === assetId ? response.asset : asset
        )
        console.log('🔄 Updating assets state:', { 
          assetId, 
          oldAsset: assets.find(a => a.id === assetId),
          newAsset: response.asset,
          updatedAssets: updatedAssets.length
        })
        setAssets(updatedAssets)
        console.log('✅ Earmarking updated successfully, new assets:', updatedAssets.length)
        
        // Force re-render to ensure UI updates
        setRefreshKey(prev => prev + 1)
        
        // Emit event to notify chart of earmarking update
        eventBus.emit('assetUpdated', {
          action: 'earmark',
          assetId,
          field: 'goalEarmarks',
          value: earmarks,
          updatedAsset: response.asset,
          allAssets: updatedAssets
        })
        
        // Emit event to notify goals page of earmarking changes
        eventBus.emit('assetEarmarkingChanged', {
          assetId,
          assetName: response.asset.name,
          goalEarmarks: earmarks,
          allAssets: updatedAssets
        })
      } else {
        console.error('❌ No asset returned from API')
        setError('Failed to update earmarking - no response')
      }
      
    } catch (error) {
      console.error('❌ Earmarking update error:', error)
      setError('Failed to update earmarking: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleExportCSV = async () => {
    try {
      setExporting(true)
      
      // Prepare CSV headers
      const headers = [
        'Name',
        'Tag', 
        'Current Value',
        ...visibleColumns.map(col => col.label)
      ]

      // Prepare CSV data
      const csvData = sortedAssets.map(asset => {
        const customData = asset.custom_data || {}
        const row = [
          asset.name || '',
          asset.tag || '',
          asset.current_value || 0,
          ...visibleColumns.map(col => customData[col.key] || '')
        ]
        return row
      })

      // Convert to CSV format
      const csvContent = [
        headers.join(','),
        ...csvData.map(row => 
          row.map(cell => {
            // Escape commas and quotes in cell values
            const escaped = String(cell).replace(/"/g, '""')
            return `"${escaped}"`
          }).join(',')
        )
      ].join('\n')

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', `assets-${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      console.log('✅ CSV exported successfully')
    } catch (error) {
      console.error('❌ CSV export error:', error)
      setError('Failed to export CSV: ' + (error.message || 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (amount) => {
    const numAmount = typeof amount === 'number' ? amount : parseFloat(amount) || 0
    if (numAmount >= 10000000) {
      return `₹${(numAmount / 10000000).toFixed(2)}Cr`
    } else if (numAmount >= 100000) {
      return `₹${(numAmount / 100000).toFixed(1)}L`
    } else if (numAmount >= 1000) {
      return `₹${(numAmount / 1000).toFixed(1)}K`
    }
    return `₹${numAmount.toFixed(0)}`
  }

  const getTagColor = (tag) => {
    switch (tag) {
      case 'Investment': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
      case 'Personal': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
      case 'Emergency': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
      case 'Retirement': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
      default: return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-slate-200'
    }
  }

  const getInputType = (columnType) => {
    switch (columnType) {
      case 'number': return 'number'
      case 'currency': return 'number'
      case 'date': return 'date'
      case 'email': return 'email'
      case 'url': return 'url'
      default: return 'text'
    }
  }

  const formatCellValue = (value, columnType) => {
    if (!value || value.toString().trim() === '') return ''
    
    switch (columnType) {
      case 'currency':
        return formatCurrency(parseFloat(value) || 0)
      case 'date':
        return new Date(value).toLocaleDateString()
      case 'email':
        return value
      case 'url':
        return value
      case 'number':
        return parseFloat(value) || 0
      default:
        return value
    }
  }

  // Use all assets for summary calculations (not filtered or sorted)
  const totalValue = assets.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0)

  // Get totalAssetGrossMarketValue from financial profile (FP calculator value)
  const [fpCalculatorAssets, setFpCalculatorAssets] = useState(0)
  
  useEffect(() => {
    const loadFpCalculatorAssets = async () => {
      if (effectiveIsAuthenticated && effectiveUserId) {
        try {
          const response = isAdminMode
            ? await ApiService.getFinancialProfileForUser(effectiveUserId)
            : await ApiService.getFinancialProfile(effectiveUserId)
          if (response && response.profile) {
            const fpValue = parseFloat(response.profile.total_asset_gross_market_value) || 0
            setFpCalculatorAssets(fpValue)
          }
        } catch (error) {
          console.error('❌ Error loading financial profile:', error)
        }
      }
    }
    loadFpCalculatorAssets()
  }, [effectiveIsAuthenticated, effectiveUserId, isAdminMode])

  // Calculate unassigned assets = FP calculator value - sum of detailed assets
  // Floor to zero (don't show negative)
  const unassignedAssets = Math.max(0, fpCalculatorAssets - totalValue)

  // Update store when assets or fpCalculatorAssets change
  useEffect(() => {
    if (hasLoaded && assets.length >= 0) {
      updateStoreWithAssetTimeSeries(assets);
    }
  }, [assets, fpCalculatorAssets, hasLoaded])
  const investmentAssets = assets.filter(asset => asset.tag === 'Investment')
  const personalAssets = assets.filter(asset => asset.tag === 'Personal')
  const investmentValue = investmentAssets.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0)
  const personalValue = personalAssets.reduce((sum, asset) => sum + (parseFloat(asset.current_value) || 0), 0)

  // Debug logging
  console.log('🔍 Asset calculations:', {
    totalAssets: assets.length,
    filteredAssets: filteredAssets.length,
    sortedAssets: sortedAssets.length,
    sortConfig,
    totalValue,
    investmentValue,
    personalValue,
    allAssetValues: assets.map(a => ({ name: a.name, tag: a.tag, value: a.current_value })),
    investmentAssets: investmentAssets.map(a => ({ name: a.name, value: a.current_value })),
    personalAssets: personalAssets.map(a => ({ name: a.name, value: a.current_value }))
  })

  return (
    <div className="w-full space-y-6">
      {/* Summary Cards */}
      <div className="lifemap-stat-grid">
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Investment Assets</p>
          <div className="lifemap-stat-value text-emerald-600">
            {formatCurrency(investmentValue)}
          </div>
          <p className="text-xs text-slate-500">{investmentAssets.length} assets</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Personal Assets</p>
          <div className="lifemap-stat-value text-blue-600">
            {formatCurrency(personalValue)}
          </div>
          <p className="text-xs text-slate-500">{personalAssets.length} assets</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Unassigned Assets</p>
          <div className="lifemap-stat-value text-orange-600">
            {formatCurrency(unassignedAssets)}
          </div>
          <p className="text-xs text-slate-500">From FP Calculator</p>
        </div>
        <div className="lifemap-stat-card">
          <p className="lifemap-stat-title">Total Assets</p>
          <div className="lifemap-stat-value text-purple-600">
            {formatCurrency(totalValue + unassignedAssets)}
          </div>
          <p className="text-xs text-slate-500">{assets.length} detailed + unassigned</p>
        </div>
      </div>

      {/* Asset Register */}
      <Card className="lifemap-panel">
        <CardHeader className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex flex-col items-stretch">
          <div className="space-y-4 w-full">
            {/* Row 1: Title + Filters */}
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="lifemap-panel-title">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600">
                  <PiggyBank className="h-4 w-4" />
                </span>
                Asset Register
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-slate-500 h-4 w-4" />
                  <Input
                    placeholder="Search by keyword"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-64"
                  />
                </div>
                <Select value={filterTag} onValueChange={setFilterTag}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Tags</SelectItem>
                    {availableTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Action Buttons */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Button onClick={handleAddAsset} className="bg-green-600 hover:bg-green-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Row
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setEditingColumn('new')}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Column
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={handleRefresh} disabled={isLoading} className="text-red-500 dark:text-red-400">
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Reset
                </Button>
                <Button variant="outline" onClick={handleExportCSV} disabled={exporting}>
                  <Download className="h-4 w-4 mr-2" />
                  {exporting ? 'Exporting...' : 'Export CSV'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setShowAllColumns(!showAllColumns)}
                  className={showAllColumns ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400' : ''}
                  title={showAllColumns ? 'Hide empty columns' : 'Show all columns including empty ones'}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  {showAllColumns ? 'Hide Empty' : `Show All (${customColumns.length})`}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                <p className="text-sm text-gray-500 dark:text-slate-400">Loading assets...</p>
              </div>
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-slate-400">
              <div className="text-4xl mb-4">📊</div>
              <p className="text-lg font-medium">No assets found</p>
              <p className="text-sm">Add your first asset to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-lg relative">
              <div className="min-w-max space-y-2">
              {/* Table Header */}
              <div className="grid gap-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg font-medium text-sm text-gray-600 dark:text-slate-300" 
                   style={{ gridTemplateColumns: `250px 140px 140px ${visibleColumns.map(() => '140px').join(' ')} 80px` }}>
                <div 
                  className="flex items-center gap-1 cursor-pointer hover:text-gray-800 dark:hover:text-slate-200 select-none text-slate-700 dark:text-slate-300"
                  onClick={() => handleSort('name')}
                >
                  Name {getSortIcon('name')}
                </div>
                <div 
                  className="flex items-center justify-between group cursor-pointer hover:text-gray-800 select-none"
                  onClick={() => handleSort('tag')}
                >
                  <div className="flex items-center gap-1">
                    Tag {getSortIcon('tag')}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowTagModal(true)
                    }}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </Button>
                </div>
                <div 
                  className="flex items-center gap-1 cursor-pointer hover:text-gray-800 dark:hover:text-slate-200 select-none text-slate-700 dark:text-slate-300"
                  onClick={() => handleSort('current_value')}
                >
                  Current Value {getSortIcon('current_value')}
                </div>
                {visibleColumns.map((column) => (
                  <div 
                    key={column.key} 
                    className={`flex items-center justify-between group ${!CORE_COLUMNS.includes(column.key) ? 'cursor-move' : ''}`}
                    draggable={!CORE_COLUMNS.includes(column.key)}
                    onDragStart={(e) => handleDragStart(e, column.key)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, column.key)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="flex items-center gap-1 flex-1">
                      {/* Drag handle for non-core columns */}
                      {!CORE_COLUMNS.includes(column.key) && (
                        <div 
                          className="cursor-move opacity-0 group-hover:opacity-100 mr-1"
                          title="Drag to reorder column"
                        >
                          <GripVertical className="h-3 w-3 text-gray-400 dark:text-slate-500" />
                        </div>
                      )}
                      <div 
                        className="flex items-center gap-1 cursor-pointer hover:text-gray-800 select-none flex-1"
                        onClick={() => handleSort(column.key)}
                      >
                        <span>{column.label}</span>
                        {getSortIcon(column.key)}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setEditingColumn(column.key)}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                      {/* Only show delete button for non-core columns */}
                      {!CORE_COLUMNS.includes(column.key) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteColumn(column.key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                <div>Actions</div>
              </div>

              {/* Table Rows */}
              {sortedAssets.map((asset, index) => {
                const customData = asset.custom_data || {}
                return (
                <div key={asset.id || index} className="grid gap-4 p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors bg-white dark:bg-gray-800" 
                     style={{ gridTemplateColumns: `250px 140px 140px ${visibleColumns.map(() => '140px').join(' ')} 80px` }}>
                  
                  {/* Fixed Column 1: Name */}
                  <div>
                    {(editingCell && editingCell.assetId === asset.id && editingCell.field === 'name') ? (
                      <Input
                        value={tempValue}
                        onChange={(e) => setTempValue(e.target.value)}
                        onBlur={() => handleCellSave(asset.id, 'name')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCellSave(asset.id, 'name')
                          if (e.key === 'Escape') handleCellCancel()
                          handleTabNavigation(e, asset.id, 'name')
                        }}
                        className="h-8"
                        autoFocus
                        data-asset-id={asset.id}
                        data-field="name"
                        placeholder="Enter asset name"
                      />
                    ) : (
                      <div
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded font-medium text-slate-900 dark:text-slate-100"
                        onClick={() => handleCellEdit(asset.id, 'name', asset.name || '')}
                      >
                        {asset.name || (
                          <span className="text-gray-400 dark:text-slate-500 text-sm italic">Click to edit</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Fixed Column 2: Tag */}
                  <div>
                    {(editingCell && editingCell.assetId === asset.id && editingCell.field === 'tag') ? (
                      <Select 
                        value={tempValue} 
                        onValueChange={(value) => {
                          console.log('🏷️ Tag changed to:', value)
                          setTempValue(value)
                          // Auto-save when tag is selected, pass value directly
                          setTimeout(() => {
                            console.log('🏷️ Saving tag:', value, 'for asset:', asset.id)
                            handleCellSave(asset.id, 'tag', value)
                          }, 100)
                        }}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {availableTags.map((tag) => (
                            <SelectItem key={tag} value={tag}>
                              {tag}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div
                        className="cursor-pointer hover:bg-gray-100 p-1 rounded"
                        onClick={() => handleCellEdit(asset.id, 'tag', asset.tag || '')}
                      >
                        <Badge className={`${getTagColor(asset.tag)}`}>
                          {asset.tag || 'Click to edit'}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Fixed Column 3: Current Value */}
                  <div>
                    {(editingCell && editingCell.assetId === asset.id && editingCell.field === 'current_value') ? (
                      <Input
                        type="number"
                        value={tempValue}
                        onChange={(e) => setTempValue(e.target.value)}
                        onBlur={() => handleCellSave(asset.id, 'current_value')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCellSave(asset.id, 'current_value')
                          if (e.key === 'Escape') handleCellCancel()
                          handleTabNavigation(e, asset.id, 'current_value')
                        }}
                        className="h-8"
                        autoFocus
                        data-asset-id={asset.id}
                        data-field="current_value"
                      />
                    ) : (
                      <div
                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded font-medium text-slate-900 dark:text-slate-100"
                        onClick={() => handleCellEdit(asset.id, 'current_value', asset.current_value || 0)}
                      >
                        {formatCurrency(asset.current_value || 0)}
                      </div>
                    )}
                  </div>

                  {/* Dynamic Custom Columns */}
                  {visibleColumns.map((column) => (
                    <div key={column.key}>
                      {column.key === 'goalEarmarks' ? (
                        <EarmarkingInput
                          key={`${asset.id}-earmarking-${refreshKey}`}
                          value={customData.goalEarmarks || []}
                          onChange={(earmarks) => {
                            console.log('🎯 EarmarkingInput onChange called:', { assetId: asset.id, earmarks, goals })
                            handleEarmarkingChange(asset.id, earmarks)
                          }}
                          availableGoals={goals}
                          maxAllocation={100}
                          className="min-h-[40px]"
                        />
                      ) : column.key === 'sipFrequency' ? (
                        editingCell && editingCell.assetId === asset.id && editingCell.field === column.key ? (
                          <Select 
                            value={tempValue} 
                            onValueChange={(value) => {
                              console.log('📅 SIP Frequency changed to:', value)
                              setTempValue(value)
                              // Auto-save when frequency is selected
                              setTimeout(() => {
                                console.log('📅 Saving SIP frequency:', value, 'for asset:', asset.id)
                                handleCellSave(asset.id, column.key, value)
                              }, 100)
                            }}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select frequency" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Monthly">Monthly</SelectItem>
                              <SelectItem value="Bi-monthly">Bi-monthly</SelectItem>
                              <SelectItem value="Weekly">Weekly</SelectItem>
                              <SelectItem value="Bi-weekly">Bi-weekly</SelectItem>
                              <SelectItem value="Quarterly">Quarterly</SelectItem>
                              <SelectItem value="Semi-annual">Semi-annual</SelectItem>
                              <SelectItem value="Annual">Annual</SelectItem>
                              <SelectItem value="Lumpsum">Lumpsum</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-gray-100 p-1 rounded min-h-[24px] flex items-center"
                            onClick={() => handleCellEdit(asset.id, column.key, customData[column.key] || '')}
                          >
                            {formatCellValue(customData[column.key], column.type) || (
                              <span className="text-gray-400 dark:text-slate-500 text-sm italic">Click to edit</span>
                            )}
                          </div>
                        )
                      ) : column.key === 'sipExpiryDate' ? (
                        editingCell && editingCell.assetId === asset.id && editingCell.field === column.key ? (
                          <Input
                            type="date"
                            value={tempValue}
                            onChange={(e) => setTempValue(e.target.value)}
                            onBlur={() => handleCellSave(asset.id, column.key)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleCellSave(asset.id, column.key)
                              if (e.key === 'Escape') handleCellCancel()
                              handleTabNavigation(e, asset.id, column.key)
                            }}
                            className="h-8"
                            autoFocus
                            data-asset-id={asset.id}
                            data-field={column.key}
                          />
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-gray-100 p-1 rounded min-h-[24px] flex items-center"
                            onClick={() => handleCellEdit(asset.id, column.key, customData[column.key] || '')}
                          >
                            {formatCellValue(customData[column.key], column.type) || (
                              <span className="text-gray-400 dark:text-slate-500 text-sm italic">Click to edit</span>
                            )}
                          </div>
                        )
                      ) : (editingCell && editingCell.assetId === asset.id && editingCell.field === column.key) ? (
                        <Input
                          type={getInputType(column.type)}
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          onBlur={() => handleCellSave(asset.id, column.key)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCellSave(asset.id, column.key)
                            if (e.key === 'Escape') handleCellCancel()
                            handleTabNavigation(e, asset.id, column.key)
                          }}
                          className="h-8"
                          autoFocus
                          data-asset-id={asset.id}
                          data-field={column.key}
                        />
                      ) : (
                        <div
                          className="cursor-pointer hover:bg-gray-100 p-1 rounded min-h-[24px] flex items-center"
                          onClick={() => handleCellEdit(asset.id, column.key, customData[column.key] || '')}
                        >
                          {formatCellValue(customData[column.key], column.type) || (
                            <span className="text-gray-400 dark:text-slate-500 text-sm italic">Click to edit</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Fixed Column 4: Actions */}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteAsset(asset.id)}
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                )
              })}

              {/* Add New Row - Empty Row */}
              <div 
                className="grid gap-4 p-3 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer group bg-white dark:bg-gray-800" 
                style={{ gridTemplateColumns: `250px 140px 140px ${visibleColumns.map(() => '140px').join(' ')} 80px` }}
                onClick={handleAddAsset}
              >
                {/* Fixed Column 1: Name */}
                <div className="flex items-center text-gray-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  <Plus className="h-4 w-4 mr-2" />
                  <span className="text-sm">Click to add new asset</span>
                </div>

                {/* Fixed Column 2: Tag */}
                <div className="flex items-center text-gray-400 dark:text-slate-500">
                  <span className="text-sm">-</span>
                </div>

                {/* Fixed Column 3: Current Value */}
                <div className="flex items-center text-gray-400 dark:text-slate-500">
                  <span className="text-sm">-</span>
                </div>

                {/* Custom Columns */}
                {visibleColumns.map((column) => (
                  <div key={column.key} className="flex items-center text-gray-400">
                    <span className="text-sm">-</span>
                  </div>
                ))}

                {/* Fixed Column 4: Actions */}
                <div className="flex items-center text-gray-400 dark:text-slate-500">
                  <span className="text-sm">-</span>
                </div>
              </div>
              </div>
              
              {/* Scroll indicator */}
              {visibleColumns.length > 5 && (
                <div className="absolute bottom-2 right-2 bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full shadow-sm">
                  ← Scroll to see more columns
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{filteredAssets.length} rows</span>
            <div className="flex items-center gap-2">
              <span>Total Value: {formatCurrency(totalValue)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Column Modal */}
      <Dialog open={editingColumn === 'new'} onOpenChange={(open) => {
        if (!open) {
          setEditingColumn(null)
          setNewColumnName('')
          setNewColumnType('text')
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Column</DialogTitle>
            <DialogDescription>
              Create a new custom column for your asset register
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Column Name
              </label>
              <Input
                placeholder="Column name (e.g., 'Purchase Date')"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddColumn()
                  if (e.key === 'Escape') setEditingColumn(null)
                }}
                autoFocus
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Data Type
              </label>
              <Select value={newColumnType} onValueChange={setNewColumnType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="currency">Currency</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Choose the data type for proper sorting and validation
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setEditingColumn(null)
                setNewColumnName('')
                setNewColumnType('text')
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddColumn} disabled={!newColumnName.trim()}>
              Add Column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error Message */}
      {error && (
        <div className="fixed top-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50 max-w-md">
          <div className="flex items-center justify-between">
            <span className="text-sm">{error}</span>
            <button 
              onClick={() => setError(null)}
              className="ml-4 text-red-500 hover:text-red-700 text-lg font-bold"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Tag Management Modal */}
      {showTagModal && (
        <Dialog open={showTagModal} onOpenChange={setShowTagModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Tags</DialogTitle>
              <DialogDescription>
                Add or remove tag options for your assets
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Current Tags */}
              <div>
                <h4 className="text-sm font-medium mb-2">Current Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((tag) => (
                    <div
                      key={tag}
                      className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-sm"
                    >
                      <span>{tag}</span>
                      {availableTags.length > 1 && (
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="text-blue-600 hover:text-blue-800 disabled:opacity-50"
                          disabled={loadingTags}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add New Tag */}
              <div>
                <h4 className="text-sm font-medium mb-2">Add New Tag</h4>
                <div className="flex gap-2">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Enter tag name"
                    className="flex-1"
                    disabled={loadingTags}
                  />
                  <Button 
                    onClick={handleAddTag} 
                    disabled={!newTag.trim() || loadingTags}
                  >
                    {loadingTags ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTagModal(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

export default NotionStyleAssetRegister
