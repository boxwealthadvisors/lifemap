import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { generateAdminToken, authenticateSuperAdmin, authenticateAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// ==================== SUPER ADMIN AUTHENTICATION ====================

// Super admin login
router.post('/super-admin/login', [
  body('username').notEmpty().trim(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, username, password_hash FROM super_admin WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const superAdmin = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, superAdmin.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateAdminToken(superAdmin.id, 'super_admin');
    
    res.json({
      message: 'Super admin login successful',
      user: {
        id: superAdmin.id,
        username: superAdmin.username,
        role: 'super_admin'
      },
      token
    });
  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ADMIN AUTHENTICATION ====================

// Admin login
router.post('/admin/login', [
  body('username').notEmpty().trim(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    console.log('🔐 Admin login attempt:', { username: req.body.username });
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { username, password } = req.body;

    const result = await pool.query(
      'SELECT id, username, password_hash, name, email, is_active FROM admin WHERE username = $1',
      [username]
    );

    console.log('🔍 Admin query result:', { found: result.rows.length > 0, username, totalAdmins: result.rows.length });

    if (result.rows.length === 0) {
      console.log('❌ Admin not found:', username);
      // Also check if there are any admins with similar usernames (case-insensitive)
      const similarCheck = await pool.query(
        'SELECT username FROM admin WHERE LOWER(username) = LOWER($1)',
        [username]
      );
      if (similarCheck.rows.length > 0) {
        console.log('⚠️ Found admin with similar username (case mismatch):', similarCheck.rows[0].username);
        return res.status(401).json({ error: 'Invalid credentials - Username case mismatch. Please check your username.' });
      }
      return res.status(401).json({ error: 'Invalid credentials - Admin not found' });
    }

    const admin = result.rows[0];
    
    console.log('🔍 Admin details:', { id: admin.id, username: admin.username, is_active: admin.is_active, has_password_hash: !!admin.password_hash });
    
    if (!admin.is_active) {
      console.log('❌ Admin account inactive:', username);
      return res.status(403).json({ error: 'Admin account is inactive. Please contact super admin to activate your account.' });
    }

    if (!admin.password_hash) {
      console.log('❌ Admin has no password hash:', username);
      return res.status(500).json({ error: 'Admin account configuration error. Please contact support.' });
    }

    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    
    console.log('🔐 Password check:', { isValid: isValidPassword, passwordLength: password.length });

    if (!isValidPassword) {
      console.log('❌ Invalid password for admin:', username);
      // For debugging: log the first few characters of the stored hash (not the actual hash)
      console.log('🔍 Password hash info:', { hashLength: admin.password_hash.length, hashPrefix: admin.password_hash.substring(0, 10) + '...' });
      return res.status(401).json({ error: 'Invalid credentials - Wrong password' });
    }

    const token = generateAdminToken(admin.id, 'admin');
    
    console.log('✅ Admin login successful:', { id: admin.id, username: admin.username });
    
    res.json({
      message: 'Admin login successful',
      user: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        email: admin.email,
        role: 'admin'
      },
      token
    });
  } catch (error) {
    console.error('❌ Admin login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// ==================== ADMIN PROFILE ====================

// Get current admin profile
router.get('/admin/profile', authenticateAdmin, async (req, res) => {
  try {
    // req.admin is already set by authenticateAdmin middleware
    res.json({
      admin: {
        id: req.admin.id,
        username: req.admin.username,
        name: req.admin.name,
        email: req.admin.email,
        role: req.admin.role,
        is_active: req.admin.is_active
      }
    });
  } catch (error) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Advisor updates their own username, name, email, and/or password
router.put('/admin/profile', authenticateAdmin, [
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3 }),
  body('name').optional({ values: 'falsy' }).trim(),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email or leave it blank'),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('current_password').optional({ values: 'falsy' })
], async (req, res) => {
  try {
    if (req.admin.role !== 'admin') {
      return res.status(403).json({ error: 'Use the super admin account settings for this login' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const username = req.body.username ? String(req.body.username).trim() : undefined;
    const name = req.body.name !== undefined ? (String(req.body.name).trim() || null) : undefined;
    const email = req.body.email !== undefined ? (String(req.body.email).trim() || null) : undefined;
    const password = req.body.password || undefined;
    const currentPassword = req.body.current_password;

    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set a new password' });
      }
      const hashRow = await pool.query('SELECT password_hash FROM admin WHERE id = $1', [req.admin.id]);
      const ok = await bcrypt.compare(currentPassword, hashRow.rows[0].password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      const taken = await pool.query('SELECT id FROM admin WHERE username = $1 AND id != $2', [username, req.admin.id]);
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (password) {
      updates.push(`password_hash = $${paramCount++}`);
      values.push(await bcrypt.hash(password, 12));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.admin.id);
    const result = await pool.query(
      `UPDATE admin SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, name, email, is_active`,
      values
    );

    res.json({
      message: 'Account updated',
      admin: { ...result.rows[0], role: 'admin' }
    });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Super admin updates their own username and/or password
router.put('/super-admin/profile', authenticateSuperAdmin, [
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3 }),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('current_password').optional({ values: 'falsy' })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const username = req.body.username ? String(req.body.username).trim() : undefined;
    const password = req.body.password || undefined;
    const currentPassword = req.body.current_password;

    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to set a new password' });
      }
      const hashRow = await pool.query('SELECT password_hash FROM super_admin WHERE id = $1', [req.admin.id]);
      const ok = await bcrypt.compare(currentPassword, hashRow.rows[0].password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      const taken = await pool.query('SELECT id FROM super_admin WHERE username = $1 AND id != $2', [username, req.admin.id]);
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (password) {
      updates.push(`password_hash = $${paramCount++}`);
      values.push(await bcrypt.hash(password, 12));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');
    values.push(req.admin.id);
    const result = await pool.query(
      `UPDATE super_admin SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username`,
      values
    );

    res.json({
      message: 'Account updated',
      admin: { ...result.rows[0], role: 'super_admin' }
    });
  } catch (error) {
    console.error('Error updating super admin profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SUPER ADMIN - ADMIN MANAGEMENT ====================

// Get all admins (super admin only)
router.get('/super-admin/admins', authenticateSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.id, a.username, a.name, a.email, a.is_active, a.created_at, a.updated_at,
             COUNT(u.id) as user_count
      FROM admin a
      LEFT JOIN "user" u ON u.admin_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);

    res.json({ admins: result.rows });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create admin (super admin only)
router.post('/super-admin/admins', authenticateSuperAdmin, [
  body('username').notEmpty().trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').optional({ values: 'falsy' }).trim(),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Enter a valid email or leave it blank')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { username, password } = req.body;
    const name = req.body.name && String(req.body.name).trim() ? String(req.body.name).trim() : null;
    const email = req.body.email && String(req.body.email).trim() ? String(req.body.email).trim() : null;

    // Check if admin already exists
    const existing = await pool.query(
      'SELECT id FROM admin WHERE username = $1',
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Admin username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Get super admin ID from the authenticated admin
    // If the current admin is a super admin, use their ID, otherwise use null
    const superAdminId = req.admin.role === 'super_admin' ? req.admin.id : null;

    // Try to insert with super_admin_id first (correct column name)
    // If that fails, try with created_by (for backwards compatibility)
    let result;
    try {
      result = await pool.query(
        'INSERT INTO admin (username, password_hash, name, email, super_admin_id, created_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, username, name, email, is_active, created_at',
        [username, passwordHash, name, email, superAdminId]
      );
    } catch (insertError) {
      const msg = insertError.message || '';
      if (msg.includes('super_admin_id') || msg.includes('created_by')) {
        console.log('⚠️ Admin owner column missing, inserting without it:', msg);
        result = await pool.query(
          'INSERT INTO admin (username, password_hash, name, email) VALUES ($1, $2, $3, $4) RETURNING id, username, name, email, is_active, created_at',
          [username, passwordHash, name, email]
        );
      } else {
        throw insertError;
      }
    }

    console.log('✅ Admin created successfully:', { id: result.rows[0].id, username: result.rows[0].username, is_active: result.rows[0].is_active });

    res.status(201).json({
      message: 'Admin created successfully',
      admin: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error creating admin:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Update admin (super admin only)
router.put('/super-admin/admins/:adminId', authenticateSuperAdmin, [
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3 }),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }),
  body('name').optional({ values: 'falsy' }).trim(),
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { adminId } = req.params;
    const { username, password, name, email, is_active } = req.body;

    // Check if admin exists
    const existing = await pool.query(
      'SELECT id FROM admin WHERE id = $1',
      [adminId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Build update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      // Check if username is already taken by another admin
      const usernameCheck = await pool.query(
        'SELECT id FROM admin WHERE username = $1 AND id != $2',
        [username, adminId]
      );
      if (usernameCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }

    if (password !== undefined) {
      const passwordHash = await bcrypt.hash(password, 12);
      updates.push(`password_hash = $${paramCount++}`);
      values.push(passwordHash);
    }

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (email !== undefined) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(adminId);

    const query = `UPDATE admin SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, name, email, is_active, created_at, updated_at`;
    const result = await pool.query(query, values);

    res.json({
      message: 'Admin updated successfully',
      admin: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete admin (super admin only)
router.delete('/super-admin/admins/:adminId', authenticateSuperAdmin, async (req, res) => {
  try {
    const { adminId } = req.params;

    // Check if admin exists
    const existing = await pool.query(
      'SELECT id FROM admin WHERE id = $1',
      [adminId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Remove admin_id from users (set to NULL)
    await pool.query(
      'UPDATE "user" SET admin_id = NULL WHERE admin_id = $1',
      [adminId]
    );

    // Delete admin
    await pool.query('DELETE FROM admin WHERE id = $1', [adminId]);

    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SUPER ADMIN - USER MANAGEMENT ====================

// Transfer user to different admin (super admin only)
router.put('/super-admin/users/:userId/transfer', authenticateSuperAdmin, [
  body('admin_id').isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { userId } = req.params;
    const { admin_id } = req.body;

    // Check if user exists
    const userCheck = await pool.query(
      'SELECT id FROM "user" WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If admin_id is null, remove assignment. Otherwise verify admin exists
    if (admin_id !== null) {
      const adminCheck = await pool.query(
        'SELECT id FROM admin WHERE id = $1',
        [admin_id]
      );

      if (adminCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Admin not found' });
      }
    }

    await pool.query(
      'UPDATE "user" SET admin_id = $1 WHERE id = $2',
      [admin_id, userId]
    );

    res.json({ message: 'User transferred successfully' });
  } catch (error) {
    console.error('Error transferring user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users with their admin assignments (super admin only)
router.get('/super-admin/users', authenticateSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.created_at,
             a.id as admin_id, a.username as admin_username, a.name as admin_name
      FROM "user" u
      LEFT JOIN admin a ON u.admin_id = a.id
      ORDER BY u.created_at DESC
    `);

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ADMIN - USER MANAGEMENT ====================

// Get users assigned to admin
router.get('/admin/users', authenticateAdmin, async (req, res) => {
  try {
    console.log('🔍 Fetching users for admin:', { adminId: req.admin.id, adminUsername: req.admin.username });
    
    const result = await pool.query(
      'SELECT id, email, name, created_at, admin_id FROM "user" WHERE admin_id = $1 ORDER BY created_at DESC',
      [req.admin.id]
    );

    console.log('✅ Found users:', { count: result.rows.length, adminId: req.admin.id });
    if (result.rows.length > 0) {
      console.log('📋 Users:', result.rows.map(u => ({ id: u.id, email: u.email, name: u.name, admin_id: u.admin_id })));
    } else {
      // Also check if there are any users with null admin_id that might need to be assigned
      const unassignedCheck = await pool.query(
        'SELECT COUNT(*) as count FROM "user" WHERE admin_id IS NULL'
      );
      console.log('ℹ️ Unassigned users:', unassignedCheck.rows[0]?.count || 0);
    }

    res.json({ users: result.rows });
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create user (admin only)
router.post('/admin/users', authenticateAdmin, [
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { email, password, name } = req.body;

    // Check if user already exists
    const existing = await pool.query(
      'SELECT id FROM "user" WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      'INSERT INTO "user" (email, password_hash, name, admin_id, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, email, name, created_at',
      [email, passwordHash, name, req.admin.id]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a client assigned to this admin (name, email, password reset)
router.put('/admin/users/:userId', authenticateAdmin, [
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('name').optional({ values: 'falsy' }).trim().isLength({ min: 2 }),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    if (req.admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { userId } = req.params;
    const userCheck = await pool.query(
      'SELECT id, admin_id FROM "user" WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userCheck.rows[0].admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    }

    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;
    const name = req.body.name ? String(req.body.name).trim() : undefined;
    const password = req.body.password || undefined;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (email !== undefined) {
      const taken = await pool.query('SELECT id FROM "user" WHERE LOWER(email) = $1 AND id != $2', [email, userId]);
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Another user already uses this email' });
      }
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (password) {
      updates.push(`password_hash = $${paramCount++}`);
      values.push(await bcrypt.hash(password, 12));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = NOW()');
    values.push(userId);
    const result = await pool.query(
      `UPDATE "user" SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, email, name, created_at, updated_at`,
      values
    );

    res.json({
      message: password ? 'User updated. Give them the new password privately.' : 'User updated',
      user: result.rows[0],
      password_reset: Boolean(password)
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user (admin only - only users assigned to them)
router.delete('/admin/users/:userId', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if user exists and is assigned to this admin
    const userCheck = await pool.query(
      'SELECT id, admin_id FROM "user" WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userCheck.rows[0].admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    }

    // Delete user (CASCADE will handle related data)
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile (admin can view any user assigned to them)
router.get('/admin/users/:userId/profile', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify user is assigned to this admin
    const userCheck = await pool.query(
      'SELECT id, admin_id FROM "user" WHERE id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (userCheck.rows[0].admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    }

    // Get financial profile
    const profileResult = await pool.query(
      'SELECT * FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    res.json({ profile: profileResult.rows[0] || null });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

