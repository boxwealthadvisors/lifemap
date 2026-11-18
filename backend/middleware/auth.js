import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { isSessionValid, touchSession } from '../lib/security.js';

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Only fully authenticated client tokens are accepted (never pending-OTP or staff tokens)
    if (decoded.pending || decoded.role !== 'client' || !decoded.userId || !decoded.jti) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const sessionOk = await isSessionValid(decoded.jti, 'client', decoded.userId);
    if (!sessionOk) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    // Verify user still exists and has not been deleted
    const result = await pool.query(
      'SELECT id, email, name, deleted_at, session_version FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    await touchSession(decoded.jti);

    req.user = result.rows[0];
    req.auth = { jti: decoded.jti, role: 'client' };
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const generateToken = (userId, jti) => {
  return jwt.sign({ userId, role: 'client', jti }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};
