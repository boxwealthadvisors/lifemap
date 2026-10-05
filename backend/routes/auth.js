import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { generateAdminToken } from '../middleware/adminAuth.js';
import { sendMail } from '../lib/mailer.js';

const router = express.Router();

const OTP_PURPOSE = 'signup';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 45 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests. Try again later.' },
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashOtp(email, code) {
  const secret = process.env.JWT_SECRET || 'lifemap-otp';
  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

function otpMatches(email, code, storedHash) {
  const a = Buffer.from(hashOtp(email, code));
  const b = Buffer.from(String(storedHash || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function consumeValidOtp(email, code) {
  const result = await pool.query(
    `SELECT id, code_hash, expires_at, attempts
     FROM email_otp
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, OTP_PURPOSE]
  );
  const row = result.rows[0];
  if (!row) return { error: 'Enter the code we emailed you', status: 400 };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { error: 'That code has expired. Request a new one.', status: 400 };
  }
  if ((row.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    return { error: 'Too many incorrect codes. Request a new one.', status: 400 };
  }
  if (!otpMatches(email, code, row.code_hash)) {
    await pool.query('UPDATE email_otp SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    return { error: 'That code is incorrect', status: 400 };
  }
  return { id: row.id };
}

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

router.post('/otp', otpLimiter, [
  body('email').isEmail().withMessage('Enter a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0]?.msg || 'Enter a valid email address' });
    }

    const email = normalizeEmail(req.body.email);
    const existing = await pool.query(
      'SELECT id FROM "user" WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const latest = await pool.query(
      `SELECT created_at FROM email_otp
       WHERE email = $1 AND purpose = $2
       ORDER BY created_at DESC LIMIT 1`,
      [email, OTP_PURPOSE]
    );
    const lastSent = latest.rows[0]?.created_at ? new Date(latest.rows[0].created_at).getTime() : 0;
    if (lastSent && Date.now() - lastSent < OTP_RESEND_MS) {
      return res.status(429).json({ error: 'Wait a moment before requesting another code.' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `UPDATE email_otp SET consumed_at = NOW()
       WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [email, OTP_PURPOSE]
    );
    await pool.query(
      `INSERT INTO email_otp (email, code_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, hashOtp(email, code), OTP_PURPOSE, new Date(Date.now() + OTP_TTL_MS)]
    );

    try {
      await sendMail({
        to: email,
        subject: 'Your LifeMap sign-up code',
        text: `Your LifeMap verification code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>Your LifeMap verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
      });
    } catch (mailError) {
      console.error('OTP email failed:', mailError);
      return res.status(503).json({ error: 'Could not send the verification email. Try again later.' });
    }

    const payload = { message: 'We sent a 6-digit code to your email.' };
    if (process.env.NODE_ENV !== 'production') {
      payload.devCode = code;
      console.log(`[otp] ${email} → ${code}`);
    }
    return res.json(payload);
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register', [
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('name').trim().isLength({ min: 2 }).withMessage('Enter your name'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('otp').optional(),
  body('code').optional()
], async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed' });
    }

    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    const code = String(req.body.otp || req.body.code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'Enter the 6-digit code we emailed you' });
    }

    const otp = await consumeValidOtp(email, code);
    if (otp.error) {
      return res.status(otp.status).json({ error: otp.error });
    }

    const existing = await client.query(
      'SELECT id FROM "user" WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO "user" (email, password_hash, name, admin_id, created_at)
       VALUES ($1, $2, $3, NULL, NOW())
       RETURNING id, email, name, created_at`,
      [email, passwordHash, name]
    );
    const user = userResult.rows[0];
    await client.query(
      `INSERT INTO financial_profile
         (user_id, age, lifespan_years, income_growth_rate, asset_growth_rate, inflation_rate, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [user.id, 32, 85, 0.08, 0.11, 0.06]
    );
    await client.query('UPDATE email_otp SET consumed_at = NOW() WHERE id = $1', [otp.id]);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Account created',
      role: 'client',
      token: generateToken(user.id),
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('Register error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
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
