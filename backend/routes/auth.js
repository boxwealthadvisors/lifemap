import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { generateAdminToken } from '../middleware/adminAuth.js';

const router = express.Router();

async function findByUsername(table, username) {
  const exact = await pool.query(
    `SELECT * FROM ${table} WHERE username = $1 LIMIT 1`,
    [username]
  );
  if (exact.rows[0]) return exact.rows[0];
  const loose = await pool.query(
    `SELECT * FROM ${table} WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [username]
  );
  return loose.rows[0] || null;
}

async function tryClientLogin(identifier, password) {
  const email = identifier.trim().toLowerCase();
  if (!email.includes('@')) return null;
  const result = await pool.query(
    'SELECT id, email, name, password_hash FROM "user" WHERE LOWER(email) = $1',
    [email]
  );
  if (!result.rows[0]) return null;
  const user = result.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return { miss: true };
  return {
    hit: {
      role: 'client',
      token: generateToken(user.id),
      user: { id: user.id, email: user.email, name: user.name }
    }
  };
}

async function tryAdminLogin(identifier, password) {
  const admin = await findByUsername('admin', identifier.trim());
  if (!admin) return null;
  const ok = await bcrypt.compare(password, admin.password_hash || '');
  if (!ok) return { miss: true };
  if (!admin.is_active) return { inactive: true };
  return {
    hit: {
      role: 'admin',
      token: generateAdminToken(admin.id, 'admin'),
      user: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        email: admin.email,
        role: 'admin'
      }
    }
  };
}

async function trySuperAdminLogin(identifier, password) {
  const superAdmin = await findByUsername('super_admin', identifier.trim());
  if (!superAdmin) return null;
  const ok = await bcrypt.compare(password, superAdmin.password_hash || '');
  if (!ok) return { miss: true };
  return {
    hit: {
      role: 'super_admin',
      token: generateAdminToken(superAdmin.id, 'super_admin'),
      user: {
        id: superAdmin.id,
        username: superAdmin.username,
        role: 'super_admin'
      }
    }
  };
}

// Public self-signup is closed. Admins create users from /admin.
router.post('/register', (req, res) => {
  return res.status(403).json({ error: 'Accounts are created by an admin' });
});

// Unified login: client (email), advisor (username), or super admin (username)
router.post('/login', [
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const identifier = String(req.body.identifier || req.body.email || req.body.username || '').trim();
    const { password } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Enter your email or username' });
    }

    const order = identifier.includes('@')
      ? [tryClientLogin, tryAdminLogin, trySuperAdminLogin]
      : [tryAdminLogin, trySuperAdminLogin, tryClientLogin];

    for (const attempt of order) {
      const result = await attempt(identifier, password);
      if (!result) continue;
      if (result.inactive) {
        return res.status(403).json({ error: 'Admin account is inactive. Please contact super admin to activate your account.' });
      }
      if (result.hit) {
        return res.json({
          message: 'Login successful',
          role: result.hit.role,
          user: result.hit.user,
          token: result.hit.token
        });
      }
    }

    return res.status(401).json({ error: 'Invalid credentials' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', authenticateToken, (req, res) => {
  // In a stateless JWT system, logout is handled client-side
  // You could implement a token blacklist here if needed
  res.json({ message: 'Logout successful' });
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM "user" WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({ 
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('name').optional().trim().isLength({ min: 2 }),
  body('email').optional().isEmail().withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { name, email } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (email) {
      // Check if email is already taken by another user
      const existingUser = await pool.query(
        'SELECT id FROM "user" WHERE email = $1 AND id != $2',
        [email, req.user.id]
      );

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: 'Email already taken' });
      }

      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(req.user.id);
    const query = `UPDATE "user" SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING id, email, name, created_at, updated_at`;

    const result = await pool.query(query, values);

    const user = result.rows[0];
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    
    // Handle specific database constraint violations
    if (error.code === '23505') { // Unique constraint violation
      if (error.constraint === 'user_email_key') {
        return res.status(400).json({ error: 'Email already exists. Please use a different email address.' });
      } else {
        return res.status(400).json({ error: 'This information is already in use. Please check your details and try again.' });
      }
    } else if (error.code === '23503') { // Foreign key constraint violation
      return res.status(400).json({ error: 'Invalid data provided. Please check your information.' });
    } else if (error.code === '23514') { // Check constraint violation
      return res.status(400).json({ error: 'Invalid data format. Please check your input.' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
router.post('/change-password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const result = await pool.query(
      'SELECT password_hash FROM "user" WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.query(
      'UPDATE "user" SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Password change error:', error);
    
    // Handle specific database errors
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'Password update failed due to data conflict.' });
    } else if (error.code === '23503') { // Foreign key constraint violation
      return res.status(400).json({ error: 'Invalid user account.' });
    } else if (error.code === '23514') { // Check constraint violation
      return res.status(400).json({ error: 'Password does not meet requirements.' });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
