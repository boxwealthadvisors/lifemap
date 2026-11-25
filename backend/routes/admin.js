import express from 'express';
import bcrypt from 'bcryptjs';
import { body, param, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { authenticateSuperAdmin, authenticateAdmin } from '../middleware/adminAuth.js';
import { notifyEmail } from '../lib/notify.js';
import {
  INVITE_TTL_MS,
  PRIVACY_CONTACT,
  RESET_TTL_MS,
  consumeOtp,
  createResetOrInviteToken,
  isBoxWealthEmail,
  isRegisterEntity,
  logActivity,
  logPlanView,
  newToken,
  normalizeEmail,
  purgeRegisterItemsForUser,
  resetLink,
  restoreRegisterRow,
  revokeAllSessions,
  softDeleteEntity,
  validateStrongPassword,
} from '../lib/security.js';
import {
  archiveActivityLogDay,
  getLogArchiveCsv,
  listLogArchives,
  runDailyLogArchive,
} from '../lib/logArchive.js';

const router = express.Router();

// ==================== HELPERS ====================

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed', details: errors.array() });
  return true;
}

const idParam = (name) => param(name).isInt({ min: 1 }).withMessage('Invalid id').toInt();

const boxWealthEmail = (field, { optional = false } = {}) => {
  let chain = body(field);
  if (optional) chain = chain.optional({ values: 'falsy' });
  return chain
    .trim()
    .isEmail().withMessage('Enter a valid email address')
    .bail()
    .custom((value) => {
      if (!isBoxWealthEmail(value)) throw new Error('Admin email must be a @boxwealth.in address');
      return true;
    });
};

async function withTx(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  } finally {
    db.release();
  }
}

const actorOf = (req) => ({
  actorRole: req.admin.role,
  actorId: req.admin.id,
  actorLabel: req.admin.username,
});

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '';
  return `${local.slice(0, 1)}***@${domain}`;
}

async function unusablePasswordHash() {
  return bcrypt.hash(newToken(), 12);
}

async function getActiveAdmin(adminId) {
  const result = await pool.query(
    `SELECT id, username, name, email FROM admin
     WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [adminId]
  );
  return result.rows[0] || null;
}

async function countClients(adminId) {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS c FROM "user" WHERE admin_id = $1 AND deleted_at IS NULL',
    [adminId]
  );
  return result.rows[0].c;
}

// Sends an invite (never signed in before) or reset link. Never throws.
async function sendAccessLink(role, account) {
  if (!account.email) return { sent: false, reason: 'no_email' };
  const purpose = account.last_login_at ? 'reset' : 'invite';
  const token = await createResetOrInviteToken({
    role,
    subjectId: account.id,
    email: account.email,
    purpose,
    ttlMs: purpose === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS,
  });
  const link = resetLink(token, purpose);
  const sent = await notifyEmail(
    account.email,
    purpose === 'invite' ? 'Set up your LifeMap password' : 'Reset your LifeMap password',
    purpose === 'invite'
      ? `An account was created for you on LifeMap.\n\nSet your password here (link valid for 48 hours):\n${link}`
      : `A password reset was requested for your LifeMap account by an administrator.\n\nChoose a new password here (link valid for 15 minutes):\n${link}\n\nIf you did not expect this, contact ${PRIVACY_CONTACT}.`
  );
  return { sent, purpose };
}

async function sendInvite(role, subjectId, email, label) {
  const token = await createResetOrInviteToken({
    role,
    subjectId,
    email,
    purpose: 'invite',
    ttlMs: INVITE_TTL_MS,
  });
  const link = resetLink(token, 'invite');
  return notifyEmail(
    email,
    'You have been invited to LifeMap',
    `${label}\n\nSet your password here (link valid for 48 hours):\n${link}\n\nIf you were not expecting this, ignore this email.`
  );
}

function userSnapshot(row) {
  const { password_hash: _ignored, ...rest } = row;
  return rest;
}

// Staff changing username / email / password: current password + an emailed "sensitive" code.
// Sends the error response itself and returns null when something is missing or wrong; otherwise returns
// `{ consume }`, which burns the emailed code (call it once the update is certain to go ahead).
async function checkSensitiveProof({ res, passwordHash, currentPassword, otp, emailOnFile }) {
  if (!currentPassword || !otp) {
    res.status(400).json({
      error: 'Changing your username, email or password needs your current password and the security code we email you',
      requires: ['current_password', 'otp'],
    });
    return null;
  }
  const ok = await bcrypt.compare(String(currentPassword), passwordHash || '');
  if (!ok) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return null;
  }
  if (!emailOnFile) {
    res.status(400).json({ error: 'No email address is on file for this account. Ask a super admin to add one first.' });
    return null;
  }
  return {
    consume: async () => {
      const code = await consumeOtp(emailOnFile, 'sensitive', otp);
      if (code.error) {
        res.status(code.status || 400).json({ error: code.error });
        return false;
      }
      return true;
    },
  };
}

async function notifySecurityChange({
  previousEmail, newEmail, label, contactHint, usernameChanging, previousUsername, username, passwordChanging,
}) {
  const parts = [];
  if (usernameChanging) parts.push(`Your username was changed from "${previousUsername}" to "${username}". `);
  if (passwordChanging) parts.push('Your password was changed. ');
  if (newEmail) parts.push(`Your email was changed to ${maskEmail(newEmail)}. `);
  await notifyEmail(
    previousEmail,
    `Your ${label} security settings changed`,
    `${parts.join('')}\n\nIf this was not you, ${contactHint}.`
  );
  if (newEmail) {
    await notifyEmail(newEmail, 'Your LifeMap email address was updated', `This address is now the contact email for your ${label}.`);
  }
}

// One activity entry per kind of change (username / email / password)
async function logSecurityChanges(req, kind, { usernameChanging, emailChanging, passwordChanging, previousUsername, username }) {
  const prefix = kind === 'super_admin' ? 'super_admin' : 'admin';
  const base = {
    ...actorOf(req),
    targetType: kind,
    targetId: req.admin.id,
    teamAdminId: kind === 'admin' ? req.admin.id : null,
  };
  if (usernameChanging) {
    await logActivity({ ...base, action: `${prefix}_username_changed`, meta: { from: previousUsername, to: username } });
  }
  if (emailChanging) {
    await logActivity({ ...base, action: `${prefix}_email_changed` });
  }
  if (passwordChanging) {
    await logActivity({ ...base, action: `${prefix}_password_changed` });
  }
}

// ==================== LEGACY LOGIN ENDPOINTS (superseded by OTP login) ====================

const loginMoved = (req, res) =>
  res.status(410).json({
    error: 'This sign-in endpoint was retired. Use POST /api/login and verify with POST /api/login/verify.',
  });

router.post('/super-admin/login', loginMoved);
router.post('/admin/login', loginMoved);

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
  boxWealthEmail('email', { optional: true }),
  body('password').optional({ values: 'falsy' }).custom((value) => {
    const problem = validateStrongPassword(value);
    if (problem) throw new Error(problem);
    return true;
  }),
  body('current_password').optional({ values: 'falsy' }),
  body('otp').optional({ values: 'falsy' }),
], async (req, res) => {
  try {
    if (req.admin.role !== 'admin') {
      return res.status(403).json({ error: 'Use the super admin account settings for this login' });
    }
    if (validationFailed(req, res)) return;

    const username = req.body.username ? String(req.body.username).trim() : undefined;
    const name = req.body.name !== undefined ? (String(req.body.name).trim() || null) : undefined;
    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;
    const password = req.body.password || undefined;
    const currentPassword = req.body.current_password;

    const currentRow = await pool.query('SELECT password_hash, email, username FROM admin WHERE id = $1', [req.admin.id]);
    const previousEmail = currentRow.rows[0]?.email || null;
    const previousUsername = currentRow.rows[0]?.username || null;
    const usernameChanging = username !== undefined && username !== previousUsername;
    const emailChanging = email !== undefined && email !== normalizeEmail(previousEmail);
    const passwordChanging = Boolean(password);
    const sensitiveChange = usernameChanging || emailChanging || passwordChanging;

    // ANY change to username, email or password needs the current password AND an emailed security code.
    let proof = null;
    if (sensitiveChange) {
      proof = await checkSensitiveProof({
        res,
        passwordHash: currentRow.rows[0]?.password_hash,
        currentPassword,
        otp: req.body.otp,
        emailOnFile: previousEmail,
      });
      if (!proof) return;
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (usernameChanging) {
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
    if (emailChanging) {
      const taken = await pool.query(
        'SELECT id FROM admin WHERE LOWER(email) = $1 AND id != $2 AND deleted_at IS NULL',
        [email, req.admin.id]
      );
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Email already in use by another admin' });
      }
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

    // Burn the emailed code only once we know the update will go ahead.
    if (proof && !(await proof.consume())) return;

    updates.push('updated_at = NOW()');
    values.push(req.admin.id);
    const result = await pool.query(
      `UPDATE admin SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, name, email, is_active`,
      values
    );

    if (passwordChanging) {
      await revokeAllSessions('admin', req.admin.id);
    }

    if (sensitiveChange) {
      await notifySecurityChange({
        previousEmail,
        newEmail: emailChanging ? email : null,
        label: 'LifeMap account',
        contactHint: 'contact a super admin immediately',
        usernameChanging,
        previousUsername,
        username,
        passwordChanging,
      });
      await logSecurityChanges(req, 'admin', { usernameChanging, emailChanging, passwordChanging, previousUsername, username });
    }

    res.json({
      message: passwordChanging ? 'Account updated. Sign in again with your new password.' : 'Account updated',
      reauthRequired: passwordChanging,
      admin: { ...result.rows[0], role: 'admin' }
    });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Super admin updates their own username, email, and/or password
router.put('/super-admin/profile', authenticateSuperAdmin, [
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3 }),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Enter a valid email address'),
  body('password').optional({ values: 'falsy' }).custom((value) => {
    const problem = validateStrongPassword(value);
    if (problem) throw new Error(problem);
    return true;
  }),
  body('current_password').optional({ values: 'falsy' }),
  body('otp').optional({ values: 'falsy' }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const username = req.body.username ? String(req.body.username).trim() : undefined;
    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;
    const password = req.body.password || undefined;
    const currentPassword = req.body.current_password;

    const currentRow = await pool.query('SELECT password_hash, email, username FROM super_admin WHERE id = $1', [req.admin.id]);
    const previousEmail = currentRow.rows[0]?.email || null;
    const previousUsername = currentRow.rows[0]?.username || null;
    const usernameChanging = username !== undefined && username !== previousUsername;
    const emailChanging = email !== undefined && email !== normalizeEmail(previousEmail);
    const passwordChanging = Boolean(password);
    const sensitiveChange = usernameChanging || emailChanging || passwordChanging;

    // ANY change to username, email or password needs the current password AND an emailed security code.
    let proof = null;
    if (sensitiveChange) {
      proof = await checkSensitiveProof({
        res,
        passwordHash: currentRow.rows[0]?.password_hash,
        currentPassword,
        otp: req.body.otp,
        emailOnFile: previousEmail,
      });
      if (!proof) return;
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (usernameChanging) {
      const taken = await pool.query('SELECT id FROM super_admin WHERE username = $1 AND id != $2', [username, req.admin.id]);
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (emailChanging) {
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

    // Burn the emailed code only once we know the update will go ahead.
    if (proof && !(await proof.consume())) return;

    updates.push('updated_at = NOW()');
    values.push(req.admin.id);
    const result = await pool.query(
      `UPDATE super_admin SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING id, username, email`,
      values
    );

    if (passwordChanging) {
      await revokeAllSessions('super_admin', req.admin.id);
    }
    if (sensitiveChange) {
      await notifySecurityChange({
        previousEmail,
        newEmail: emailChanging ? email : null,
        label: 'LifeMap super admin account',
        contactHint: 'act immediately',
        usernameChanging,
        previousUsername,
        username,
        passwordChanging,
      });
      await logSecurityChanges(req, 'super_admin', { usernameChanging, emailChanging, passwordChanging, previousUsername, username });
    }

    res.json({
      message: passwordChanging ? 'Account updated. Sign in again with your new password.' : 'Account updated',
      reauthRequired: passwordChanging,
      admin: { ...result.rows[0], role: 'super_admin' }
    });
  } catch (error) {
    console.error('Error updating super admin profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SUPER ADMIN - ADMIN MANAGEMENT ====================

// Get all admins (super admin only). Soft-deleted admins are excluded unless ?includeDeleted=true
router.get('/super-admin/admins', authenticateSuperAdmin, async (req, res) => {
  try {
    const includeDeleted = String(req.query.includeDeleted || '') === 'true';
    const result = await pool.query(`
      SELECT a.id, a.username, a.name, a.email, a.is_active, a.created_at, a.updated_at,
             a.last_login_at, a.deleted_at,
             COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL)::int AS user_count
      FROM admin a
      LEFT JOIN "user" u ON u.admin_id = a.id
      ${includeDeleted ? '' : 'WHERE a.deleted_at IS NULL'}
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `);

    res.json({ admins: result.rows });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create admin (super admin only) - no password; invite email with set-password link
router.post('/super-admin/admins', authenticateSuperAdmin, [
  body('username').notEmpty().trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  body('name').optional({ values: 'falsy' }).trim(),
  boxWealthEmail('email'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const username = String(req.body.username).trim();
    const name = req.body.name && String(req.body.name).trim() ? String(req.body.name).trim() : null;
    const email = normalizeEmail(req.body.email);

    const existing = await pool.query('SELECT id FROM admin WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Admin username already exists' });
    }
    const emailTaken = await pool.query(
      'SELECT id FROM admin WHERE LOWER(email) = $1 AND deleted_at IS NULL',
      [email]
    );
    if (emailTaken.rows.length > 0) {
      return res.status(400).json({ error: 'An admin with this email already exists' });
    }

    const passwordHash = await unusablePasswordHash();
    const result = await pool.query(
      `INSERT INTO admin (username, password_hash, name, email, super_admin_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING id, username, name, email, is_active, created_at`,
      [username, passwordHash, name, email, req.admin.id]
    );
    const admin = result.rows[0];

    const inviteSent = await sendInvite('admin', admin.id, email, 'You have been added as an advisor on LifeMap.');

    await logActivity({
      ...actorOf(req),
      action: 'admin_created',
      targetType: 'admin',
      targetId: admin.id,
      teamAdminId: admin.id,
      meta: { username: admin.username, email: maskEmail(email), inviteSent },
    });

    res.status(201).json({
      message: inviteSent
        ? 'Admin created. An invite email was sent to set their password.'
        : 'Admin created, but the invite email could not be sent. Use "send reset link" to retry.',
      inviteEmailSent: inviteSent,
      admin
    });
  } catch (error) {
    console.error('Error creating admin:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Admin username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Offboarding: reassign clients, then deactivate or soft-delete.
async function offboardAdmin({ req, adminId, reassignTo, mode, reason }) {
  const adminRes = await pool.query(
    `SELECT id, username, name, email, is_active, created_at, last_login_at
     FROM admin WHERE id = $1 AND deleted_at IS NULL`,
    [adminId]
  );
  const admin = adminRes.rows[0];
  if (!admin) return { status: 404, error: 'Admin not found' };

  const clientCount = await countClients(adminId);
  let target = null;
  if (clientCount > 0) {
    if (!reassignTo) {
      return {
        status: 400,
        error: `Reassign this admin's ${clientCount} client(s) first by providing reassignToAdminId`,
        clientCount,
      };
    }
    if (Number(reassignTo) === Number(adminId)) {
      return { status: 400, error: 'Choose a different admin to receive the clients' };
    }
    target = await getActiveAdmin(reassignTo);
    if (!target) {
      return { status: 400, error: 'reassignToAdminId must be an active, non-deleted admin' };
    }
  }

  // Remember who the admin's clients were so a later restore can hand them back.
  const clientIds = clientCount > 0
    ? (await pool.query(
        'SELECT id FROM "user" WHERE admin_id = $1 AND deleted_at IS NULL ORDER BY id',
        [adminId]
      )).rows.map((r) => r.id)
    : [];

  await withTx(async (db) => {
    if (clientCount > 0) {
      await db.query(
        'UPDATE "user" SET admin_id = $1, updated_at = NOW() WHERE admin_id = $2 AND deleted_at IS NULL',
        [target.id, adminId]
      );
    }
    if (mode === 'delete') {
      await db.query(
        'UPDATE admin SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1',
        [adminId]
      );
    } else {
      await db.query('UPDATE admin SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [adminId]);
    }
  });

  await revokeAllSessions('admin', adminId);

  if (mode === 'delete') {
    await softDeleteEntity({
      entityType: 'admin',
      entityId: adminId,
      payload: {
        ...userSnapshot(admin),
        reassignedClients: clientCount,
        reassignedTo: target?.id || null,
        clientIds,
      },
      deletedByRole: req.admin.role,
      deletedById: req.admin.id,
      reason,
    });
  }

  await logActivity({
    ...actorOf(req),
    action: mode === 'delete' ? 'admin_deleted' : 'admin_deactivated',
    targetType: 'admin',
    targetId: adminId,
    teamAdminId: adminId,
    meta: { reason: reason || null, reassignedClients: clientCount, reassignedTo: target?.id || null },
  });

  if (target) {
    await logActivity({
      ...actorOf(req),
      action: 'clients_reassigned_in',
      targetType: 'admin',
      targetId: target.id,
      teamAdminId: target.id,
      meta: { fromAdminId: adminId, count: clientCount },
    });
    await notifyEmail(
      target.email,
      'LifeMap: clients reassigned to you',
      `${clientCount} client(s) from advisor "${admin.username}" were reassigned to your team.`
    );
  }
  await notifyEmail(
    admin.email,
    mode === 'delete' ? 'Your LifeMap admin account was removed' : 'Your LifeMap admin account was deactivated',
    `Your admin account access was ${mode === 'delete' ? 'removed' : 'deactivated'} by a super admin. If you believe this is a mistake, contact ${PRIVACY_CONTACT}.`
  );

  return { ok: true, clientCount, reassignedTo: target?.id || null, admin };
}

// Update admin (super admin only) - no password; optional reset link
router.put('/super-admin/admins/:adminId', authenticateSuperAdmin, [
  idParam('adminId'),
  body('username').optional({ values: 'falsy' }).trim().isLength({ min: 3 }),
  boxWealthEmail('email', { optional: true }),
  body('name').optional({ values: 'falsy' }).trim(),
  body('is_active').optional().isBoolean(),
  body('sendResetLink').optional().isBoolean(),
  body('reassignToAdminId').optional({ values: 'falsy' }).isInt({ min: 1 }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    if (req.body.password !== undefined) {
      return res.status(400).json({
        error: 'Passwords are not set by administrators. Use sendResetLink so the admin chooses their own password.',
      });
    }

    const { adminId } = req.params;
    const { username, name } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;
    const isActive = req.body.is_active === undefined
      ? undefined
      : (req.body.is_active === true || req.body.is_active === 'true');
    const sendResetLink = req.body.sendResetLink === true || req.body.sendResetLink === 'true';

    const existing = await pool.query(
      `SELECT id, username, name, email, is_active, last_login_at
       FROM admin WHERE id = $1 AND deleted_at IS NULL`,
      [adminId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    const before = existing.rows[0];

    const updates = [];
    const values = [];
    let paramCount = 1;
    const changed = [];

    if (username !== undefined && username !== before.username) {
      const usernameCheck = await pool.query(
        'SELECT id FROM admin WHERE username = $1 AND id != $2',
        [username, adminId]
      );
      if (usernameCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push(`username = $${paramCount++}`);
      values.push(username);
      changed.push('username');
    }
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
      changed.push('name');
    }
    const emailChanging = email !== undefined && email !== normalizeEmail(before.email);
    if (emailChanging) {
      const emailCheck = await pool.query(
        'SELECT id FROM admin WHERE LOWER(email) = $1 AND id != $2 AND deleted_at IS NULL',
        [email, adminId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: 'An admin with this email already exists' });
      }
      updates.push(`email = $${paramCount++}`);
      values.push(email);
      changed.push('email');
    }

    // Deactivation goes through offboarding so clients are never orphaned
    if (isActive === false && before.is_active) {
      const outcome = await offboardAdmin({
        req,
        adminId,
        reassignTo: req.body.reassignToAdminId,
        mode: 'deactivate',
        reason: null,
      });
      if (outcome.error) {
        return res.status(outcome.status).json({ error: outcome.error, clientCount: outcome.clientCount });
      }
      changed.push('is_active:false');
    } else if (isActive === true && !before.is_active) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(true);
      changed.push('is_active:true');
    }

    if (updates.length === 0 && !sendResetLink && !changed.length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let admin;
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(adminId);
      const result = await pool.query(
        `UPDATE admin SET ${updates.join(', ')} WHERE id = $${paramCount}
         RETURNING id, username, name, email, is_active, created_at, updated_at, last_login_at`,
        values
      );
      admin = result.rows[0];
    } else {
      const result = await pool.query(
        `SELECT id, username, name, email, is_active, created_at, updated_at, last_login_at
         FROM admin WHERE id = $1`,
        [adminId]
      );
      admin = result.rows[0];
    }

    if (changed.length > 0) {
      await notifyEmail(
        before.email,
        'Your LifeMap admin account was updated',
        `A super admin updated your account (${changed.join(', ')}).\n\nIf this is unexpected, contact ${PRIVACY_CONTACT}.`
      );
      if (emailChanging) {
        await notifyEmail(email, 'Your LifeMap admin email was updated', 'This address is now the contact email for your LifeMap admin account.');
        await revokeAllSessions('admin', adminId);
      }
      await logActivity({
        ...actorOf(req),
        action: 'admin_updated',
        targetType: 'admin',
        targetId: Number(adminId),
        teamAdminId: Number(adminId),
        meta: { changed },
      });
    }

    let resetOutcome = null;
    if (sendResetLink) {
      resetOutcome = await sendAccessLink('admin', admin);
      await logActivity({
        ...actorOf(req),
        action: 'admin_reset_link_sent',
        targetType: 'admin',
        targetId: Number(adminId),
        teamAdminId: Number(adminId),
        meta: { purpose: resetOutcome.purpose || null, sent: resetOutcome.sent },
      });
    }

    res.json({
      message: 'Admin updated successfully',
      admin,
      resetLinkSent: resetOutcome ? resetOutcome.sent : undefined,
    });
  } catch (error) {
    console.error('Error updating admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Deactivate admin (super admin only) - clients must be reassigned first
router.post('/super-admin/admins/:adminId/deactivate', authenticateSuperAdmin, [
  idParam('adminId'),
  body('reassignToAdminId').optional({ values: 'falsy' }).isInt({ min: 1 }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const outcome = await offboardAdmin({
      req,
      adminId: req.params.adminId,
      reassignTo: req.body.reassignToAdminId,
      mode: 'deactivate',
      reason: req.body.reason ? String(req.body.reason).trim() : null,
    });
    if (outcome.error) {
      return res.status(outcome.status).json({ error: outcome.error, clientCount: outcome.clientCount });
    }
    res.json({
      message: 'Admin deactivated',
      reassignedClients: outcome.clientCount,
      reassignedTo: outcome.reassignedTo,
    });
  } catch (error) {
    console.error('Error deactivating admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft delete admin (super admin only) - recoverable for 90 days from /deleted-items
router.delete('/super-admin/admins/:adminId', authenticateSuperAdmin, [
  idParam('adminId'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const reassignTo = req.body?.reassignToAdminId || req.query.reassignToAdminId;
    const reason = String(req.body?.reason || req.query.reason || '').trim();

    const outcome = await offboardAdmin({
      req,
      adminId: req.params.adminId,
      reassignTo,
      mode: 'delete',
      reason: reason || null,
    });
    if (outcome.error) {
      return res.status(outcome.status).json({ error: outcome.error, clientCount: outcome.clientCount });
    }

    res.json({
      message: 'Admin deleted. It can be restored for 90 days.',
      reassignedClients: outcome.clientCount,
      reassignedTo: outcome.reassignedTo,
    });
  } catch (error) {
    console.error('Error deleting admin:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send an invite / reset link to an admin (super admin only)
router.post('/admins/:id/send-reset', authenticateSuperAdmin, [idParam('id')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const result = await pool.query(
      `SELECT id, username, email, last_login_at FROM admin WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    const admin = result.rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin not found' });
    if (!admin.email) return res.status(400).json({ error: 'This admin has no email address on file' });

    const outcome = await sendAccessLink('admin', admin);
    await logActivity({
      ...actorOf(req),
      action: 'admin_reset_link_sent',
      targetType: 'admin',
      targetId: admin.id,
      teamAdminId: admin.id,
      meta: { purpose: outcome.purpose, sent: outcome.sent },
    });
    if (!outcome.sent) {
      return res.status(503).json({ error: 'Could not send the email. Try again later.' });
    }
    res.json({ message: outcome.purpose === 'invite' ? 'Invite email sent' : 'Reset link sent' });
  } catch (error) {
    console.error('Error sending admin reset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SUPER ADMIN - USER MANAGEMENT ====================

// Transfer user to a different ACTIVE admin (super admin only). There is no "unassigned" target.
router.put('/super-admin/users/:userId/transfer', authenticateSuperAdmin, [
  idParam('userId'),
  body('reason').trim().isLength({ min: 3 }).withMessage('A reason for the transfer is required'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    // Clients are never moved to an "unassigned" pool: a transfer must name an active admin.
    const rawAdminId = req.body.admin_id;
    if (rawAdminId === undefined || rawAdminId === null || rawAdminId === '' || !Number.isInteger(Number(rawAdminId)) || Number(rawAdminId) < 1) {
      return res.status(400).json({ error: 'You must assign the client to an active admin (admin_id is required).' });
    }

    const { userId } = req.params;
    const reason = String(req.body.reason).trim();
    const newAdminId = Number(rawAdminId);

    const userCheck = await pool.query(
      'SELECT id, name, admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userCheck.rows[0];
    if ((user.admin_id || null) === newAdminId) {
      return res.status(400).json({ error: 'User is already assigned to this admin' });
    }

    const newAdmin = await getActiveAdmin(newAdminId);
    if (!newAdmin) {
      return res.status(400).json({ error: 'You must assign the client to an active admin. That admin was not found or is not active.' });
    }
    let oldAdmin = null;
    if (user.admin_id) {
      const oldRes = await pool.query('SELECT id, username, email FROM admin WHERE id = $1', [user.admin_id]);
      oldAdmin = oldRes.rows[0] || null;
    }

    await pool.query(
      'UPDATE "user" SET admin_id = $1, updated_at = NOW() WHERE id = $2',
      [newAdminId, userId]
    );

    const meta = { reason, fromAdminId: user.admin_id || null, toAdminId: newAdminId };
    await logActivity({
      ...actorOf(req),
      action: 'client_transferred',
      targetType: 'user',
      targetId: user.id,
      teamAdminId: newAdminId,
      meta,
    });
    if (user.admin_id) {
      await logActivity({
        ...actorOf(req),
        action: 'client_transferred_out',
        targetType: 'user',
        targetId: user.id,
        teamAdminId: user.admin_id,
        meta,
      });
    }

    if (oldAdmin?.email) {
      await notifyEmail(
        oldAdmin.email,
        'LifeMap: a client was transferred away from you',
        `Client "${user.name}" was transferred to advisor "${newAdmin.username}".\nReason: ${reason}`
      );
    }
    if (newAdmin.email) {
      await notifyEmail(
        newAdmin.email,
        'LifeMap: a client was transferred to you',
        `Client "${user.name}" was transferred to your team${oldAdmin ? ` from advisor "${oldAdmin.username}"` : ''}.\nReason: ${reason}`
      );
    }

    res.json({ message: 'User transferred successfully' });
  } catch (error) {
    console.error('Error transferring user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all users with their admin assignments (super admin only). ?unassigned=true to filter.
router.get('/super-admin/users', authenticateSuperAdmin, async (req, res) => {
  try {
    const unassignedOnly = String(req.query.unassigned || '') === 'true';
    const result = await pool.query(`
      SELECT u.id, u.email, u.name, u.created_at, u.last_login_at,
             CASE
               WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN 'locked'
               WHEN u.admin_id IS NULL THEN 'unassigned'
               ELSE 'active'
             END AS status,
             a.id as admin_id, a.username as admin_username, a.name as admin_name
      FROM "user" u
      LEFT JOIN admin a ON u.admin_id = a.id
      WHERE u.deleted_at IS NULL
      ${unassignedOnly ? 'AND u.admin_id IS NULL' : ''}
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
    const result = await pool.query(
      `SELECT id, email, name, created_at, admin_id, last_login_at
       FROM "user" WHERE admin_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [req.admin.id]
    );

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create client (admin) - no password; invite email with set-password link
router.post('/admin/users', authenticateAdmin, [
  body('email').trim().isEmail().withMessage('Enter a valid email address'),
  body('name').trim().isLength({ min: 2 }).withMessage('Enter the client name'),
  body('admin_id').optional({ values: 'falsy' }).isInt({ min: 1 }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name).trim();

    // Admins always own what they create; a super admin must pick the owning admin.
    let ownerId = req.admin.id;
    if (req.admin.role === 'super_admin') {
      if (!req.body.admin_id) {
        return res.status(400).json({ error: 'admin_id is required when a super admin creates a client' });
      }
      const owner = await getActiveAdmin(req.body.admin_id);
      if (!owner) return res.status(400).json({ error: 'admin_id must be an active admin' });
      ownerId = owner.id;
    }

    const existing = await pool.query(
      'SELECT id FROM "user" WHERE LOWER(email) = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    const passwordHash = await unusablePasswordHash();
    const result = await pool.query(
      `INSERT INTO "user" (email, password_hash, name, admin_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, email, name, created_at`,
      [email, passwordHash, name, ownerId]
    );
    const user = result.rows[0];

    const inviteSent = await sendInvite('client', user.id, email, 'Your advisor has created a LifeMap account for you.');

    await logActivity({
      ...actorOf(req),
      action: 'client_created',
      targetType: 'user',
      targetId: user.id,
      teamAdminId: ownerId,
      meta: { email: maskEmail(email), inviteSent },
    });

    res.status(201).json({
      message: inviteSent
        ? 'User created. An invite email was sent so they can set a password.'
        : 'User created, but the invite email could not be sent. Use "send reset link" to retry.',
      inviteEmailSent: inviteSent,
      user
    });
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'User already exists with this email' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function loadClientForAdmin(req, res, userId) {
  const userCheck = await pool.query(
    'SELECT id, email, name, admin_id, last_login_at FROM "user" WHERE id = $1 AND deleted_at IS NULL',
    [userId]
  );
  if (userCheck.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  if (req.admin.role === 'admin' && userCheck.rows[0].admin_id !== req.admin.id) {
    res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    return null;
  }
  return userCheck.rows[0];
}

// Update a client assigned to this admin (name, email, optional reset link) - no passwords
router.put('/admin/users/:userId', authenticateAdmin, [
  idParam('userId'),
  body('email').optional({ values: 'falsy' }).trim().isEmail(),
  body('name').optional({ values: 'falsy' }).trim().isLength({ min: 2 }),
  body('sendResetLink').optional().isBoolean(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    if (req.body.password !== undefined) {
      return res.status(400).json({
        error: 'Passwords are not set by administrators. Use sendResetLink so the client chooses their own password.',
      });
    }

    const { userId } = req.params;
    const before = await loadClientForAdmin(req, res, userId);
    if (!before) return;

    const email = req.body.email ? normalizeEmail(req.body.email) : undefined;
    const name = req.body.name ? String(req.body.name).trim() : undefined;
    const sendResetLink = req.body.sendResetLink === true || req.body.sendResetLink === 'true';

    const updates = [];
    const values = [];
    let paramCount = 1;
    const changed = [];

    const emailChanging = email !== undefined && email !== normalizeEmail(before.email);
    if (emailChanging) {
      const taken = await pool.query('SELECT id FROM "user" WHERE LOWER(email) = $1 AND id != $2', [email, userId]);
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Another user already uses this email' });
      }
      updates.push(`email = $${paramCount++}`);
      values.push(email);
      changed.push('email');
    }
    if (name !== undefined && name !== before.name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
      changed.push('name');
    }

    if (updates.length === 0 && !sendResetLink) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let user = before;
    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(userId);
      const result = await pool.query(
        `UPDATE "user" SET ${updates.join(', ')} WHERE id = $${paramCount}
         RETURNING id, email, name, admin_id, last_login_at, created_at, updated_at`,
        values
      );
      user = result.rows[0];

      if (emailChanging) {
        await revokeAllSessions('client', userId);
        await notifyEmail(
          before.email,
          'Your LifeMap email address was changed',
          `Your advisor updated the email on your LifeMap account to ${maskEmail(email)}.\n\nIf this was not expected, contact ${PRIVACY_CONTACT}.`
        );
      }
      await logActivity({
        ...actorOf(req),
        action: 'client_updated',
        targetType: 'user',
        targetId: Number(userId),
        teamAdminId: before.admin_id || null,
        meta: { changed },
      });
    }

    let resetOutcome = null;
    if (sendResetLink) {
      resetOutcome = await sendAccessLink('client', user);
      await logActivity({
        ...actorOf(req),
        action: 'client_reset_link_sent',
        targetType: 'user',
        targetId: Number(userId),
        teamAdminId: before.admin_id || null,
        meta: { purpose: resetOutcome.purpose || null, sent: resetOutcome.sent },
      });
    }

    res.json({
      message: 'User updated',
      user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at, updated_at: user.updated_at },
      resetLinkSent: resetOutcome ? resetOutcome.sent : undefined,
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Soft delete a client (reason required). Admin: own clients only. Recoverable for 90 days.
router.delete('/admin/users/:userId', authenticateAdmin, [idParam('userId')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { userId } = req.params;
    const reason = String(req.body?.reason || req.query.reason || '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ error: 'A reason for deletion is required' });
    }

    const owned = await loadClientForAdmin(req, res, userId);
    if (!owned) return;

    const full = await pool.query(
      `SELECT id, email, name, admin_id, created_at, consent_version, consent_at, last_login_at
       FROM "user" WHERE id = $1`,
      [userId]
    );

    await pool.query(
      'UPDATE "user" SET deleted_at = NOW(), delete_reason = $2, updated_at = NOW() WHERE id = $1',
      [userId, reason]
    );
    await softDeleteEntity({
      entityType: 'user',
      entityId: Number(userId),
      payload: userSnapshot(full.rows[0]),
      deletedByRole: req.admin.role,
      deletedById: req.admin.id,
      reason,
    });
    await revokeAllSessions('client', userId);

    await logActivity({
      ...actorOf(req),
      action: 'client_deleted',
      targetType: 'user',
      targetId: Number(userId),
      teamAdminId: owned.admin_id || null,
      meta: {
        reason,
        clientName: full.rows[0]?.name || null,
        clientEmail: full.rows[0]?.email || null,
      },
    });

    res.json({ message: 'User deleted. It can be restored for 90 days.' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send an invite / reset link to a client
router.post('/users/:id/send-reset', authenticateAdmin, [idParam('id')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const client = await loadClientForAdmin(req, res, req.params.id);
    if (!client) return;

    const outcome = await sendAccessLink('client', client);
    await logActivity({
      ...actorOf(req),
      action: 'client_reset_link_sent',
      targetType: 'user',
      targetId: client.id,
      teamAdminId: client.admin_id || null,
      meta: { purpose: outcome.purpose || null, sent: outcome.sent },
    });
    if (!outcome.sent) {
      return res.status(503).json({ error: 'Could not send the email. Try again later.' });
    }
    res.json({ message: outcome.purpose === 'invite' ? 'Invite email sent' : 'Reset link sent' });
  } catch (error) {
    console.error('Error sending client reset:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile (admin can view any user assigned to them)
router.get('/admin/users/:userId/profile', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const userCheck = await pool.query(
      `SELECT id, email, name, admin_id, created_at, updated_at
       FROM "user" WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.admin.role === 'admin' && userCheck.rows[0].admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    }

    const { admin_id, ...client } = userCheck.rows[0];

    const profileResult = await pool.query(
      'SELECT * FROM financial_profile WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );

    res.json({ user: client, profile: profileResult.rows[0] || null });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ACTIVITY LOG ====================

function parseDateBound(value, isEnd) {
  if (!value) return { value: null };
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return { error: `Invalid date: ${raw}` };
  if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // date-only upper bound is inclusive of that whole day
    date.setUTCDate(date.getUTCDate() + 1);
    return { value: date, exclusive: true };
  }
  return { value: date, exclusive: false };
}

function buildActivityFilter(req) {
  const where = [];
  const params = [];

  if (req.admin.role !== 'super_admin') {
    params.push(req.admin.id);
    where.push(`al.team_admin_id = $${params.length}`);
  } else if (req.query.team) {
    const team = Number.parseInt(req.query.team, 10);
    if (Number.isNaN(team)) return { error: 'team must be an admin id' };
    params.push(team);
    where.push(`al.team_admin_id = $${params.length}`);
  }

  if (req.query.action) {
    params.push(String(req.query.action).trim());
    where.push(`al.action = $${params.length}`);
  }

  // clientId: anything that involved this client (they acted, or staff acted on them)
  if (req.query.clientId) {
    const clientId = Number.parseInt(req.query.clientId, 10);
    if (Number.isNaN(clientId)) return { error: 'clientId must be a number' };
    params.push(clientId);
    const n = params.length;
    where.push(
      `((al.target_type = 'user' AND al.target_id = $${n}) OR (al.actor_role = 'client' AND al.actor_id = $${n}))`
    );
  }

  // clientName: match client name or email (live "user" row, log meta, or actor label)
  if (req.query.clientName) {
    const like = `%${String(req.query.clientName).trim().replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like);
    const n = params.length;
    where.push(`(
      al.meta->>'clientName' ILIKE $${n}
      OR al.meta->>'clientEmail' ILIKE $${n}
      OR al.actor_label ILIKE $${n}
      OR (
        al.target_type = 'user' AND EXISTS (
          SELECT 1 FROM "user" u
          WHERE u.id = al.target_id AND (u.name ILIKE $${n} OR u.email ILIKE $${n})
        )
      )
      OR (
        al.actor_role = 'client' AND EXISTS (
          SELECT 1 FROM "user" u
          WHERE u.id = al.actor_id AND (u.name ILIKE $${n} OR u.email ILIKE $${n})
        )
      )
    )`);
  }

  // userId: the actor (staff or client) that performed the action
  if (req.query.userId) {
    const userId = Number.parseInt(req.query.userId, 10);
    if (Number.isNaN(userId)) return { error: 'userId must be a number' };
    params.push(userId);
    where.push(`al.actor_id = $${params.length}`);
  }

  const from = parseDateBound(req.query.from, false);
  if (from.error) return { error: from.error };
  if (from.value) {
    params.push(from.value);
    where.push(`al.created_at >= $${params.length}`);
  }

  const to = parseDateBound(req.query.to, true);
  if (to.error) return { error: to.error };
  if (to.value) {
    params.push(to.value);
    where.push(`al.created_at ${to.exclusive ? '<' : '<='} $${params.length}`);
  }

  if (req.query.q) {
    const like = `%${String(req.query.q).trim().replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like);
    const n = params.length;
    where.push(
      `(al.actor_label ILIKE $${n}
        OR al.action ILIKE $${n}
        OR al.target_type ILIKE $${n}
        OR al.meta::text ILIKE $${n}
        OR al.meta->>'clientName' ILIKE $${n}
        OR (
          al.target_type = 'user' AND EXISTS (
            SELECT 1 FROM "user" u
            WHERE u.id = al.target_id AND (u.name ILIKE $${n} OR u.email ILIKE $${n})
          )
        ))`
    );
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const ACTIVITY_SELECT = `
  SELECT al.id, al.actor_role, al.actor_id, al.actor_label, al.action, al.target_type, al.target_id,
         al.team_admin_id, ta.username AS team_label, al.meta, al.created_at,
         CASE
           WHEN al.target_type = 'user' THEN COALESCE(
             NULLIF(al.meta->>'clientName', ''),
             tu.name,
             tu.email,
             'Client #' || al.target_id::text
           )
           WHEN al.target_type = 'admin' THEN COALESCE(tadm.name, tadm.username, 'Admin #' || al.target_id::text)
           ELSE NULL
         END AS target_label
  FROM activity_log al
  LEFT JOIN admin ta ON ta.id = al.team_admin_id
  LEFT JOIN "user" tu ON al.target_type = 'user' AND tu.id = al.target_id
  LEFT JOIN admin tadm ON al.target_type = 'admin' AND tadm.id = al.target_id`;

// Super admin: everything. Admin: own team only.
router.get('/activity-log', authenticateAdmin, async (req, res) => {
  try {
    const filter = buildActivityFilter(req);
    if (filter.error) return res.status(400).json({ error: filter.error });

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 1000);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM activity_log al ${filter.whereSql}`,
      filter.params
    );
    const rows = await pool.query(
      `${ACTIVITY_SELECT} ${filter.whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      filter.params
    );

    res.json({ entries: rows.rows, total: countResult.rows[0].total, limit, offset });
  } catch (error) {
    console.error('Error fetching activity log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // neutralise spreadsheet formulas
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

router.get('/activity-log/export.csv', authenticateAdmin, async (req, res) => {
  try {
    const filter = buildActivityFilter(req);
    if (filter.error) return res.status(400).json({ error: filter.error });

    const rows = await pool.query(
      `${ACTIVITY_SELECT} ${filter.whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 10000`,
      filter.params
    );

    const header = ['id', 'created_at', 'actor_role', 'actor_id', 'actor_label', 'action', 'target_type', 'target_id', 'target_label', 'team_admin_id', 'team_label', 'meta'];
    const lines = [header.join(',')];
    for (const row of rows.rows) {
      lines.push([
        row.id,
        row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        row.actor_role,
        row.actor_id,
        row.actor_label,
        row.action,
        row.target_type,
        row.target_id,
        row.target_label,
        row.team_admin_id,
        row.team_label,
        JSON.stringify(row.meta || {}),
      ].map(csvCell).join(','));
    }

    await logActivity({
      ...actorOf(req),
      action: 'activity_log_exported',
      targetType: 'activity_log',
      teamAdminId: req.admin.role === 'admin' ? req.admin.id : null,
      meta: { rows: rows.rows.length },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lifemap-activity-log-${stamp}.csv"`);
    res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
  } catch (error) {
    console.error('Error exporting activity log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Daily CSV snapshots for CERT-In / DPDP retention (super admin only)
router.get('/activity-log/archives', authenticateAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin only' });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 60, 1), 366);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const data = await listLogArchives({ limit, offset });
    res.json(data);
  } catch (error) {
    console.error('Error listing log archives:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/activity-log/archives/:day.csv', authenticateAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin only' });
    }
    const day = String(req.params.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ error: 'Use YYYY-MM-DD' });
    }
    const row = await getLogArchiveCsv(day);
    if (!row) return res.status(404).json({ error: 'No archive for that day' });

    await logActivity({
      ...actorOf(req),
      action: 'activity_log_archive_downloaded',
      targetType: 'activity_log_archive',
      meta: { day, rowCount: row.row_count },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lifemap-activity-log-${day}.csv"`);
    res.send(`\uFEFF${row.csv_content}`);
  } catch (error) {
    console.error('Error downloading log archive:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/activity-log/archives/run', authenticateAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin only' });
    }
    const day = req.body?.day ? String(req.body.day) : undefined;
    const result = day
      ? await archiveActivityLogDay(day)
      : await runDailyLogArchive();
    res.json({ message: 'Archive job finished', result });
  } catch (error) {
    console.error('Error running log archive:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ==================== DELETED ITEMS (recycle bin) ====================

router.get('/deleted-items', authenticateAdmin, async (req, res) => {
  try {
    const params = [];
    let scope = '';
    if (req.admin.role !== 'super_admin') {
      params.push(String(req.admin.id));
      scope = `AND di.entity_type = 'user' AND di.payload->>'admin_id' = $1`;
    }
    const result = await pool.query(
      `SELECT di.id, di.entity_type, di.entity_id, di.reason, di.deleted_by_role, di.deleted_by_id,
              di.deleted_at, di.purge_after, di.restored_at,
              COALESCE(di.legal_hold, FALSE) AS legal_hold,
              COALESCE(
                NULLIF(di.payload->>'name', ''),
                NULLIF(di.payload->>'username', ''),
                NULLIF(ou.name, ''),
                NULLIF(di.payload->>'description', ''),
                NULLIF(di.payload->>'stream', ''),
                NULLIF(di.payload->>'policy_type', ''),
                NULLIF(di.payload->>'lender', ''),
                CASE WHEN di.entity_type = 'user' THEN 'Client #' || di.entity_id::text ELSE NULL END
              ) AS label,
              COALESCE(NULLIF(di.payload->>'email', ''), ou.email) AS email,
              di.payload->>'username' AS username,
              COALESCE(NULLIF(di.payload->>'name', ''), ou.name) AS client_name
       FROM deleted_items di
       LEFT JOIN "user" ou ON (
         (di.entity_type = 'user' AND ou.id = di.entity_id)
         OR (di.entity_type NOT IN ('user', 'admin') AND ou.id::text = di.payload->>'user_id')
       )
       WHERE di.restored_at IS NULL ${scope}
       ORDER BY di.deleted_at DESC`,
      params
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error fetching deleted items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/deleted-items/:id/restore', authenticateSuperAdmin, [idParam('id')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const itemRes = await pool.query(
      'SELECT * FROM deleted_items WHERE id = $1 AND restored_at IS NULL',
      [req.params.id]
    );
    const item = itemRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Deleted item not found' });

    let message;
    let teamAdminId = null;
    let restoredClientCount = 0;
    let restoredAdminEmail = null;
    let restoredUserId = null;

    await withTx(async (db) => {
      if (item.entity_type === 'user') {
        const row = await db.query(
          'SELECT id, admin_id FROM "user" WHERE id = $1 AND deleted_at IS NOT NULL',
          [item.entity_id]
        );
        if (!row.rows[0]) throw Object.assign(new Error('gone'), { statusCode: 404 });
        let adminId = row.rows[0].admin_id;
        if (adminId) {
          const owner = await db.query(
            'SELECT id FROM admin WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL',
            [adminId]
          );
          if (!owner.rows[0]) adminId = null;
        }
        await db.query(
          `UPDATE "user"
           SET deleted_at = NULL, delete_reason = NULL, admin_id = $2, updated_at = NOW()
           WHERE id = $1`,
          [item.entity_id, adminId]
        );
        teamAdminId = adminId;
        message = adminId
          ? 'Client restored.'
          : 'Client restored and set to unassigned because the previous admin is no longer active.';
      } else if (item.entity_type === 'admin') {
        const row = await db.query(
          'SELECT id FROM admin WHERE id = $1 AND deleted_at IS NOT NULL',
          [item.entity_id]
        );
        if (!row.rows[0]) throw Object.assign(new Error('gone'), { statusCode: 404 });

        // Hand the admin's clients back: those recorded at delete time that are still with the admin they were
        // reassigned to, or are unassigned. Clients that were transferred elsewhere since stay where they are.
        const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : (item.payload || {});
        const clientIds = (Array.isArray(payload.clientIds) ? payload.clientIds : [])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
        if (clientIds.length > 0) {
          const moved = await db.query(
            `UPDATE "user" SET admin_id = $1, updated_at = NOW()
             WHERE id = ANY($2::int[]) AND deleted_at IS NULL
               AND (admin_id IS NULL OR ($3::int IS NOT NULL AND admin_id = $3::int))
             RETURNING id`,
            [item.entity_id, clientIds, payload.reassignedTo || null]
          );
          restoredClientCount = moved.rowCount;
        }

        // An admin who gets clients back must be able to serve them, so they are reactivated in that case.
        await db.query(
          'UPDATE admin SET deleted_at = NULL, is_active = $2, updated_at = NOW() WHERE id = $1',
          [item.entity_id, restoredClientCount > 0]
        );
        teamAdminId = item.entity_id;
        restoredAdminEmail = payload.email || null;
        message = restoredClientCount > 0
          ? `Admin restored and reactivated with ${restoredClientCount} client(s) returned to them.`
          : 'Admin restored as inactive. Reactivate them to restore access.';
      } else if (isRegisterEntity(item.entity_type)) {
        const restored = await restoreRegisterRow(db, item);
        const owner = await db.query('SELECT admin_id FROM "user" WHERE id = $1', [restored.userId]);
        teamAdminId = owner.rows[0]?.admin_id || null;
        restoredUserId = restored.userId;
        message = 'Record restored to the client\'s plan.';
      } else {
        throw Object.assign(new Error('unsupported'), { statusCode: 400 });
      }
      await db.query('UPDATE deleted_items SET restored_at = NOW() WHERE id = $1', [item.id]);
    });

    const registerRestore = isRegisterEntity(item.entity_type);
    await logActivity({
      ...actorOf(req),
      action: registerRestore ? 'plan_row_restored' : `${item.entity_type === 'user' ? 'client' : 'admin'}_restored`,
      targetType: item.entity_type,
      targetId: item.entity_id,
      teamAdminId,
      meta: {
        deletedItemId: item.id,
        ...(item.entity_type === 'admin' ? { restoredClients: restoredClientCount } : {}),
        ...(registerRestore ? { clientId: restoredUserId } : {}),
      },
    });

    if (item.entity_type === 'admin' && restoredAdminEmail) {
      await notifyEmail(
        restoredAdminEmail,
        'Your LifeMap admin account was restored',
        `A super admin restored your admin account${restoredClientCount > 0 ? ` and returned ${restoredClientCount} client(s) to you` : ''}.${restoredClientCount > 0 ? '' : ' It is inactive until a super admin reactivates it.'}\n\nIf this is unexpected, contact ${PRIVACY_CONTACT}.`
      );
    }

    res.json({ message, restoredClients: item.entity_type === 'admin' ? restoredClientCount : undefined });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ error: 'The deleted record no longer exists' });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This record already exists, so it cannot be restored again' });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ error: 'This item type cannot be restored' });
    }
    console.error('Error restoring deleted item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/deleted-items/:id/purge', authenticateSuperAdmin, [idParam('id')], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const itemRes = await pool.query(
      'SELECT * FROM deleted_items WHERE id = $1 AND restored_at IS NULL',
      [req.params.id]
    );
    const item = itemRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Deleted item not found' });
    if (item.legal_hold) {
      return res.status(409).json({ error: 'This item is under legal hold. Release the hold before purging it.' });
    }

    if (item.entity_type === 'user') {
      await pool.query('DELETE FROM public."user" WHERE id = $1 AND deleted_at IS NOT NULL', [item.entity_id]);
      await purgeRegisterItemsForUser(item.entity_id);
    } else if (item.entity_type === 'admin') {
      await pool.query('DELETE FROM admin WHERE id = $1 AND deleted_at IS NOT NULL', [item.entity_id]);
    } else if (!isRegisterEntity(item.entity_type)) {
      return res.status(400).json({ error: 'This item type cannot be purged' });
    }
    // register rows were already removed from the live table when they were deleted
    await pool.query('DELETE FROM deleted_items WHERE id = $1', [item.id]);

    await logActivity({
      ...actorOf(req),
      action: 'permanent_purge',
      targetType: item.entity_type,
      targetId: item.entity_id,
      meta: { deletedItemId: item.id, manual: true },
    });

    res.json({ message: 'Permanently deleted' });
  } catch (error) {
    console.error('Error purging deleted item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legal hold: a held item is skipped by the 90-day purge and cannot be purged by hand until released.
router.post('/deleted-items/:id/legal-hold', authenticateSuperAdmin, [
  idParam('id'),
  body('hold').isBoolean().withMessage('hold must be true or false'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const hold = req.body.hold === true || req.body.hold === 'true';
    const result = await pool.query(
      `UPDATE deleted_items SET legal_hold = $2
       WHERE id = $1 AND restored_at IS NULL
       RETURNING id, entity_type, entity_id, legal_hold`,
      [req.params.id, hold]
    );
    const item = result.rows[0];
    if (!item) return res.status(404).json({ error: 'Deleted item not found' });

    await logActivity({
      ...actorOf(req),
      action: hold ? 'legal_hold_set' : 'legal_hold_released',
      targetType: item.entity_type,
      targetId: item.entity_id,
      meta: { deletedItemId: item.id },
    });
    res.json({ message: hold ? 'Legal hold set. This item will not be purged.' : 'Legal hold released.', item });
  } catch (error) {
    console.error('Error updating legal hold:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== PRIVACY REQUESTS ====================

const PRIVACY_STATUSES = {
  received: 'Received',
  'in progress': 'In progress',
  in_progress: 'In progress',
  closed: 'Closed',
  completed: 'Closed',
  rejected: 'Rejected',
};
const CLOSED_STATUSES = new Set(['Closed', 'Rejected']);

router.get('/privacy-requests', authenticateAdmin, async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.admin.role !== 'super_admin') {
      params.push(req.admin.id);
      where.push(`u.admin_id = $${params.length}`);
    }
    if (req.query.status) {
      const status = PRIVACY_STATUSES[String(req.query.status).trim().toLowerCase()];
      if (!status) return res.status(400).json({ error: 'Unknown status' });
      params.push(status);
      where.push(`pr.status = $${params.length}`);
    }
    const result = await pool.query(
      `SELECT pr.id, pr.ref, pr.type, pr.status, pr.details, pr.notes, pr.due_at, pr.closed_at,
              pr.created_at, pr.updated_at,
              (pr.closed_at IS NULL AND pr.due_at IS NOT NULL AND pr.due_at < NOW()) AS overdue,
              u.id AS user_id, u.email AS user_email, u.name AS user_name, u.admin_id,
              COALESCE(ta.name, ta.username) AS team_label,
              ta.username AS team_username,
              (pr.closed_at IS NULL AND pr.due_at IS NOT NULL AND pr.due_at >= NOW()
               AND pr.due_at <= NOW() + INTERVAL '14 days') AS due_soon
       FROM privacy_request pr
       JOIN "user" u ON u.id = pr.user_id
       LEFT JOIN admin ta ON ta.id = u.admin_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (pr.closed_at IS NULL) DESC, pr.due_at ASC NULLS LAST, pr.created_at DESC`,
      params
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Error fetching privacy requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/privacy-requests/:id', authenticateAdmin, [
  idParam('id'),
  body('status').optional({ values: 'falsy' }).isString(),
  body('notes').optional({ values: 'null' }).isString().isLength({ max: 4000 }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const status = req.body.status
      ? PRIVACY_STATUSES[String(req.body.status).trim().toLowerCase()]
      : undefined;
    if (req.body.status && !status) {
      return res.status(400).json({ error: `Status must be one of: ${[...new Set(Object.values(PRIVACY_STATUSES))].join(', ')}` });
    }
    const notes = req.body.notes !== undefined ? String(req.body.notes ?? '').trim() : undefined;
    if (status === undefined && notes === undefined) {
      return res.status(400).json({ error: 'Provide a status and/or notes' });
    }

    const existing = await pool.query(
      `SELECT pr.id, pr.ref, pr.type, pr.status, pr.notes, u.id AS user_id, u.email AS user_email, u.admin_id
       FROM privacy_request pr JOIN "user" u ON u.id = pr.user_id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    const row = existing.rows[0];
    if (!row) return res.status(404).json({ error: 'Privacy request not found' });
    if (req.admin.role === 'admin' && row.admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. Request is not for one of your clients' });
    }

    const updates = [];
    const values = [];
    let n = 1;
    if (status !== undefined) {
      updates.push(`status = $${n++}`);
      values.push(status);
      updates.push(CLOSED_STATUSES.has(status) ? 'closed_at = NOW()' : 'closed_at = NULL');
    }
    if (notes !== undefined) {
      updates.push(`notes = $${n++}`);
      values.push(notes || null);
    }
    updates.push(`handled_by_role = $${n++}`);
    values.push(req.admin.role);
    updates.push(`handled_by_id = $${n++}`);
    values.push(req.admin.id);
    updates.push('updated_at = NOW()');
    values.push(row.id);

    const result = await pool.query(
      `UPDATE privacy_request SET ${updates.join(', ')} WHERE id = $${n}
       RETURNING id, ref, type, status, notes, due_at, closed_at, updated_at`,
      values
    );
    const updated = result.rows[0];

    const statusChanged = status !== undefined && status !== row.status;
    if (statusChanged) {
      await notifyEmail(
        row.user_email,
        `Update on your LifeMap privacy request (${row.ref})`,
        `The status of your privacy request ${row.ref} is now: ${status}.${notes ? `\n\nNote from our team:\n${notes}` : ''}\n\nQuestions: ${PRIVACY_CONTACT}`
      );
    }

    await logActivity({
      ...actorOf(req),
      action: 'privacy_request_updated',
      targetType: 'privacy_request',
      targetId: row.id,
      teamAdminId: row.admin_id || null,
      meta: { ref: row.ref, from: row.status, to: updated.status, notesUpdated: notes !== undefined },
    });

    res.json({ message: 'Privacy request updated', request: updated, clientNotified: statusChanged });
  } catch (error) {
    console.error('Error updating privacy request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ACCESS REVIEW ====================

router.get('/access-review', authenticateSuperAdmin, async (req, res) => {
  try {
    const admins = await pool.query(`
      SELECT a.id, a.username, a.name, a.email, a.is_active, a.last_login_at, a.created_at,
             (a.locked_until IS NOT NULL AND a.locked_until > NOW()) AS locked,
             (a.last_login_at IS NULL OR a.last_login_at < NOW() - INTERVAL '90 days') AS dormant,
             COUNT(u.id) FILTER (WHERE u.deleted_at IS NULL)::int AS client_count,
             (SELECT d.decision FROM access_review_decision d
                WHERE d.admin_id = a.id ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS last_decision,
             (SELECT d.created_at FROM access_review_decision d
                WHERE d.admin_id = a.id ORDER BY d.created_at DESC, d.id DESC LIMIT 1) AS last_decision_at
      FROM admin a
      LEFT JOIN "user" u ON u.admin_id = a.id
      WHERE a.deleted_at IS NULL
      GROUP BY a.id
      ORDER BY a.last_login_at ASC NULLS FIRST, a.created_at DESC
    `);
    const superAdmins = await pool.query(`
      SELECT id, username, email, last_login_at, created_at,
             (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
      FROM super_admin ORDER BY created_at ASC
    `);
    const unassigned = await pool.query(
      'SELECT COUNT(*)::int AS c FROM "user" WHERE admin_id IS NULL AND deleted_at IS NULL'
    );

    await logActivity({
      ...actorOf(req),
      action: 'access_review_viewed',
      targetType: 'access_review',
    });

    res.json({
      generatedAt: new Date().toISOString(),
      admins: admins.rows,
      superAdmins: superAdmins.rows,
      unassignedClients: unassigned.rows[0].c,
    });
  } catch (error) {
    console.error('Error building access review:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Record the outcome of a periodic access review for one admin.
//   Keep       -> persisted + logged, nothing else changes
//   Deactivate -> runs the normal deactivate flow (clients must be reassigned via reassignToAdminId), then persisted
router.post('/access-review', authenticateSuperAdmin, [
  body('adminId').isInt({ min: 1 }).withMessage('adminId is required').toInt(),
  body('decision').custom((value) => {
    if (['keep', 'deactivate'].includes(String(value || '').trim().toLowerCase())) return true;
    throw new Error('decision must be Keep or Deactivate');
  }),
  body('reassignToAdminId').optional({ values: 'falsy' }).isInt({ min: 1 }),
  body('reason').optional({ values: 'falsy' }).isString(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const adminId = req.body.adminId;
    const decision = String(req.body.decision).trim().toLowerCase() === 'keep' ? 'Keep' : 'Deactivate';

    const existing = await pool.query(
      'SELECT id, username FROM admin WHERE id = $1 AND deleted_at IS NULL',
      [adminId]
    );
    const admin = existing.rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    let reassignedClients = 0;
    let reassignedTo = null;
    if (decision === 'Deactivate') {
      const reason = req.body.reason ? String(req.body.reason).trim() : 'Access review: deactivated';
      const outcome = await offboardAdmin({
        req,
        adminId,
        reassignTo: req.body.reassignToAdminId,
        mode: 'deactivate',
        reason,
      });
      if (outcome.error) {
        return res.status(outcome.status).json({ error: outcome.error, clientCount: outcome.clientCount });
      }
      reassignedClients = outcome.clientCount;
      reassignedTo = outcome.reassignedTo;
    }

    const saved = await pool.query(
      `INSERT INTO access_review_decision (admin_id, decision, decided_by)
       VALUES ($1, $2, $3) RETURNING id, admin_id, decision, decided_by, created_at`,
      [adminId, decision, req.admin.id]
    );
    await logActivity({
      ...actorOf(req),
      action: decision === 'Keep' ? 'access_review_keep' : 'access_review_deactivate',
      targetType: 'admin',
      targetId: adminId,
      teamAdminId: adminId,
      meta: { decision, reassignedClients, reassignedTo },
    });

    res.status(201).json({
      message: decision === 'Keep' ? `Kept access for ${admin.username}` : `${admin.username} deactivated`,
      decision: saved.rows[0],
      reassignedClients,
      reassignedTo,
    });
  } catch (error) {
    console.error('Error recording access review decision:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== ASSOCIATE CHANGE ====================

// One associate replaces another: move every client from -> to, deactivate and sign out `from`,
// and send `to` an invite / reset link so they can set up their own credentials.
router.post('/super-admin/associate-change', authenticateSuperAdmin, [
  body('fromAdminId').isInt({ min: 1 }).withMessage('fromAdminId is required').toInt(),
  body('toAdminId').isInt({ min: 1 }).withMessage('toAdminId is required').toInt(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const { fromAdminId, toAdminId } = req.body;
    if (Number(fromAdminId) === Number(toAdminId)) {
      return res.status(400).json({ error: 'Choose two different admins' });
    }

    const toRes = await pool.query(
      `SELECT id, username, name, email, last_login_at FROM admin
       WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [toAdminId]
    );
    const toAdmin = toRes.rows[0];
    if (!toAdmin) {
      return res.status(400).json({ error: 'The incoming admin must be an active, non-deleted admin' });
    }

    const outcome = await offboardAdmin({
      req,
      adminId: fromAdminId,
      reassignTo: toAdminId,
      mode: 'deactivate',
      reason: 'Associate change',
    });
    if (outcome.error) {
      return res.status(outcome.status).json({ error: outcome.error, clientCount: outcome.clientCount });
    }
    // offboardAdmin already deactivated `from`, revoked its sessions and emailed both admins

    let linkOutcome = { sent: false, reason: 'no_email' };
    if (toAdmin.email) {
      linkOutcome = await sendAccessLink('admin', toAdmin);
    }

    await logActivity({
      ...actorOf(req),
      action: 'associate_change',
      targetType: 'admin',
      targetId: toAdminId,
      teamAdminId: toAdminId,
      meta: {
        fromAdminId,
        toAdminId,
        clientsMoved: outcome.clientCount,
        accessLink: linkOutcome.purpose || null,
        accessLinkSent: Boolean(linkOutcome.sent),
      },
    });

    res.json({
      message: `${outcome.clientCount} client(s) moved to ${toAdmin.username}; ${outcome.admin.username} was deactivated and signed out.`,
      clientsMoved: outcome.clientCount,
      fromAdminId,
      toAdminId,
      accessLinkSent: Boolean(linkOutcome.sent),
    });
  } catch (error) {
    console.error('Error processing associate change:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== PLAN VIEW (activity) ====================

// Staff opened a client's plan. Clients log their own views via POST /api/activity/plan-view.
router.post('/activity/plan-view', authenticateAdmin, [
  body('clientId').isInt({ min: 1 }).withMessage('clientId is required').toInt(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const client = await loadClientForAdmin(req, res, req.body.clientId);
    if (!client) return;
    const logged = await logPlanView({
      actorRole: req.admin.role,
      actorId: req.admin.id,
      actorLabel: req.admin.username,
      clientId: client.id,
      teamAdminId: client.admin_id || null,
    });
    res.json({ logged });
  } catch (error) {
    console.error('Error logging plan view:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
