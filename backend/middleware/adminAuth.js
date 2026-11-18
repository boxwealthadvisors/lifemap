import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { isSessionValid, touchSession } from '../lib/security.js';

// Generate token for admin/super admin
export const generateAdminToken = (id, role, jti) => {
  return jwt.sign({ adminId: id, role, jti }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

function bearerToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
}

// Verify JWT + server-side session and load the staff account. Returns { admin } or { status, error }.
async function resolveStaff(token, allowedRoles) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  if (decoded.pending || !decoded.adminId || !decoded.jti) {
    return { status: 403, error: 'Invalid or expired token' };
  }
  if (!allowedRoles.includes(decoded.role)) {
    return {
      status: 403,
      error: allowedRoles.length === 1 && allowedRoles[0] === 'super_admin'
        ? 'Super admin access required'
        : 'Admin access required'
    };
  }

  const sessionOk = await isSessionValid(decoded.jti, decoded.role, decoded.adminId);
  if (!sessionOk) {
    return { status: 401, error: 'Session expired. Please sign in again.' };
  }

  let admin;
  if (decoded.role === 'super_admin') {
    const result = await pool.query(
      'SELECT id, username, email, session_version FROM super_admin WHERE id = $1',
      [decoded.adminId]
    );
    if (result.rows.length === 0) {
      return { status: 401, error: 'Super admin not found' };
    }
    admin = result.rows[0];
  } else {
    const result = await pool.query(
      'SELECT id, username, name, email, is_active, deleted_at, session_version FROM admin WHERE id = $1 AND deleted_at IS NULL',
      [decoded.adminId]
    );
    if (result.rows.length === 0) {
      return { status: 401, error: 'Admin not found' };
    }
    if (!result.rows[0].is_active) {
      return { status: 403, error: 'Admin account is inactive' };
    }
    admin = result.rows[0];
  }

  await touchSession(decoded.jti);
  admin.role = decoded.role;
  return { admin, jti: decoded.jti };
}

async function run(req, res, next, allowedRoles) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const resolved = await resolveStaff(token, allowedRoles);
    if (resolved.error) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    req.admin = resolved.admin;
    req.auth = { jti: resolved.jti, role: resolved.admin.role };
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Authenticate super admin
export const authenticateSuperAdmin = (req, res, next) => run(req, res, next, ['super_admin']);

// Authenticate admin (works for both admin and super admin)
export const authenticateAdmin = (req, res, next) => run(req, res, next, ['admin', 'super_admin']);
