import express from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { CORE_COLUMN_DEFINITIONS } from '../constants/columns.js';

const router = express.Router();

// Helper function to check if user has access (allows admin override)
const checkUserAccess = (req, userId) => {
  // Admin can access any user assigned to them (checked by adminUserContext middleware)
  if (req.admin) {
    return true;
  }
  // Regular user can only access their own data
  return req.user && req.user.id === parseInt(userId);
};

const DEFAULT_ASSET_TAGS = ['Investment', 'Personal', 'Emergency', 'Retirement'];
const EXPENSE_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly', 'Annually', 'Half-yearly', 'Semi-Annually', 'Weekly', 'Fortnightly'];

const asDecimalRate = (value, fallback = 0.06) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return n > 1 ? n / 100 : n;
};

const latestProfileId = async (userId) => {
  const result = await pool.query(
    'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return result.rows[0]?.id || null;
};

const asJson = (value) => {
  if (value == null) return '{}';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

const sameUser = (a, b) => Number(a) === Number(b);

const insertAssetRow = async ({ userId, profileId, name, tag, currentValue, customData, extras }) => {
  const json = asJson(customData);
  try {
    return await pool.query(
      `INSERT INTO assets (
         user_id, profile_id, name, tag, current_value, custom_data,
         category, sip_amount, sip_frequency, sip_expiry_date, expected_return, notes
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        userId,
        profileId,
        name,
        tag,
        currentValue || 0,
        json,
        extras.category || null,
        extras.sip_amount ?? 0,
        extras.sip_frequency || 'Monthly',
        extras.sip_expiry_date || null,
        extras.expected_return ?? null,
        extras.notes || null,
      ]
    );
  } catch (error) {
    console.warn('Asset insert with extra columns failed, retrying core columns:', error.message);
    return pool.query(
      `INSERT INTO assets (user_id, profile_id, name, tag, current_value, custom_data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
      [userId, profileId, name, tag, currentValue || 0, json]
    );
  }
};

const insertWorkAssetRow = async ({ userId, profileId, stream, amount, growthRate, endAge, notes, color }) => {
  const rate = asDecimalRate(growthRate, 0.05);
  const end = Number.isFinite(Number(endAge)) && Number(endAge) > 0 ? Number(endAge) : 65;
  try {
    return await pool.query(
      `INSERT INTO work_assets (user_id, profile_id, stream, amount, growth_rate, end_age, notes, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [userId, profileId, stream || 'Income stream', amount || 0, rate, end, notes || null, color || null]
    );
  } catch (error) {
    console.warn('Work asset insert with extra columns failed, retrying core columns:', error.message);
    return pool.query(
      `INSERT INTO work_assets (user_id, profile_id, stream, amount, growth_rate, end_age)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, profileId, stream || 'Income stream', amount || 0, rate, end]
    );
  }
};

const ensureAssetTag = async (userId, tag) => {
  if (!tag) return;
  await pool.query(
    `INSERT INTO user_tags (user_id, tag_name, tag_order)
     SELECT $1, $2, 0
     WHERE NOT EXISTS (SELECT 1 FROM user_tags WHERE user_id = $1 AND tag_name = $2)`,
    [userId, tag]
  );
};

const isAllowedAssetTag = async (userId, tag) => Boolean(tag && String(tag).trim());

// Source preference management
router.get('/source-preferences', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT component, source FROM user_source_preferences WHERE user_id = $1',
      [req.user.id]
    );
    
    const preferences = {};
    result.rows.forEach(row => {
      preferences[row.component] = row.source;
    });
    
    res.json({ preferences });
  } catch (error) {
    console.error('Error fetching source preferences:', error);
    res.status(500).json({ error: 'Failed to fetch source preferences' });
  }
});

router.post('/source-preferences', [
  body('component').isIn(['assets', 'income', 'loans', 'expenses', 'goals']),
  body('source').isInt({ min: 0, max: 1 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { component, source } = req.body;

    await pool.query(`
      INSERT INTO user_source_preferences (user_id, component, source, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, component)
      DO UPDATE SET source = $3, updated_at = NOW()
    `, [req.user.id, component, source]);

    res.json({ success: true, component, source });
  } catch (error) {
    console.error('Error updating source preference:', error);
    res.status(500).json({ error: 'Failed to update source preference' });
  }
});

// Financial Profile routes
router.post('/profile', [
  body('age').isInt({ min: 16, max: 100 }),
  body('current_annual_gross_income').optional().isFloat({ min: 0 }),
  body('work_tenure_years').optional().isInt({ min: 0, max: 80 }),
  body('total_asset_gross_market_value').optional().isFloat({ min: 0 }),
  body('total_loan_outstanding_value').optional().isFloat({ min: 0 }),
  body('lifespan_years').optional().isInt({ min: 40, max: 120 }),
  body('income_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('asset_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('inflation_rate').optional().isFloat({ min: 0, max: 1 }),
  body('equity_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('debt_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('personal_asset_value').optional().isFloat({ min: 0 }),
  body('household').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    // Filter out undefined values for dynamic query
    const filteredBody = Object.fromEntries(
      Object.entries(req.body).filter(([_, value]) => value !== undefined)
    );

    const { age, current_annual_gross_income, work_tenure_years,
      total_asset_gross_market_value, total_loan_outstanding_value,
      lifespan_years, income_growth_rate, asset_growth_rate,
      inflation_rate, equity_growth_rate, debt_growth_rate, personal_asset_value, household
    } = filteredBody;

    const fields = [];
    const values = [];
    let paramCount = 1;

    fields.push('user_id'); values.push(req.user.id);
    if (age !== undefined) { fields.push('age'); values.push(age); }
    if (current_annual_gross_income !== undefined) { fields.push('current_annual_gross_income'); values.push(current_annual_gross_income); }
    if (work_tenure_years !== undefined) { fields.push('work_tenure_years'); values.push(work_tenure_years); }
    if (total_asset_gross_market_value !== undefined) { fields.push('total_asset_gross_market_value'); values.push(total_asset_gross_market_value); }
    if (total_loan_outstanding_value !== undefined) { fields.push('total_loan_outstanding_value'); values.push(total_loan_outstanding_value); }
    if (lifespan_years !== undefined) { fields.push('lifespan_years'); values.push(lifespan_years); }
    if (income_growth_rate !== undefined) { fields.push('income_growth_rate'); values.push(income_growth_rate); }
    if (asset_growth_rate !== undefined) { fields.push('asset_growth_rate'); values.push(asset_growth_rate); }
    if (inflation_rate !== undefined) { fields.push('inflation_rate'); values.push(inflation_rate); }
    if (equity_growth_rate !== undefined) { fields.push('equity_growth_rate'); values.push(equity_growth_rate); }
    if (debt_growth_rate !== undefined) { fields.push('debt_growth_rate'); values.push(debt_growth_rate); }
    if (personal_asset_value !== undefined) { fields.push('personal_asset_value'); values.push(personal_asset_value); }
    if (household !== undefined) { fields.push('household'); values.push(asJson(household)); }
    fields.push('created_at'); values.push('NOW()');

    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const query = `INSERT INTO financial_profile (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;

    const result = await pool.query(query, values);

    res.status(201).json({
      message: 'Financial profile created successfully',
      profile: result.rows[0]
    });
  } catch (error) {
    console.error('Profile creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Check access (allows admin override)
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let result = await pool.query(
      'SELECT * FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    // If no profile exists, create a default one
    if (result.rows.length === 0) {
      console.log(`Creating default financial profile for user ${userId}`);
      
      const defaultProfile = {
        age: 32,
        current_annual_gross_income: 0,
        work_tenure_years: 28,
        total_asset_gross_market_value: 0,
        total_loan_outstanding_value: 0,
        lifespan_years: 85,
        income_growth_rate: 0.08,
        asset_growth_rate: 0.11,
        inflation_rate: 0.06
      };

      const insertResult = await pool.query(
        `INSERT INTO financial_profile (user_id, age, current_annual_gross_income, work_tenure_years, 
         total_asset_gross_market_value, total_loan_outstanding_value, lifespan_years, 
         income_growth_rate, asset_growth_rate, inflation_rate, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
         RETURNING *`,
        [userId, defaultProfile.age, defaultProfile.current_annual_gross_income, 
         defaultProfile.work_tenure_years, defaultProfile.total_asset_gross_market_value,
         defaultProfile.total_loan_outstanding_value, defaultProfile.lifespan_years,
         defaultProfile.income_growth_rate, defaultProfile.asset_growth_rate, defaultProfile.inflation_rate]
      );

      result = insertResult;
      console.log(`Default financial profile created for user ${userId}`);
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profile/:profileId', [
  body('age').optional().isInt({ min: 16, max: 100 }),
  body('current_annual_gross_income').optional().isFloat({ min: 0 }),
  body('work_tenure_years').optional().isInt({ min: 0, max: 80 }),
  body('total_asset_gross_market_value').optional().isFloat({ min: 0 }),
  body('total_loan_outstanding_value').optional().isFloat({ min: 0 }),
  body('lifespan_years').optional().isInt({ min: 40, max: 120 }),
  body('income_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('asset_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('inflation_rate').optional().isFloat({ min: 0, max: 1 }),
  body('equity_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('debt_growth_rate').optional().isFloat({ min: 0, max: 1 }),
  body('personal_asset_value').optional().isFloat({ min: 0 }),
  body('household').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { profileId } = req.params;
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Check if profile belongs to user
    const profileCheck = await pool.query(
      'SELECT user_id FROM financial_profile WHERE id = $1',
      [profileId]
    );

    if (profileCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Financial profile not found' });
    }

    if (profileCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const allowed = new Set([
      'age', 'current_annual_gross_income', 'work_tenure_years',
      'total_asset_gross_market_value', 'total_loan_outstanding_value',
      'lifespan_years', 'income_growth_rate', 'asset_growth_rate',
      'inflation_rate', 'equity_growth_rate', 'debt_growth_rate', 'personal_asset_value', 'household'
    ]);
    Object.entries(req.body).forEach(([key, value]) => {
      if (value !== undefined && allowed.has(key)) {
        updates.push(`${key} = $${paramCount}`);
        values.push(key === 'household' ? asJson(value) : value);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(profileId);
    const query = `UPDATE financial_profile SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Profile updated successfully',
      profile: result.rows[0]
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Goals routes (singular)
router.post('/goal', [
  body('name').optional().trim(),
  body('target_amount').optional().isNumeric(),
  body('target_year').optional().isInt(),
  body('target_date').optional().isISO8601(),
  body('term').optional().isIn(['ST', 'LT']),
  body('recommended_allocation').optional().trim(),
  body('funding_source').optional().trim(),
  body('on_track').optional().isBoolean(),
  body('custom_data').optional().isObject(),
  body('category').optional().trim(),
  body('flexibility').optional().trim(),
  body('span_years').optional().isInt({ min: 0 }),
  body('inflation_pct').optional().isFloat({ min: 0 }),
  body('target_age').optional().isInt({ min: 0, max: 120 }),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    console.log('🎯 Goal creation request body:', req.body);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    // Map Life Sheet fields to LifeMaps schema
    const name = req.body.name ?? req.body.description ?? null;
    const target_amount = req.body.target_amount ?? req.body.amount ?? null;
    const target_date = req.body.target_date ?? null;
    const target_year = req.body.target_year ?? req.body.targetYear ?? null;
    const term = req.body.term ?? 'LT';
    const recommended_allocation = req.body.recommended_allocation ?? null;
    const funding_source = req.body.funding_source ?? null;
    const on_track = req.body.on_track ?? false;
    
    console.log('🎯 Mapped values:', { name, target_amount, target_year, term });

    // Build dynamic query for goal creation
    const fields = ['user_id'];
    const values = [req.user.id];

    // Add profile_id if provided, otherwise get the latest profile
    const profileId = req.body.profile_id || req.body.profileId;
    if (profileId) {
      fields.push('profile_id');
      values.push(profileId);
    } else {
      // Get the latest profile for this user
      const profileResult = await pool.query(
        'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      if (profileResult.rows.length > 0) {
        fields.push('profile_id');
        values.push(profileResult.rows[0].id);
      }
    }

    if (name !== null && name !== undefined) { fields.push('name'); values.push(name); }
    if (target_amount !== null && target_amount !== undefined) { fields.push('target_amount'); values.push(target_amount); }
    if (target_date !== null && target_date !== undefined) { fields.push('target_date'); values.push(target_date); }
    if (target_year !== null && target_year !== undefined) { fields.push('target_year'); values.push(target_year); }
    if (term !== null && term !== undefined) { fields.push('term'); values.push(term); }
    if (recommended_allocation !== null && recommended_allocation !== undefined) { fields.push('recommended_allocation'); values.push(recommended_allocation); }
    if (funding_source !== null && funding_source !== undefined) { fields.push('funding_source'); values.push(funding_source); }
    if (on_track !== null && on_track !== undefined) { fields.push('on_track'); values.push(on_track); }
    if (req.body.custom_data !== null && req.body.custom_data !== undefined) { fields.push('custom_data'); values.push(req.body.custom_data); }
    if (req.body.category != null) { fields.push('category'); values.push(req.body.category); }
    if (req.body.flexibility != null) { fields.push('flexibility'); values.push(req.body.flexibility); }
    if (req.body.span_years != null) { fields.push('span_years'); values.push(req.body.span_years); }
    if (req.body.inflation_pct != null) { fields.push('inflation_pct'); values.push(req.body.inflation_pct); }
    if (req.body.target_age != null) { fields.push('target_age'); values.push(req.body.target_age); }
    if (req.body.notes != null) { fields.push('notes'); values.push(req.body.notes); }

    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const query = `INSERT INTO financial_goal (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    
    console.log('🎯 SQL Query:', query);
    console.log('🎯 Values:', values);
    
    const result = await pool.query(query, values);
    
    console.log('🎯 Created goal:', result.rows[0]);

    res.status(201).json({
      message: 'Financial goal created successfully',
      goal: result.rows[0]
    });
  } catch (error) {
    console.error('Goal creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/goal/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM financial_goal WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // Map database fields to frontend field names
    const mappedGoals = result.rows.map(goal => ({
      ...goal,
      id: goal.id,
      name: goal.name,
      description: goal.name,
      amount: goal.target_amount,
      target_amount: goal.target_amount,
      targetYear: goal.target_year,
      target_year: goal.target_year,
      custom_data: goal.custom_data || {},
      category: goal.category,
      flexibility: goal.flexibility,
      span_years: goal.span_years,
      inflation_pct: goal.inflation_pct,
      target_age: goal.target_age,
      notes: goal.notes,
      user_id: goal.user_id,
      created_at: goal.created_at,
      updated_at: goal.updated_at
    }));

    res.json({ goals: mappedGoals });
  } catch (error) {
    console.error('Goals fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/goal/:goalId', [
  body('name').optional().trim().isLength({ min: 1 }),
  body('target_amount').optional().isFloat({ min: 0 }),
  body('target_date').optional().isISO8601(),
  body('term').optional().isIn(['ST', 'LT']),
  body('recommended_allocation').optional().trim(),
  body('funding_source').optional().trim(),
  body('on_track').optional().isBoolean(),
  body('custom_data').optional().isObject(),
  body('category').optional().trim(),
  body('flexibility').optional().trim(),
  body('span_years').optional().isInt({ min: 0 }),
  body('inflation_pct').optional().isFloat({ min: 0 }),
  body('target_age').optional().isInt({ min: 0, max: 120 }),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { goalId } = req.params;
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Check ownership
    const goalCheck = await pool.query(
      'SELECT user_id FROM financial_goal WHERE id = $1',
      [goalId]
    );

    if (goalCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (goalCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query with field mapping
    const goalColumns = new Set([
      'name', 'target_amount', 'target_date', 'target_year', 'term',
      'recommended_allocation', 'funding_source', 'on_track', 'custom_data',
      'category', 'flexibility', 'span_years', 'inflation_pct', 'target_age', 'notes'
    ]);
    const usedColumns = new Set();
    Object.entries(req.body).forEach(([key, value]) => {
      if (value === undefined) return;
      let dbColumn = key;
      if (key === 'description') dbColumn = 'name';
      if (key === 'amount') dbColumn = 'target_amount';
      if (key === 'targetYear') dbColumn = 'target_year';
      if (!goalColumns.has(dbColumn) || usedColumns.has(dbColumn)) return;
      updates.push(`${dbColumn} = $${paramCount}`);
      values.push(value);
      usedColumns.add(dbColumn);
      paramCount++;
    });
    
    console.log('🎯 Goal update - updates:', updates);
    console.log('🎯 Goal update - values:', values);
    console.log('🎯 Goal update - custom_data:', req.body.custom_data);
    console.log('🎯 Goal update - custom_data type:', typeof req.body.custom_data);
    console.log('🎯 Goal update - custom_data stringified:', JSON.stringify(req.body.custom_data));
    console.log('🎯 Goal update - full request body:', JSON.stringify(req.body));

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(goalId);
    const query = `UPDATE financial_goal SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Goal updated successfully',
      goal: result.rows[0]
    });
  } catch (error) {
    console.error('Goal update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/goal/:goalId', async (req, res) => {
  try {
    const { goalId } = req.params;

    // Check ownership
    const goalCheck = await pool.query(
      'SELECT user_id FROM financial_goal WHERE id = $1',
      [goalId]
    );

    if (goalCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (goalCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM financial_goal WHERE id = $1', [goalId]);

    res.json({ message: 'Goal deleted successfully' });
  } catch (error) {
    console.error('Goal deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Expenses routes (singular)
router.post('/expense', [
  body('description').optional().trim(),
  body('category').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    return typeof value === 'string' && value.trim().length >= 1;
  }),
  body('subcategory').optional().trim(),
  body('frequency').optional().isIn(EXPENSE_FREQUENCIES),
  body('amount').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    return !isNaN(parseFloat(value)) && parseFloat(value) >= 0;
  }),
  body('personal_inflation').optional().isFloat({ min: 0, max: 100 }),
  body('tag_for').optional().trim(),
  body('lifestyle_level').optional().trim(),
  body('payment_from').optional().trim(),
  body('source').optional().trim(),
  body('notes').optional().trim(),
  body('expiry').optional().isISO8601(),
  body('start_age').optional().isInt({ min: 0, max: 120 }),
  body('end_age').optional().isInt({ min: 0, max: 120 }),
  body('need_type').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    // Map Life Sheet fields to LifeMaps schema
    const description = req.body.description ?? req.body.category ?? 'General';
    const category = req.body.category ?? 'General';
    const subcategory = req.body.subcategory ?? req.body.expense_type ?? null;
    const frequency = req.body.frequency ?? 'Monthly';
    const amount = req.body.amount ?? null;
    const personal_inflation = req.body.personal_inflation != null ? asDecimalRate(req.body.personal_inflation, 0.06) : 0.06;
    const tag_for = req.body.tag_for ?? req.body.need_type ?? null;
    const lifestyle_level = req.body.lifestyle_level ?? null;
    const payment_from = req.body.payment_from ?? null;
    const source = req.body.source ?? null;
    const notes = req.body.notes ?? null;
    const expiry = req.body.expiry ?? null;
    const start_age = req.body.start_age ?? null;
    const end_age = req.body.end_age ?? null;
    const need_type = req.body.need_type ?? req.body.tag_for ?? null;

    // Build dynamic query for expense creation
    const fields = ['user_id'];
    const values = [req.user.id];

    // Add profile_id if provided, otherwise get the latest profile
    const profileId = req.body.profile_id || req.body.profileId;
    if (profileId) {
      fields.push('profile_id');
      values.push(profileId);
    } else {
      // Get the latest profile for this user
      const profileResult = await pool.query(
        'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      if (profileResult.rows.length > 0) {
        fields.push('profile_id');
        values.push(profileResult.rows[0].id);
      }
    }

    if (description !== null && description !== undefined) { fields.push('description'); values.push(description); }
    if (category !== null && category !== undefined) { fields.push('category'); values.push(category); }
    if (subcategory !== null && subcategory !== undefined) { fields.push('subcategory'); values.push(subcategory); }
    if (frequency !== null && frequency !== undefined) { fields.push('frequency'); values.push(frequency); }
    if (amount !== null && amount !== undefined) { fields.push('amount'); values.push(amount); }
    if (personal_inflation !== null && personal_inflation !== undefined) { fields.push('personal_inflation'); values.push(personal_inflation); }
    if (tag_for !== null && tag_for !== undefined) { fields.push('tag_for'); values.push(tag_for); }
    if (lifestyle_level !== null && lifestyle_level !== undefined) { fields.push('lifestyle_level'); values.push(lifestyle_level); }
    if (payment_from !== null && payment_from !== undefined) { fields.push('payment_from'); values.push(payment_from); }
    if (source !== null && source !== undefined) { fields.push('source'); values.push(source); }
    if (notes !== null && notes !== undefined) { fields.push('notes'); values.push(notes); }
    if (expiry !== null && expiry !== undefined) { fields.push('expiry'); values.push(expiry); }
    if (start_age !== null && start_age !== undefined) { fields.push('start_age'); values.push(start_age); }
    if (end_age !== null && end_age !== undefined) { fields.push('end_age'); values.push(end_age); }
    if (need_type !== null && need_type !== undefined) { fields.push('need_type'); values.push(need_type); }

    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const query = `INSERT INTO financial_expense (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    
    const result = await pool.query(query, values);

    res.status(201).json({
      message: 'Expense created successfully',
      expense: result.rows[0]
    });
  } catch (error) {
    console.error('Expense creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/expense/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM financial_expense WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ expenses: result.rows });
  } catch (error) {
    console.error('Expenses fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/expense/:expenseId', [
  body('description').optional().trim(),
  body('category').optional().trim().isLength({ min: 1 }),
  body('subcategory').optional().trim(),
  body('frequency').optional().isIn(EXPENSE_FREQUENCIES),
  body('amount').optional().isFloat({ min: 0 }),
  body('personal_inflation').optional().isFloat({ min: 0, max: 100 }),
  body('tag_for').optional().trim(),
  body('lifestyle_level').optional().trim(),
  body('payment_from').optional().trim(),
  body('source').optional().trim(),
  body('notes').optional().trim(),
  body('expiry').optional().isISO8601(),
  body('start_age').optional().isInt({ min: 0, max: 120 }),
  body('end_age').optional().isInt({ min: 0, max: 120 }),
  body('need_type').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { expenseId } = req.params;
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Check ownership
    const expenseCheck = await pool.query(
      'SELECT user_id FROM financial_expense WHERE id = $1',
      [expenseId]
    );

    if (expenseCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (expenseCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query - map frontend fields to database columns
    const fieldMap = {
      'description': 'description',
      'category': 'category',
      'subcategory': 'subcategory',
      'frequency': 'frequency',
      'amount': 'amount',
      'personal_inflation': 'personal_inflation',
      'tag_for': 'tag_for',
      'lifestyle_level': 'lifestyle_level',
      'payment_from': 'payment_from',
      'source': 'source',
      'notes': 'notes',
      'expiry': 'expiry',
      'start_age': 'start_age',
      'end_age': 'end_age',
      'need_type': 'need_type'
    };
    
    const usedColumns = new Set();
    Object.entries(req.body).forEach(([key, value]) => {
      if (value !== undefined && fieldMap[key]) {
        const dbColumn = fieldMap[key];
        let nextValue = value;
        if (dbColumn === 'personal_inflation') nextValue = asDecimalRate(value, 0.06);
        if (key === 'tag_for' && req.body.need_type == null && !usedColumns.has('need_type')) {
          updates.push(`need_type = $${paramCount}`);
          values.push(value);
          usedColumns.add('need_type');
          paramCount++;
        }
        if (!usedColumns.has(dbColumn)) {
          updates.push(`${dbColumn} = $${paramCount}`);
          values.push(nextValue);
          usedColumns.add(dbColumn);
          paramCount++;
        }
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(expenseId);
    const query = `UPDATE financial_expense SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Expense updated successfully',
      expense: result.rows[0]
    });
  } catch (error) {
    console.error('Expense update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/expense/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;

    // Check ownership and get loan_id if present
    const expenseCheck = await pool.query(
      'SELECT user_id, loan_id FROM financial_expense WHERE id = $1',
      [expenseId]
    );

    if (expenseCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (expenseCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const loanId = expenseCheck.rows[0].loan_id;

    // Delete the expense
    await pool.query('DELETE FROM financial_expense WHERE id = $1', [expenseId]);

    // If this expense was linked to a loan, delete the associated loan as well
    if (loanId) {
      try {
        console.log(`🗑️ Expense ${expenseId} was linked to loan ${loanId}, deleting loan as well`);
        
        // Check loan ownership before deleting
        const loanCheck = await pool.query(
          'SELECT user_id FROM financial_loan WHERE id = $1',
          [loanId]
        );

        if (loanCheck.rows.length > 0 && loanCheck.rows[0].user_id === req.user.id) {
          // Delete the loan (CASCADE will handle any other expenses linked to it)
          await pool.query('DELETE FROM financial_loan WHERE id = $1', [loanId]);
          console.log(`✅ Deleted associated loan ${loanId}`);
        } else {
          console.log(`⚠️ Loan ${loanId} not found or access denied, skipping loan deletion`);
        }
      } catch (loanError) {
        console.error('Error deleting associated loan:', loanError);
        // Don't fail the expense deletion if loan deletion fails
      }
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Expense deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const LIFEMAP_EXPENSE_CATS = [
  'Housing & rent', 'Food & groceries', 'Utilities & bills', 'Transport & fuel',
  'Healthcare', 'Education', 'Insurance premiums', 'Loan EMI', 'Domestic help',
  'Dining & entertainment', 'Travel & holidays', 'Shopping & personal',
  'Subscriptions', 'Savings & investments', 'Other',
];

const classifyWithOpenAI = async (description) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 80,
      messages: [
        { role: 'system', content: 'You are a financial expense classification assistant. Always respond with valid JSON only.' },
        {
          role: 'user',
          content: `Classify this expense into exactly one category from this list:\n${LIFEMAP_EXPENSE_CATS.map((c) => `- ${c}`).join('\n')}\n\nExpense: "${description}"\n\nRespond ONLY with: {"category":"CategoryName"}`,
        },
      ],
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  let text = data?.choices?.[0]?.message?.content?.trim() || '';
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  const parsed = JSON.parse(text);
  const category = String(parsed.category || '').trim();
  if (!category) return null;
  const exact = LIFEMAP_EXPENSE_CATS.find((c) => c.toLowerCase() === category.toLowerCase());
  const loose = LIFEMAP_EXPENSE_CATS.find((c) => c.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes(c.toLowerCase().split(/[&/]/)[0].trim()));
  return { category: exact || loose || 'Other', subcategory: description };
};

// Classify expense using LLM (Python classifier, then OpenAI fallback)
router.post('/expense/classify', [
  body('description').notEmpty().trim(),
  body('user_id').optional().isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { description, user_id } = req.body;
    const userId = user_id || req.user?.id;
    const classifierUrl = process.env.CLASSIFIER_SERVICE_URL;

    if (classifierUrl) {
      try {
        const response = await fetch(`${classifierUrl.replace(/\/$/, '')}/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, user_id: userId }),
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const result = await response.json();
          if (result?.category) return res.json(result);
        }
      } catch (error) {
        console.warn('Classifier service unavailable, using OpenAI fallback:', error.message);
      }
    }

    const fallback = await classifyWithOpenAI(description);
    if (fallback) return res.json(fallback);
    return res.status(503).json({ error: 'Expense classification is unavailable' });
  } catch (error) {
    console.error('Expense classification error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Loans routes (singular)
router.post('/loan', [
  body('lender').optional().trim().isLength({ min: 1 }),
  body('type').optional().trim().isLength({ min: 1 }),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('principal_outstanding').optional().isFloat({ min: 0 }),
  body('rate').optional().isFloat({ min: 0, max: 100 }),
  body('emi').optional().custom((value) => {
    if (value === null || value === undefined || value === '') return true;
    return !isNaN(parseFloat(value)) && parseFloat(value) >= 0;
  }),
  body('emi_day').optional().isInt({ min: 1, max: 31 }),
  body('prepay_allowed').optional().isBoolean(),
  body('notes').optional().trim(),
  body('name').optional().trim(),
  body('frequency').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const lender = req.body.lender ?? req.body.provider ?? null;
    const type = req.body.type ?? null;
    const start_date = req.body.start_date ?? null;
    const end_date = req.body.end_date ?? null;
    const principal_outstanding = req.body.principal_outstanding ?? req.body.amount ?? null;
    const rate = req.body.rate ?? req.body.interestRate ?? null;
    const emi = req.body.emi ?? null;
    const emi_day = req.body.emi_day ?? null;
    const prepay_allowed = req.body.prepay_allowed ?? null;
    const notes = req.body.notes ?? null;
    const name = req.body.name ?? req.body.loanName ?? null;
    const frequency = req.body.frequency ?? 'Monthly';

    // Build dynamic query for loan creation
    const fields = ['user_id'];
    const values = [req.user.id];

    // Add profile_id if provided, otherwise use a default or get the latest profile
    const profileId = req.body.profile_id || req.body.profileId;
    if (profileId) {
      fields.push('profile_id');
      values.push(profileId);
    } else {
      // Get the latest profile for this user
      const profileResult = await pool.query(
        'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      if (profileResult.rows.length > 0) {
        fields.push('profile_id');
        values.push(profileResult.rows[0].id);
      }
    }

    if (lender !== null && lender !== undefined) { fields.push('lender'); values.push(lender); }
    if (type !== null && type !== undefined) { fields.push('type'); values.push(type); }
    if (start_date !== null && start_date !== undefined) { fields.push('start_date'); values.push(start_date); }
    if (end_date !== null && end_date !== undefined) { fields.push('end_date'); values.push(end_date); }
    if (principal_outstanding !== null && principal_outstanding !== undefined) { fields.push('principal_outstanding'); values.push(principal_outstanding); }
    if (rate !== null && rate !== undefined) { fields.push('rate'); values.push(rate); }
    if (emi !== null && emi !== undefined) { fields.push('emi'); values.push(emi); }
    if (emi_day !== null && emi_day !== undefined) { fields.push('emi_day'); values.push(emi_day); }
    if (prepay_allowed !== null && prepay_allowed !== undefined) { fields.push('prepay_allowed'); values.push(prepay_allowed); }
    if (notes !== null && notes !== undefined) { fields.push('notes'); values.push(notes); }
    if (name !== null && name !== undefined) { fields.push('name'); values.push(name); }
    if (frequency !== null && frequency !== undefined) { fields.push('frequency'); values.push(frequency); }

    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');
    const query = `INSERT INTO financial_loan (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    
    const result = await pool.query(query, values);
    const newLoan = result.rows[0];

    // If loan has EMI and expiry (end_date), create corresponding expense
    if (emi && end_date) {
      try {
        // Get profile_id for the expense
        let expenseProfileId = profileId;
        if (!expenseProfileId) {
          const profileResult = await pool.query(
            'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
          );
          if (profileResult.rows.length > 0) {
            expenseProfileId = profileResult.rows[0].id;
          }
        }

        if (expenseProfileId) {
          // Create expense with EMI amount and expiry matching loan
          const expenseFields = ['user_id', 'profile_id', 'loan_id', 'description', 'amount', 'frequency', 'expiry', 'category', 'subcategory'];
          const expenseValues = [
            req.user.id,
            expenseProfileId,
            newLoan.id,
            `Loan EMI - ${lender || 'Loan'}`,
            emi,
            'Monthly',
            end_date,
            'Debt',
            'Loan EMI'
          ];
          const expensePlaceholders = expenseValues.map((_, index) => `$${index + 1}`).join(', ');
          const expenseQuery = `INSERT INTO financial_expense (${expenseFields.join(', ')}) VALUES (${expensePlaceholders}) RETURNING *`;
          
          await pool.query(expenseQuery, expenseValues);
          console.log(`✅ Created expense for loan ${newLoan.id}`);
        }
      } catch (expenseError) {
        console.error('Error creating expense for loan:', expenseError);
        // Don't fail the loan creation if expense creation fails
      }
    }

    res.status(201).json({
      message: 'Loan created successfully',
      loan: newLoan
    });
  } catch (error) {
    console.error('Loan creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/loan/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM financial_loan WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    // Map database fields to frontend field names
    const mappedLoans = result.rows.map(loan => {
      console.log('🔍 Raw loan from DB:', { id: loan.id, end_date: loan.end_date, end_date_type: typeof loan.end_date });
      
      let loanExpiry;
      try {
        if (loan.end_date) {
          // Handle both string and Date object cases
          if (typeof loan.end_date === 'string') {
            loanExpiry = parseInt(loan.end_date.split('-')[0]);
          } else {
            // It's a Date object, get the year directly
            loanExpiry = loan.end_date.getFullYear();
          }
        } else {
          loanExpiry = new Date().getFullYear() + 35;
        }
      } catch (error) {
        console.error('❌ Error parsing end_date:', error, 'for loan:', loan.id);
        loanExpiry = new Date().getFullYear() + 35;
      }
      
      console.log('🔍 Calculated loanExpiry:', loanExpiry);
      
      return {
        ...loan,
        id: loan.id,
        provider: loan.lender,
        lender: loan.lender,
        name: loan.name,
        loanName: loan.name,
        type: loan.type,
        amount: loan.principal_outstanding,
        principal_outstanding: loan.principal_outstanding,
        interestRate: loan.rate ? parseFloat(loan.rate).toFixed(2) : 0,
        rate: loan.rate,
        emi: loan.emi,
        frequency: loan.frequency || 'Monthly',
        notes: loan.notes,
        loanExpiry: loanExpiry,
        user_id: loan.user_id,
        created_at: loan.created_at,
        updated_at: loan.updated_at
      };
    });

    res.json({ loans: mappedLoans });
  } catch (error) {
    console.error('Loans fetch error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

router.put('/loan/:loanId', [
  body('lender').optional().trim().isLength({ min: 1 }),
  body('type').optional().trim().isLength({ min: 1 }),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('principal_outstanding').optional().isFloat({ min: 0 }),
  body('rate').optional().isFloat({ min: 0, max: 100 }),
  body('emi').optional().isFloat({ min: 0 }),
  body('emi_day').optional().isInt({ min: 1, max: 31 }),
  body('prepay_allowed').optional().isBoolean(),
  body('notes').optional().trim(),
  body('name').optional().trim(),
  body('frequency').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { loanId } = req.params;
    const updates = [];
    const values = [];
    let paramCount = 1;

    // Check ownership
    const loanCheck = await pool.query(
      'SELECT user_id FROM financial_loan WHERE id = $1',
      [loanId]
    );

    if (loanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loanCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query with field mapping
    const loanColumns = new Set([
      'lender', 'type', 'start_date', 'end_date', 'principal_outstanding',
      'rate', 'emi', 'emi_day', 'prepay_allowed', 'notes', 'name', 'frequency'
    ]);
    const usedColumns = new Set();
    Object.entries(req.body).forEach(([key, raw]) => {
      if (raw === undefined) return;
      let dbColumn = key;
      let value = raw;
      if (key === 'provider') dbColumn = 'lender';
      if (key === 'amount') dbColumn = 'principal_outstanding';
      if (key === 'interestRate') dbColumn = 'rate';
      if (key === 'endAge') dbColumn = 'end_date';
      if (key === 'loanName') dbColumn = 'name';
      if (!loanColumns.has(dbColumn) || usedColumns.has(dbColumn)) return;
      updates.push(`${dbColumn} = $${paramCount}`);
      values.push(value);
      usedColumns.add(dbColumn);
      paramCount++;
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(loanId);
    const query = `UPDATE financial_loan SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    const updatedLoan = result.rows[0];

    // Handle expense creation/update for loan EMI
    try {
      // Get the updated loan data (including EMI and end_date)
      const loanData = await pool.query(
        'SELECT emi, end_date, lender, user_id FROM financial_loan WHERE id = $1',
        [loanId]
      );
      
      if (loanData.rows.length > 0) {
        const loan = loanData.rows[0];
        const emi = loan.emi;
        const end_date = loan.end_date;
        const lender = loan.lender;
        
        // Check if expense already exists for this loan
        const existingExpense = await pool.query(
          'SELECT id FROM financial_expense WHERE loan_id = $1',
          [loanId]
        );
        
        if (emi && end_date) {
          // Get profile_id for the expense
          const profileResult = await pool.query(
            'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [loan.user_id]
          );
          
          if (profileResult.rows.length > 0) {
            const profileId = profileResult.rows[0].id;
            
            if (existingExpense.rows.length > 0) {
              // Update existing expense
              await pool.query(
                `UPDATE financial_expense 
                 SET amount = $1, expiry = $2, description = $3, updated_at = NOW() 
                 WHERE loan_id = $4`,
                [emi, end_date, `Loan EMI - ${lender || 'Loan'}`, loanId]
              );
              console.log(`✅ Updated expense for loan ${loanId}`);
            } else {
              // Create new expense
              await pool.query(
                `INSERT INTO financial_expense 
                 (user_id, profile_id, loan_id, description, amount, frequency, expiry, category, subcategory) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [loan.user_id, profileId, loanId, `Loan EMI - ${lender || 'Loan'}`, emi, 'Monthly', end_date, 'Debt', 'Loan EMI']
              );
              console.log(`✅ Created expense for loan ${loanId}`);
            }
          }
        } else if (existingExpense.rows.length > 0) {
          // If EMI or end_date is removed, delete the expense
          await pool.query('DELETE FROM financial_expense WHERE loan_id = $1', [loanId]);
          console.log(`✅ Deleted expense for loan ${loanId} (EMI or expiry removed)`);
        }
      }
    } catch (expenseError) {
      console.error('Error handling expense for loan update:', expenseError);
      // Don't fail the loan update if expense handling fails
    }

    res.json({
      message: 'Loan updated successfully',
      loan: updatedLoan
    });
  } catch (error) {
    console.error('Loan update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/loan/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    console.log('🗑️ Loan deletion request for ID:', loanId, 'by user:', req.user.id);

    // Check ownership
    const loanCheck = await pool.query(
      'SELECT user_id FROM financial_loan WHERE id = $1',
      [loanId]
    );

    if (loanCheck.rows.length === 0) {
      console.log('❌ Loan not found with ID:', loanId);
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loanCheck.rows[0].user_id !== req.user.id) {
      console.log('❌ Access denied for loan ID:', loanId);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('✅ Proceeding with deletion of loan ID:', loanId);
    
    // Delete associated expense (CASCADE should handle this, but explicit deletion for clarity)
    const expenseDeleteResult = await pool.query('DELETE FROM financial_expense WHERE loan_id = $1', [loanId]);
    console.log(`✅ Deleted ${expenseDeleteResult.rowCount} expense(s) for loan ${loanId}`);
    
    const result = await pool.query('DELETE FROM financial_loan WHERE id = $1 RETURNING id', [loanId]);
    console.log('✅ Loan deleted successfully:', result.rows[0]);

    res.json({ message: 'Loan deleted successfully' });
  } catch (error) {
    console.error('❌ Loan deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Plural aliases for Life Sheet frontend compatibility
router.post('/goals', (req, res, next) => {
  req.url = '/goal';
  router.handle(req, res, next);
});

router.get('/goals/:userId', (req, res, next) => {
  req.url = `/goal/${req.params.userId}`;
  router.handle(req, res, next);
});

router.put('/goals/:goalId', (req, res, next) => {
  req.url = `/goal/${req.params.goalId}`;
  router.handle(req, res, next);
});

router.delete('/goals/:goalId', (req, res, next) => {
  req.url = `/goal/${req.params.goalId}`;
  router.handle(req, res, next);
});

router.post('/expenses', (req, res, next) => {
  req.url = '/expense';
  router.handle(req, res, next);
});

router.get('/expenses/:userId', (req, res, next) => {
  req.url = `/expense/${req.params.userId}`;
  router.handle(req, res, next);
});

router.put('/expenses/:expenseId', (req, res, next) => {
  req.url = `/expense/${req.params.expenseId}`;
  router.handle(req, res, next);
});

router.delete('/expenses/:expenseId', (req, res, next) => {
  req.url = `/expense/${req.params.expenseId}`;
  router.handle(req, res, next);
});

router.post('/loans', (req, res, next) => {
  req.url = '/loan';
  router.handle(req, res, next);
});

router.get('/loans/:userId', (req, res, next) => {
  req.url = `/loan/${req.params.userId}`;
  router.handle(req, res, next);
});

router.put('/loans/:loanId', (req, res, next) => {
  req.url = `/loan/${req.params.loanId}`;
  router.handle(req, res, next);
});

router.delete('/loans/:loanId', async (req, res) => {
  // Forward to the singular route handler
  req.url = `/loan/${req.params.loanId}`;
  req.params = { loanId: req.params.loanId };
  
  // Call the loan delete handler directly
  try {
    const { loanId } = req.params;
    console.log('🗑️ Loan deletion request (plural route) for ID:', loanId, 'by user:', req.user.id);

    // Check ownership
    const loanCheck = await pool.query(
      'SELECT user_id FROM financial_loan WHERE id = $1',
      [loanId]
    );

    if (loanCheck.rows.length === 0) {
      console.log('❌ Loan not found with ID:', loanId);
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loanCheck.rows[0].user_id !== req.user.id) {
      console.log('❌ Access denied for loan ID:', loanId);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('✅ Proceeding with deletion of loan ID:', loanId);
    const result = await pool.query('DELETE FROM financial_loan WHERE id = $1 RETURNING id', [loanId]);
    console.log('✅ Loan deleted successfully:', result.rows[0]);

    res.json({ message: 'Loan deleted successfully' });
  } catch (error) {
    console.error('❌ Loan deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ASSET ROUTES ====================

// Create asset
router.post('/asset', [
  body('name').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('tag').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('current_value').optional().isFloat({ min: 0 }),
  body('custom_data').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, tag, current_value, custom_data } = req.body;

    if (!(await isAllowedAssetTag(req.user.id, tag))) {
      return res.status(400).json({
        error: 'Validation failed',
        details: [{
          type: 'field',
          value: tag,
          msg: 'Invalid tag. Must be one of: ' + DEFAULT_ASSET_TAGS.join(', ') + ' or a saved custom tag',
          path: 'tag',
          location: 'body'
        }]
      });
    }
    await ensureAssetTag(req.user.id, tag).catch((error) => {
      console.warn('ensureAssetTag skipped:', error.message);
    });

    // Get profile_id if provided, otherwise get the latest profile
    const profileId = req.body.profile_id || req.body.profileId;
    let finalProfileId = profileId;
    
    if (!finalProfileId) {
      const profileResult = await pool.query(
        'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [req.user.id]
      );
      if (profileResult.rows.length > 0) {
        finalProfileId = profileResult.rows[0].id;
      } else {
        const created = await pool.query(
          'INSERT INTO financial_profile (user_id, age, lifespan_years, income_growth_rate, asset_growth_rate) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [req.user.id, 32, 85, 0.08, 0.11]
        );
        finalProfileId = created.rows[0].id;
      }
    }

    const result = await insertAssetRow({
      userId: req.user.id,
      profileId: finalProfileId,
      name,
      tag,
      currentValue: current_value,
      customData: custom_data,
      extras: {
        category: req.body.category,
        sip_amount: req.body.sip_amount,
        sip_frequency: req.body.sip_frequency,
        sip_expiry_date: req.body.sip_expiry_date,
        expected_return: req.body.expected_return,
        notes: req.body.notes,
      },
    });

    res.status(201).json({
      message: 'Asset created successfully',
      asset: result.rows[0]
    });
  } catch (error) {
    console.error('Asset creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all assets for user
router.get('/asset/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM assets WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ assets: result.rows });
  } catch (error) {
    console.error('Assets fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update asset
router.put('/asset/:assetId', [
  body('name').optional().trim().isLength({ min: 1, max: 255 }),
  body('tag').optional().trim().isLength({ min: 1, max: 100 }),
  body('current_value').optional().isFloat({ min: 0 }),
  body('custom_data').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { assetId } = req.params;
    const { name, tag, current_value, custom_data } = req.body;
    
    console.log('🔍 Asset update request:', { assetId, name, tag, current_value, custom_data });
    console.log('🔍 Custom_data type:', typeof custom_data);
    console.log('🔍 Custom_data stringified:', JSON.stringify(custom_data));
    console.log('🔍 Custom_data parsed:', custom_data);

    // Validate tag if provided - default LifeMap tags always allowed
    if (tag) {
      if (!(await isAllowedAssetTag(req.user.id, tag))) {
        return res.status(400).json({ 
          error: 'Validation failed', 
          details: [{ 
            type: 'field', 
            value: tag, 
            msg: 'Invalid tag. Must be one of: ' + DEFAULT_ASSET_TAGS.join(', ') + ' or a saved custom tag', 
            path: 'tag', 
            location: 'body' 
          }] 
        });
      }
      await ensureAssetTag(req.user.id, tag).catch((error) => {
      console.warn('ensureAssetTag skipped:', error.message);
    });
    }

    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM assets WHERE id = $1',
      [assetId]
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }
    if (tag !== undefined) {
      updates.push(`tag = $${paramCount}`);
      values.push(tag);
      paramCount++;
    }
    if (current_value !== undefined) {
      updates.push(`current_value = $${paramCount}`);
      values.push(current_value);
      paramCount++;
    }
    if (custom_data !== undefined) {
      updates.push(`custom_data = $${paramCount}::jsonb`);
      values.push(asJson(custom_data));
      paramCount++;
    }
    const extraAssetFields = ['category', 'sip_amount', 'sip_frequency', 'sip_expiry_date', 'expected_return', 'notes'];
    extraAssetFields.forEach((key) => {
      if (req.body[key] !== undefined) {
        updates.push(`${key} = $${paramCount}`);
        values.push(req.body[key]);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(assetId);

    const query = `UPDATE assets SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    console.log('🔍 Asset update query:', query);
    console.log('🔍 Asset update values:', values);
    
    const result = await pool.query(query, values);

    res.json({
      message: 'Asset updated successfully',
      asset: result.rows[0]
    });
  } catch (error) {
    console.error('Asset update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete asset
router.delete('/asset/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;

    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM assets WHERE id = $1',
      [assetId]
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query('DELETE FROM assets WHERE id = $1 RETURNING id', [assetId]);

    res.json({ message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('Asset deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== USER TAGS ROUTES ====================

// Get user's custom tags
router.get('/user-tags/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log('🔍 Fetching tags for user:', userId, 'authenticated user:', req.user.id);
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('🔍 Querying user_tags table...');
    const result = await pool.query(
      'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY tag_order, created_at',
      [userId]
    );

    console.log('🔍 Tags query result:', result.rows);
    
    // If no tags exist, create default tags for the user
    if (result.rows.length === 0) {
      console.log('🔍 No tags found, creating default tags for user:', userId);
      
      const defaultTags = [
        { name: 'Investment', order: 0 },
        { name: 'Personal', order: 1 },
        { name: 'Emergency', order: 2 },
        { name: 'Retirement', order: 3 }
      ];
      
      // Insert default tags
      for (const tag of defaultTags) {
        await pool.query(
          'INSERT INTO user_tags (user_id, tag_name, tag_order) VALUES ($1, $2, $3)',
          [userId, tag.name, tag.order]
        );
      }
      
      console.log('✅ Default tags created for user:', userId);
      
      // Fetch the newly created tags
      const newResult = await pool.query(
        'SELECT * FROM user_tags WHERE user_id = $1 ORDER BY tag_order, created_at',
        [userId]
      );
      
      res.json({ tags: newResult.rows });
    } else {
      res.json({ tags: result.rows });
    }
  } catch (error) {
    console.error('❌ User tags fetch error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Add new tag for user
router.post('/user-tag', [
  body('tag_name').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('tag_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { tag_name, tag_order = 0 } = req.body;
    const userId = req.user.id;

    console.log('🔍 Adding tag for user:', userId, 'tag:', tag_name);

    // Check if tag already exists for this user
    const existingTag = await pool.query(
      'SELECT id FROM user_tags WHERE user_id = $1 AND tag_name = $2',
      [userId, tag_name]
    );

    if (existingTag.rows.length > 0) {
      return res.status(400).json({ error: 'Tag already exists' });
    }

    const result = await pool.query(
      'INSERT INTO user_tags (user_id, tag_name, tag_order) VALUES ($1, $2, $3) RETURNING *',
      [userId, tag_name, tag_order]
    );

    console.log('✅ Tag added successfully:', result.rows[0]);
    res.json({ tag: result.rows[0] });
  } catch (error) {
    console.error('❌ User tag creation error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Delete tag for user
router.delete('/user-tag/:tagId', async (req, res) => {
  try {
    const { tagId } = req.params;
    const userId = req.user.id;

    console.log('🔍 Deleting tag:', tagId, 'for user:', userId);

    // Check ownership
    const tagCheck = await pool.query(
      'SELECT id FROM user_tags WHERE id = $1 AND user_id = $2',
      [tagId, userId]
    );

    if (tagCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Check if this is the last tag (prevent deleting all tags)
    const tagCount = await pool.query(
      'SELECT COUNT(*) FROM user_tags WHERE user_id = $1',
      [userId]
    );

    if (tagCount.rows[0].count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last tag' });
    }

    const result = await pool.query(
      'DELETE FROM user_tags WHERE id = $1 AND user_id = $2 RETURNING id',
      [tagId, userId]
    );

    console.log('✅ Tag deleted successfully:', result.rows[0]);
    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('❌ User tag deletion error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ==================== DEBUG ROUTES ====================

// Check database schema (for debugging)
router.get('/debug/schema', async (req, res) => {
  try {
    console.log('🔍 Checking production database schema...');
    
    // Check if custom_data column exists in assets table
    const assetsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'assets' AND column_name = 'custom_data'
    `);
    
    // Check if custom_data column exists in financial_goal table
    const goalsColumns = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'financial_goal' AND column_name = 'custom_data'
    `);
    
    // Check actual data in the tables
    const assetsData = await pool.query(`
      SELECT id, name, custom_data 
      FROM assets 
      WHERE custom_data IS NOT NULL 
      AND custom_data != '{}'::jsonb
      LIMIT 5
    `);
    
    const goalsData = await pool.query(`
      SELECT id, name, custom_data 
      FROM financial_goal 
      WHERE custom_data IS NOT NULL 
      AND custom_data != '{}'::jsonb
      LIMIT 5
    `);
    
    res.json({
      assets_custom_data_column: assetsColumns.rows,
      goals_custom_data_column: goalsColumns.rows,
      assets_with_custom_data: assetsData.rows,
      goals_with_custom_data: goalsData.rows
    });
  } catch (error) {
    console.error('❌ Schema check failed:', error);
    res.status(500).json({ error: 'Schema check failed', details: error.message });
  }
});

// ==================== ASSET COLUMN ROUTES ====================

// Get user's custom columns
router.get('/asset-columns/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log('🔍 Fetching columns for user:', userId, 'authenticated user:', req.user.id);
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('🔍 Querying user_asset_columns table...');
    const result = await pool.query(
      'SELECT * FROM user_asset_columns WHERE user_id = $1 ORDER BY column_order, created_at',
      [userId]
    );

    console.log('🔍 Columns query result:', result.rows);
    
    // If no columns exist, create default columns for the user
    if (result.rows.length === 0) {
      console.log('🔍 No columns found, creating default columns for user:', userId);
      
      const defaultColumns = CORE_COLUMN_DEFINITIONS;
      
      // Insert default columns
      for (const column of defaultColumns) {
        await pool.query(
          'INSERT INTO user_asset_columns (user_id, column_key, column_label, column_type, column_order) VALUES ($1, $2, $3, $4, $5)',
          [userId, column.key, column.label, column.type, column.order]
        );
      }
      
      console.log('✅ Default columns created for user:', userId);
      
      // Fetch the newly created columns
      const newResult = await pool.query(
        'SELECT * FROM user_asset_columns WHERE user_id = $1 ORDER BY column_order, created_at',
        [userId]
      );
      
      res.json({ columns: newResult.rows });
    } else {
      res.json({ columns: result.rows });
    }
  } catch (error) {
    console.error('❌ Asset columns fetch error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Create custom column
router.post('/asset-column', [
  body('column_key').notEmpty().trim().isLength({ min: 1, max: 100 }),
  body('column_label').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('column_type').optional().isIn(['text', 'number', 'currency', 'date', 'email', 'url']),
  body('column_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { column_key, column_label, column_type = 'text', column_order = 0 } = req.body;

    const result = await pool.query(
      'INSERT INTO user_asset_columns (user_id, column_key, column_label, column_type, column_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, column_key, column_label, column_type, column_order]
    );

    res.status(201).json({
      message: 'Column created successfully',
      column: result.rows[0]
    });
  } catch (error) {
    console.error('Asset column creation error:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'Column with this key already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Update custom column
router.put('/asset-column/:columnId', [
  body('column_order').optional().isInt({ min: 0 }),
  body('column_label').optional().trim().isLength({ min: 1, max: 255 }),
  body('column_type').optional().isIn(['text', 'number', 'currency', 'date', 'email', 'url'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { columnId } = req.params;
    const { column_order, column_label, column_type } = req.body;

    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM user_asset_columns WHERE id = $1',
      [columnId]
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (column_order !== undefined) {
      updateFields.push(`column_order = $${paramCount}`);
      updateValues.push(column_order);
      paramCount++;
    }

    if (column_label !== undefined) {
      updateFields.push(`column_label = $${paramCount}`);
      updateValues.push(column_label);
      paramCount++;
    }

    if (column_type !== undefined) {
      updateFields.push(`column_type = $${paramCount}`);
      updateValues.push(column_type);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(columnId);
    const query = `UPDATE user_asset_columns SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;

    const result = await pool.query(query, updateValues);

    res.json({
      message: 'Column updated successfully',
      column: result.rows[0]
    });
  } catch (error) {
    console.error('Asset column update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete custom column
router.delete('/asset-column/:columnId', async (req, res) => {
  try {
    const { columnId } = req.params;

    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM user_asset_columns WHERE id = $1',
      [columnId]
    );

    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM user_asset_columns WHERE id = $1', [columnId]);

    res.json({ message: 'Column deleted successfully' });
  } catch (error) {
    console.error('Asset column deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Plural aliases for frontend compatibility
router.post('/assets', (req, res, next) => {
  req.url = '/asset';
  router.handle(req, res, next);
});

router.get('/assets/:userId', (req, res, next) => {
  req.url = `/asset/${req.params.userId}`;
  router.handle(req, res, next);
});

router.put('/assets/:assetId', (req, res, next) => {
  req.url = `/asset/${req.params.assetId}`;
  router.handle(req, res, next);
});

router.delete('/assets/:assetId', (req, res, next) => {
  req.url = `/asset/${req.params.assetId}`;
  router.handle(req, res, next);
});

// Column aliases for frontend compatibility
router.post('/asset-columns', (req, res, next) => {
  req.url = '/asset-column';
  router.handle(req, res, next);
});

router.put('/asset-columns/:columnId', (req, res, next) => {
  req.url = `/asset-column/${req.params.columnId}`;
  router.handle(req, res, next);
});

router.delete('/asset-columns/:columnId', (req, res, next) => {
  req.url = `/asset-column/${req.params.columnId}`;
  router.handle(req, res, next);
});

// ==================== WORK ASSETS ROUTES ====================

// Create work asset
router.post('/work-asset', async (req, res) => {
  try {
    const { stream, amount, growthRate, endAge, notes, color } = req.body;
    
    // Get user's profile_id
    const profileResult = await pool.query(
      'SELECT id FROM financial_profile WHERE user_id = $1',
      [req.user.id]
    );

    let profileId;
    if (profileResult.rows.length === 0) {
      const created = await pool.query(
        'INSERT INTO financial_profile (user_id, age, lifespan_years, income_growth_rate, asset_growth_rate) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, 32, 85, 0.08, 0.11]
      );
      profileId = created.rows[0].id;
    } else {
      profileId = profileResult.rows[0].id;
    }
    
    const result = await insertWorkAssetRow({
      userId: req.user.id,
      profileId,
      stream,
      amount,
      growthRate,
      endAge,
      notes,
      color,
    });
    
    // Map database fields to frontend field names
    const mappedAsset = {
      id: result.rows[0].id,
      stream: result.rows[0].stream,
      amount: result.rows[0].amount,
      growthRate: result.rows[0].growth_rate,
      endAge: result.rows[0].end_age,
      notes: result.rows[0].notes,
      color: result.rows[0].color,
      user_id: result.rows[0].user_id,
      profile_id: result.rows[0].profile_id,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    };
    
    res.status(201).json(mappedAsset);
  } catch (error) {
    console.error('Work asset creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get work assets for user
router.get('/work-assets/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const result = await pool.query(
      'SELECT * FROM work_assets WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    
    // Map database fields to frontend field names
    const mappedAssets = result.rows.map(asset => ({
      id: asset.id,
      stream: asset.stream,
      amount: asset.amount,
      growthRate: asset.growth_rate,
      endAge: asset.end_age,
      notes: asset.notes,
      color: asset.color,
      user_id: asset.user_id,
      profile_id: asset.profile_id,
      created_at: asset.created_at,
      updated_at: asset.updated_at
    }));
    
    res.json(mappedAssets);
  } catch (error) {
    console.error('Work assets fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update work asset
router.put('/work-asset/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    const { stream, amount, growthRate, endAge, notes, color } = req.body;
    
    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM work_assets WHERE id = $1',
      [assetId]
    );
    
    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Work asset not found' });
    }
    
    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (stream !== undefined) {
      updates.push(`stream = $${paramCount}`);
      values.push(stream);
      paramCount++;
    }
    if (amount !== undefined) {
      updates.push(`amount = $${paramCount}`);
      values.push(amount);
      paramCount++;
    }
    if (growthRate !== undefined) {
      updates.push(`growth_rate = $${paramCount}`);
      values.push(growthRate);
      paramCount++;
    }
    if (endAge !== undefined) {
      updates.push(`end_age = $${paramCount}`);
      values.push(endAge);
      paramCount++;
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      values.push(notes);
      paramCount++;
    }
    if (color !== undefined) {
      updates.push(`color = $${paramCount}`);
      values.push(color);
      paramCount++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(assetId);
    
    const query = `UPDATE work_assets SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    
    // Map database fields to frontend field names
    const mappedAsset = {
      id: result.rows[0].id,
      stream: result.rows[0].stream,
      amount: result.rows[0].amount,
      growthRate: result.rows[0].growth_rate,
      endAge: result.rows[0].end_age,
      notes: result.rows[0].notes,
      color: result.rows[0].color,
      user_id: result.rows[0].user_id,
      profile_id: result.rows[0].profile_id,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at
    };
    
    res.json(mappedAsset);
  } catch (error) {
    console.error('Work asset update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete work asset
router.delete('/work-asset/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    
    // Check ownership
    const ownershipResult = await pool.query(
      'SELECT user_id FROM work_assets WHERE id = $1',
      [assetId]
    );
    
    if (ownershipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Work asset not found' });
    }
    
    if (ownershipResult.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    await pool.query('DELETE FROM work_assets WHERE id = $1', [assetId]);
    
    res.json({ message: 'Work asset deleted successfully' });
  } catch (error) {
    console.error('Work asset deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const plannedLoanFields = (body) => ({
  lender: body.lender ?? body.prov ?? null,
  name: body.name ?? null,
  type: body.type ?? body.cat ?? null,
  principal: body.principal ?? body.bal ?? body.principal_outstanding ?? 0,
  rate: body.rate ?? 0,
  emi: body.emi ?? 0,
  frequency: body.frequency ?? body.freq ?? 'Monthly',
  start_year: body.start_year ?? body.start ?? null,
  notes: body.notes ?? null
});

router.post('/planned-loan', async (req, res) => {
  try {
    const profileId = req.body.profile_id || req.body.profileId || await latestProfileId(req.user.id);
    const row = plannedLoanFields(req.body);
    const result = await pool.query(
      `INSERT INTO planned_loan
        (user_id, profile_id, lender, name, type, principal, rate, emi, frequency, start_year, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, profileId, row.lender, row.name, row.type, row.principal, row.rate, row.emi, row.frequency, row.start_year, row.notes]
    );
    res.status(201).json({ plannedLoan: result.rows[0] });
  } catch (error) {
    console.error('Planned loan create error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/planned-loans/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const result = await pool.query(
      'SELECT * FROM planned_loan WHERE user_id = $1 ORDER BY start_year NULLS LAST, created_at DESC',
      [userId]
    );
    res.json({ plannedLoans: result.rows });
  } catch (error) {
    console.error('Planned loans fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/planned-loan/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    const ownership = await pool.query('SELECT user_id FROM planned_loan WHERE id = $1', [loanId]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Planned loan not found' });
    if (ownership.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    const allowed = ['lender', 'name', 'type', 'principal', 'rate', 'emi', 'frequency', 'start_year', 'notes', 'prov', 'cat', 'bal', 'freq', 'start'];
    const map = { prov: 'lender', cat: 'type', bal: 'principal', freq: 'frequency', start: 'start_year' };
    const updates = [];
    const values = [];
    let n = 1;
    const used = new Set();
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.includes(key) || value === undefined) continue;
      const col = map[key] || key;
      if (used.has(col)) continue;
      updates.push(`${col} = $${n++}`);
      values.push(value);
      used.add(col);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(loanId);
    const result = await pool.query(
      `UPDATE planned_loan SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${n} RETURNING *`,
      values
    );
    res.json({ plannedLoan: result.rows[0] });
  } catch (error) {
    console.error('Planned loan update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/planned-loan/:loanId', async (req, res) => {
  try {
    const { loanId } = req.params;
    const ownership = await pool.query('SELECT user_id FROM planned_loan WHERE id = $1', [loanId]);
    if (ownership.rows.length === 0) return res.status(404).json({ error: 'Planned loan not found' });
    if (ownership.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM planned_loan WHERE id = $1', [loanId]);
    res.json({ message: 'Planned loan deleted successfully' });
  } catch (error) {
    console.error('Planned loan delete error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/planned-loans', (req, res, next) => {
  req.url = '/planned-loan';
  router.handle(req, res, next);
});
router.put('/planned-loans/:loanId', (req, res, next) => {
  req.url = `/planned-loan/${req.params.loanId}`;
  router.handle(req, res, next);
});
router.delete('/planned-loans/:loanId', (req, res, next) => {
  req.url = `/planned-loan/${req.params.loanId}`;
  router.handle(req, res, next);
});

// Insurance routes (singular)
router.post('/insurance', [
  body('policy_type').optional().trim().isLength({ min: 1 }),
  body('cover').optional().isFloat({ min: 0 }),
  body('premium').optional().isFloat({ min: 0 }),
  body('frequency').optional().isIn(['Monthly', 'Quarterly', 'Yearly']),
  body('provider').optional().trim(),
  body('policy_number').optional().trim(),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const {
      policy_type,
      cover,
      premium,
      frequency = 'Yearly',
      provider,
      policy_number,
      start_date,
      end_date,
      notes
    } = req.body;

    // Get or create a default profile for the user
    let profileId;
    const profileResult = await pool.query(
      'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );

    if (profileResult.rows.length === 0) {
      // Create a default profile
      const newProfile = await pool.query(
        'INSERT INTO financial_profile (user_id, total_asset_gross_market_value, total_loan_outstanding_value, lifespan_years, income_growth_rate, asset_growth_rate) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [req.user.id, 0, 0, 85, 0.06, 0.06]
      );
      profileId = newProfile.rows[0].id;
    } else {
      profileId = profileResult.rows[0].id;
    }

    const result = await pool.query(
      'INSERT INTO financial_insurance (user_id, profile_id, policy_type, cover, premium, frequency, provider, policy_number, start_date, end_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [req.user.id, profileId, policy_type, cover, premium, frequency, provider, policy_number, start_date || null, end_date, notes]
    );

    const insuranceId = result.rows[0].id;

    // Create expense entry for premium (similar to loan EMI)
    if (premium && premium > 0) {
      try {
        // Convert premium to monthly if needed
        let monthlyPremium = premium;
        if (frequency === 'Yearly') monthlyPremium = premium / 12;
        else if (frequency === 'Quarterly') monthlyPremium = premium / 3;

        // Check if expense already exists for this insurance
        const existingExpense = await pool.query(
          'SELECT id FROM financial_expense WHERE insurance_id = $1',
          [insuranceId]
        );

        if (existingExpense.rows.length === 0) {
          // Create new expense
          await pool.query(
            `INSERT INTO financial_expense 
             (user_id, profile_id, insurance_id, description, amount, frequency, expiry, category, subcategory) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              req.user.id,
              profileId,
              insuranceId,
              `Insurance Premium - ${policy_type || 'Insurance'}`,
              monthlyPremium,
              'Monthly',
              end_date || null,
              'Insurance',
              'Premium'
            ]
          );
          console.log(`✅ Created expense for insurance ${insuranceId}: ${monthlyPremium}/month`);
        } else {
          console.log(`⚠️ Could not create expense for insurance ${insuranceId}: profileId is null`);
        }
      } catch (expenseError) {
        console.error(`❌ Error creating expense for insurance ${insuranceId}:`, expenseError);
        console.error('Error details:', expenseError.message, expenseError.stack);
        // Don't fail insurance creation if expense creation fails
      }
    }

    res.status(201).json({ insurance: result.rows[0] });
  } catch (error) {
    console.error('Insurance creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/insurance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      'SELECT * FROM financial_insurance WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({ insurance: result.rows });
  } catch (error) {
    console.error('Insurance fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/insurance/:insuranceId', [
  body('policy_type').optional().trim().isLength({ min: 1 }),
  body('cover').optional().isFloat({ min: 0 }),
  body('premium').optional().isFloat({ min: 0 }),
  body('frequency').optional().isIn(['Monthly', 'Quarterly', 'Yearly']),
  body('provider').optional().trim(),
  body('policy_number').optional().trim(),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const { insuranceId } = req.params;

    // Check ownership
    const insuranceCheck = await pool.query(
      'SELECT user_id FROM financial_insurance WHERE id = $1',
      [insuranceId]
    );

    if (insuranceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Insurance not found' });
    }

    if (insuranceCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    Object.entries(req.body).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const query = `UPDATE financial_insurance SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    values.push(insuranceId);

    const result = await pool.query(query, values);
    const updatedInsurance = result.rows[0];

    // Update or create expense entry for premium (similar to loan EMI)
    try {
      const premium = req.body.premium;
      const frequency = req.body.frequency || updatedInsurance.frequency;
      const end_date = req.body.end_date !== undefined ? req.body.end_date : updatedInsurance.end_date;
      const policy_type = req.body.policy_type || updatedInsurance.policy_type;

      if (premium !== undefined && premium > 0) {
        // Convert premium to monthly if needed
        let monthlyPremium = premium;
        if (frequency === 'Yearly') monthlyPremium = premium / 12;
        else if (frequency === 'Quarterly') monthlyPremium = premium / 3;

        // Check if expense exists for this insurance
        const existingExpense = await pool.query(
          'SELECT id FROM financial_expense WHERE insurance_id = $1',
          [insuranceId]
        );

        if (existingExpense.rows.length > 0) {
          // Update existing expense
          await pool.query(
            `UPDATE financial_expense 
             SET amount = $1, expiry = $2, description = $3, updated_at = NOW() 
             WHERE insurance_id = $4`,
            [
              monthlyPremium,
              end_date || null,
              `Insurance Premium - ${policy_type || 'Insurance'}`,
              insuranceId
            ]
          );
          console.log(`✅ Updated expense for insurance ${insuranceId}`);
        } else {
          // Create new expense
          const profileResult = await pool.query(
            'SELECT id FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
            [req.user.id]
          );
          const profileId = profileResult.rows.length > 0 ? profileResult.rows[0].id : null;

          if (profileId) {
            await pool.query(
              `INSERT INTO financial_expense 
               (user_id, profile_id, insurance_id, description, amount, frequency, expiry, category, subcategory) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                req.user.id,
                profileId,
                insuranceId,
                `Insurance Premium - ${policy_type || 'Insurance'}`,
                monthlyPremium,
                'Monthly',
                end_date || null,
                'Insurance',
                'Premium'
              ]
            );
            console.log(`✅ Created expense for insurance ${insuranceId}: ${monthlyPremium}/month`);
          } else {
            console.log(`⚠️ Could not create expense for insurance ${insuranceId}: profileId is null`);
          }
        }
      } else if (premium === 0 || premium === null) {
        // If premium is removed, delete the expense
        const deleteResult = await pool.query('DELETE FROM financial_expense WHERE insurance_id = $1', [insuranceId]);
        console.log(`✅ Deleted ${deleteResult.rowCount} expense(s) for insurance ${insuranceId} (premium removed)`);
      }
    } catch (expenseError) {
      console.error(`❌ Error handling expense for insurance ${insuranceId} update:`, expenseError);
      console.error('Error details:', expenseError.message, expenseError.stack);
      // Don't fail the insurance update if expense handling fails
    }

    res.json({ insurance: updatedInsurance });
  } catch (error) {
    console.error('Insurance update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/insurance/:insuranceId', async (req, res) => {
  try {
    const { insuranceId } = req.params;

    // Check ownership
    const insuranceCheck = await pool.query(
      'SELECT user_id FROM financial_insurance WHERE id = $1',
      [insuranceId]
    );

    if (insuranceCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Insurance not found' });
    }

    if (insuranceCheck.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete associated expense (if exists)
    try {
      const expenseDeleteResult = await pool.query('DELETE FROM financial_expense WHERE insurance_id = $1', [insuranceId]);
      console.log(`✅ Deleted ${expenseDeleteResult.rowCount} expense(s) for insurance ${insuranceId}`);
    } catch (expenseError) {
      console.error('Error deleting expense for insurance:', expenseError);
      // Continue with insurance deletion even if expense deletion fails
    }

    await pool.query('DELETE FROM financial_insurance WHERE id = $1', [insuranceId]);
    res.json({ message: 'Insurance deleted successfully' });
  } catch (error) {
    console.error('Insurance deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Insurance routes (plural - for compatibility)
router.post('/insurances', (req, res, next) => {
  req.url = '/insurance';
  router.handle(req, res, next);
});

router.get('/insurances/:userId', (req, res, next) => {
  req.url = `/insurance/${req.params.userId}`;
  router.handle(req, res, next);
});

router.put('/insurances/:insuranceId', (req, res, next) => {
  req.url = `/insurance/${req.params.insuranceId}`;
  router.handle(req, res, next);
});

router.delete('/insurances/:insuranceId', (req, res, next) => {
  req.url = `/insurance/${req.params.insuranceId}`;
  router.handle(req, res, next);
});

// ==================== EXPENSE CATEGORIES ROUTES ====================

// Get all expense categories (global + user-specific)
router.get('/expense-categories/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get global categories (user_id = 0) and user-specific categories
    const result = await pool.query(
      `SELECT id, user_id, category, subcategory, display_order, created_at
       FROM expense_categories 
       WHERE user_id = 0 OR user_id = $1
       ORDER BY user_id DESC, display_order, category, subcategory`,
      [userId]
    );

    res.json({ categories: result.rows });
  } catch (error) {
    console.error('Expense categories fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add new user-specific expense category
router.post('/expense-category', [
  body('category').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('subcategory').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { category, subcategory, display_order = 0 } = req.body;
    const userId = req.user.id;

    // Check if this category/subcategory combination already exists for this user
    const existing = await pool.query(
      'SELECT id FROM expense_categories WHERE user_id = $1 AND category = $2 AND subcategory = $3',
      [userId, category, subcategory]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'This category/subcategory combination already exists' });
    }

    const result = await pool.query(
      'INSERT INTO expense_categories (user_id, category, subcategory, display_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, category, subcategory, display_order]
    );

    res.status(201).json({ category: result.rows[0] });
  } catch (error) {
    console.error('Expense category creation error:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'This category/subcategory combination already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete user-specific expense category
router.delete('/expense-category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const userId = req.user.id;

    // Check ownership - only allow deletion of user-specific categories (user_id > 0)
    const categoryCheck = await pool.query(
      'SELECT id, user_id FROM expense_categories WHERE id = $1',
      [categoryId]
    );

    if (categoryCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (categoryCheck.rows[0].user_id === 0) {
      return res.status(403).json({ error: 'Cannot delete global categories' });
    }

    if (categoryCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM expense_categories WHERE id = $1', [categoryId]);

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Expense category deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== EXPENSE TAGS ROUTES ====================

// Get all expense tags for a user (grouped by tag_label)
router.get('/expense-tags/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!checkUserAccess(req, userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT id, user_id, tag_label, tag_name, display_order, created_at, updated_at
       FROM expense_tags 
       WHERE user_id = $1
       ORDER BY tag_label, display_order, tag_name`,
      [userId]
    );

    // Group by tag_label
    const groupedTags = {
      'For': [],
      'Lifestyle Level': [],
      'Payment From': []
    };

    result.rows.forEach(tag => {
      if (groupedTags[tag.tag_label]) {
        groupedTags[tag.tag_label].push(tag);
      }
    });

    res.json({ tags: groupedTags });
  } catch (error) {
    console.error('Expense tags fetch error:', error);
    if (error.code === '42P01') { // Table does not exist
      res.status(500).json({ error: 'Expense tags table does not exist. Please run migration script.' });
    } else {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
});

// Create new expense tag
router.post('/expense-tag', [
  body('tag_label').isIn(['For', 'Lifestyle Level', 'Payment From']),
  body('tag_name').notEmpty().trim().isLength({ min: 1, max: 255 }),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { tag_label, tag_name, display_order = 0 } = req.body;
    const userId = req.user.id;

    // Check if this tag already exists for this user
    const existing = await pool.query(
      'SELECT id FROM expense_tags WHERE user_id = $1 AND tag_label = $2 AND tag_name = $3',
      [userId, tag_label, tag_name.trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'This tag already exists' });
    }

    const result = await pool.query(
      'INSERT INTO expense_tags (user_id, tag_label, tag_name, display_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, tag_label, tag_name.trim(), display_order]
    );

    res.status(201).json({ tag: result.rows[0] });
  } catch (error) {
    console.error('Expense tag creation error:', error);
    if (error.code === '23505') { // Unique constraint violation
      res.status(400).json({ error: 'This tag already exists' });
    } else if (error.code === '42P01') { // Table does not exist
      res.status(500).json({ error: 'Expense tags table does not exist. Please run migration script.' });
    } else {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
});

// Delete expense tag
router.delete('/expense-tag/:tagId', async (req, res) => {
  try {
    const { tagId } = req.params;
    const userId = req.user.id;

    // Check ownership
    const tagCheck = await pool.query(
      'SELECT id FROM expense_tags WHERE id = $1 AND user_id = $2',
      [tagId, userId]
    );

    if (tagCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    await pool.query('DELETE FROM expense_tags WHERE id = $1', [tagId]);

    res.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Expense tag deletion error:', error);
    if (error.code === '42P01') { // Table does not exist
      res.status(500).json({ error: 'Expense tags table does not exist. Please run migration script.' });
    } else {
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
});

export default router;