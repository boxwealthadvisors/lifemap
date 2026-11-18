import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import pool from '../config/database.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { generateAdminToken, authenticateAdmin } from '../middleware/adminAuth.js';
import { notifyEmail } from '../lib/notify.js';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  otpauthUrl,
  verifyTotp,
} from '../lib/totp.js';
import {
  APP_BASE_URL,
  PRIVACY_CONTACT,
  PRIVACY_CONTACT_NAME,
  PRIVACY_NOTICE_VERSION,
  DATA_HOSTING_REGION,
  RESET_TTL_MS,
  alertSuperAdmins,
  clearFailures,
  consumeOtp,
  consumeResetToken,
  createResetOrInviteToken,
  createSession,
  isLocked,
  isSessionValid,
  issueOtp,
  logActivity,
  logPlanView,
  newJti,
  newPrivacyRef,
  normalizeEmail,
  registerFailure,
  resetLink,
  revokeAllSessions,
  sendOtpMail,
  validateStrongPassword,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
} from '../lib/security.js';

const router = express.Router();

const OTP_PURPOSES = ['signup', 'login', 'sensitive'];
const PRIVACY_REQUEST_TYPES = ['data_summary', 'correction', 'withdraw_consent', 'complaint', 'nomination'];
const PRIVACY_RESPONSE_DAYS = 90;
const PENDING_TOKEN_TTL = '5m';

// Never match a real account; used to keep login timing similar for unknown identifiers
const DUMMY_HASH = bcrypt.hashSync('lifemap-dummy-password-not-real', 12);

const ROLE_TABLE = {
  client: 'public."user"',
  admin: 'admin',
  super_admin: 'super_admin',
};

const makeLimiter = (max, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
});

const otpLimiter = makeLimiter(8, 'Too many code requests. Try again later.');
const loginLimiter = makeLimiter(30, 'Too many sign-in attempts. Try again later.');
const verifyLimiter = makeLimiter(20, 'Too many verification attempts. Try again later.');
const forgotLimiter = makeLimiter(10, 'Too many reset requests. Try again later.');
const resetLimiter = makeLimiter(20, 'Too many attempts. Try again later.');
const registerLimiter = makeLimiter(20, 'Too many sign-up attempts. Try again later.');
const resendLimiter = makeLimiter(8, 'Too many code requests. Try again later.');
const sensitiveLimiter = makeLimiter(15, 'Too many attempts. Try again later.');
const privacyLimiter = makeLimiter(10, 'Too many privacy requests. Try again later.');

// ---------- helpers ----------

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({ error: errors.array()[0]?.msg || 'Validation failed', details: errors.array() });
  return true;
}

const strongPassword = (field) =>
  body(field).custom((value) => {
    const problem = validateStrongPassword(value);
    if (problem) throw new Error(problem);
    return true;
  });

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '';
  return `${local.slice(0, 1)}***@${domain}`;
}

function clientMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
    ip: req.ip || null,
  };
}

function bearerToken(req) {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
}

function publicUser(role, row) {
  if (role === 'client') return { id: row.id, email: row.email, name: row.name };
  if (role === 'admin') {
    return { id: row.id, username: row.username, name: row.name, email: row.email, role: 'admin' };
  }
  return { id: row.id, username: row.username, email: row.email, role: 'super_admin' };
}

function teamAdminFor(role, row) {
  if (role === 'client') return row.admin_id || null;
  if (role === 'admin') return row.id;
  return null;
}

function actorLabel(role, row) {
  return role === 'client' ? row.email : row.username;
}

async function findClientByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, name, password_hash, admin_id, failed_attempts, locked_until
     FROM "user" WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] || null;
}

async function findStaff(role, identifier) {
  const isAdmin = role === 'admin';
  const result = await pool.query(
    `SELECT id, username, ${isAdmin ? 'name,' : ''} email, password_hash,
            ${isAdmin ? 'is_active,' : ''} failed_attempts, locked_until
     FROM ${ROLE_TABLE[role]}
     WHERE (username = $1 OR LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1))
       ${isAdmin ? 'AND deleted_at IS NULL' : ''}
     ORDER BY (username = $1) DESC
     LIMIT 1`,
    [identifier]
  );
  return result.rows[0] || null;
}

async function loadAccount(role, id) {
  if (role === 'client') {
    const r = await pool.query(
      `SELECT id, email, name, admin_id, failed_attempts, locked_until
       FROM "user" WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] || null;
  }
  if (role === 'admin') {
    const r = await pool.query(
      `SELECT id, username, name, email, is_active, failed_attempts, locked_until, totp_secret
       FROM admin WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return r.rows[0] || null;
  }
  if (role === 'super_admin') {
    const r = await pool.query(
      `SELECT id, username, email, failed_attempts, locked_until, totp_secret FROM super_admin WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }
  return null;
}

// Resolve an authenticated subject (client or staff) from the bearer token, without erroring.
async function resolveBearerSubject(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.pending || !decoded.jti) return null;
    const role = decoded.role;
    const id = role === 'client' ? decoded.userId : decoded.adminId;
    if (!ROLE_TABLE[role] || !id) return null;
    if (!(await isSessionValid(decoded.jti, role, id))) return null;
    const account = await loadAccount(role, id);
    if (!account) return null;
    return { role, id, email: account.email, account };
  } catch {
    return null;
  }
}

async function issueAndSendOtp(email, purpose) {
  const issued = await issueOtp(email, purpose);
  if (issued.error) return { throttled: issued.status === 429, error: issued.error, status: issued.status };
  try {
    await sendOtpMail(issued.email, issued.code, purpose);
  } catch (mailError) {
    console.error('OTP email failed:', mailError.message);
    return { error: 'Could not send the verification email. Try again later.', status: 503 };
  }
  return { code: issued.code };
}

function devCodePayload(payload, code) {
  if (process.env.NODE_ENV !== 'production' && code) {
    payload.devCode = code;
  }
  return payload;
}

// ---------- OTP ----------

router.post('/otp', otpLimiter, [
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('purpose').optional({ values: 'falsy' }).isIn(OTP_PURPOSES).withMessage('Invalid code purpose'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const purpose = req.body.purpose || 'signup';
    let email = normalizeEmail(req.body.email);

    if (purpose === 'signup') {
      const existing = await pool.query(
        'SELECT id FROM "user" WHERE LOWER(email) = $1 LIMIT 1',
        [email]
      );
      if (existing.rows[0]) {
        return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
      }
    } else if (purpose === 'login') {
      // Do not reveal whether an account exists: respond identically either way.
      const client = await findClientByEmail(email);
      const staff = client ? null : (await findStaff('admin', email)) || (await findStaff('super_admin', email));
      const account = client || staff;
      const generic = { message: 'If an account exists for this email, we sent a 6-digit code.' };
      if (!account || (staff && staff.is_active === false)) {
        return res.json(generic);
      }
      const sent = await issueAndSendOtp(email, 'login');
      if (sent.error && !sent.throttled) {
        return res.status(sent.status || 503).json({ error: sent.error });
      }
      return res.json(devCodePayload(generic, sent.code));
    } else {
      // sensitive: only for the signed-in account, and only to its own email address
      const subject = await resolveBearerSubject(req);
      if (!subject) {
        return res.status(401).json({ error: 'Sign in to request a security code' });
      }
      if (!subject.email) {
        return res.status(400).json({ error: 'No email address is on file for this account' });
      }
      if (email !== normalizeEmail(subject.email)) {
        return res.status(403).json({ error: 'Codes can only be sent to your own email address' });
      }
      email = normalizeEmail(subject.email);
    }

    const sent = await issueAndSendOtp(email, purpose);
    if (sent.error) {
      return res.status(sent.status || 503).json({ error: sent.error });
    }

    return res.json(devCodePayload({ message: 'We sent a 6-digit code to your email.' }, sent.code));
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Register ----------

router.post('/register', registerLimiter, [
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('name').trim().isLength({ min: 2 }).withMessage('Enter your name'),
  strongPassword('password'),
  body('otp').optional(),
  body('code').optional(),
  body('consentAccepted')
    .custom((value) => value === true || value === 'true')
    .withMessage('You must accept the Privacy Notice to create an account'),
], async (req, res) => {
  const client = await pool.connect();
  try {
    if (validationFailed(req, res)) return;

    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    const code = String(req.body.otp || req.body.code || '').replace(/\s+/g, '');

    const existing = await client.query(
      'SELECT id FROM "user" WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    }

    const otp = await consumeOtp(email, 'signup', code);
    if (otp.error) {
      return res.status(otp.status || 400).json({ error: otp.error });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO "user"
         (email, password_hash, name, admin_id, consent_version, consent_at, last_login_at, created_at)
       VALUES ($1, $2, $3, NULL, $4, NOW(), NOW(), NOW())
       RETURNING id, email, name, created_at`,
      [email, passwordHash, name, PRIVACY_NOTICE_VERSION]
    );
    const user = userResult.rows[0];
    await client.query(
      `INSERT INTO financial_profile
         (user_id, age, lifespan_years, income_growth_rate, asset_growth_rate, inflation_rate, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [user.id, 32, 85, 0.08, 0.11, 0.06]
    );
    await client.query('COMMIT');

    const jti = newJti();
    await createSession({ role: 'client', subjectId: user.id, jti, ...clientMeta(req) });

    await logActivity({
      actorRole: 'client',
      actorId: user.id,
      actorLabel: user.email,
      action: 'client_signup',
      targetType: 'user',
      targetId: user.id,
      meta: { consentVersion: PRIVACY_NOTICE_VERSION },
    });

    return res.status(201).json({
      message: 'Account created',
      role: 'client',
      token: generateToken(user.id, jti),
      user: { id: user.id, email: user.email, name: user.name },
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

// ---------- Login (password step -> OTP step) ----------

function signPending(role, id) {
  return jwt.sign({ pending: true, role, id }, process.env.JWT_SECRET, { expiresIn: PENDING_TOKEN_TTL });
}

router.post('/login', loginLimiter, [
  body('password').notEmpty().withMessage('Enter your password'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const identifier = String(req.body.identifier || req.body.email || req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!identifier) {
      return res.status(400).json({ error: 'Enter your email or username' });
    }

    const candidates = identifier.includes('@')
      ? [
          { role: 'client', find: () => findClientByEmail(identifier) },
          { role: 'admin', find: () => findStaff('admin', identifier) },
          { role: 'super_admin', find: () => findStaff('super_admin', identifier) },
        ]
      : [
          { role: 'admin', find: () => findStaff('admin', identifier) },
          { role: 'super_admin', find: () => findStaff('super_admin', identifier) },
        ];

    let matched = false;
    let lockedHit = false;
    let success = null;

    for (const candidate of candidates) {
      const account = await candidate.find();
      if (!account) continue;
      matched = true;

      if (isLocked(account)) {
        lockedHit = true;
        continue;
      }

      const ok = await bcrypt.compare(password, account.password_hash || '');
      if (!ok) {
        const failure = await registerFailure(ROLE_TABLE[candidate.role], account.id);
        await logActivity({
          actorRole: candidate.role,
          actorId: account.id,
          actorLabel: actorLabel(candidate.role, account),
          action: 'failed_login',
          targetType: candidate.role === 'client' ? 'user' : candidate.role,
          targetId: account.id,
          teamAdminId: teamAdminFor(candidate.role, account),
          meta: { stage: 'password', failedAttempts: failure?.failed_attempts ?? null, ip: req.ip || null },
        });
        if (failure && isLocked(failure)) {
          lockedHit = true;
          await logActivity({
            actorRole: candidate.role,
            actorId: account.id,
            actorLabel: actorLabel(candidate.role, account),
            action: 'account_locked',
            targetType: candidate.role === 'client' ? 'user' : candidate.role,
            targetId: account.id,
            teamAdminId: teamAdminFor(candidate.role, account),
            meta: { failedAttempts: failure.failed_attempts },
          });
          if (candidate.role !== 'client') {
            await alertSuperAdmins(
              'LifeMap security alert: staff account locked',
              `The ${candidate.role === 'admin' ? 'admin' : 'super admin'} account "${account.username}" was locked after ${MAX_FAILED_ATTEMPTS} failed sign-in attempts (IP ${req.ip || 'unknown'}).`
            );
          }
        }
        continue;
      }

      if (candidate.role === 'admin' && !account.is_active) {
        return res.status(403).json({ error: 'Admin account is inactive. Please contact super admin to activate your account.' });
      }

      success = { role: candidate.role, account };
      break;
    }

    if (!success) {
      if (!matched) {
        await bcrypt.compare(password, DUMMY_HASH);
      }
      if (lockedHit) {
        return res.status(429).json({
          error: `Too many failed attempts. Try again in ${Math.round(LOCKOUT_MS / 60000)} minutes.`,
        });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { role, account } = success;
    if (!account.email) {
      return res.status(403).json({
        error: 'No email address is on file for this account. Contact your super admin.',
      });
    }

    const sent = await issueAndSendOtp(account.email, 'login');
    if (sent.error && !sent.throttled) {
      return res.status(sent.status || 503).json({ error: sent.error });
    }

    return res.json(devCodePayload({
      message: 'Enter the 6-digit code we emailed you to finish signing in.',
      requiresOtp: true,
      role,
      challengeEmail: maskEmail(account.email),
      pendingToken: signPending(role, account.id),
    }, sent.code));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function readPending(pendingToken) {
  try {
    const decoded = jwt.verify(String(pendingToken || ''), process.env.JWT_SECRET);
    if (!decoded.pending || !ROLE_TABLE[decoded.role] || !decoded.id) return null;
    return decoded;
  } catch {
    return null;
  }
}

router.post('/login/resend', resendLimiter, [
  body('pendingToken').notEmpty(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const pending = readPending(req.body.pendingToken);
    if (!pending) {
      return res.status(401).json({ error: 'Your sign-in session expired. Enter your password again.' });
    }
    const account = await loadAccount(pending.role, pending.id);
    if (!account || !account.email || (pending.role === 'admin' && !account.is_active)) {
      return res.status(401).json({ error: 'Your sign-in session expired. Enter your password again.' });
    }
    const sent = await issueAndSendOtp(account.email, 'login');
    if (sent.error) {
      return res.status(sent.status || 503).json({ error: sent.error });
    }
    return res.json(devCodePayload({ message: 'We sent a new 6-digit code to your email.' }, sent.code));
  } catch (error) {
    console.error('Login resend error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login/verify', verifyLimiter, [
  body('pendingToken').notEmpty().withMessage('Sign-in session missing'),
  body('otp').custom((value, { req }) => {
    if (String(value || req.body.totp || '').trim()) return true;
    throw new Error('Enter the 6-digit code we emailed you');
  }),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const pending = readPending(req.body.pendingToken);
    if (!pending) {
      return res.status(401).json({ error: 'Your sign-in session expired. Enter your password again.' });
    }

    const account = await loadAccount(pending.role, pending.id);
    if (!account) {
      return res.status(401).json({ error: 'Account not found' });
    }
    if (pending.role === 'admin' && !account.is_active) {
      return res.status(403).json({ error: 'Admin account is inactive. Please contact super admin to activate your account.' });
    }
    if (isLocked(account)) {
      return res.status(429).json({ error: 'Account temporarily locked. Try again later.' });
    }
    if (!account.email) {
      return res.status(403).json({ error: 'No email address is on file for this account.' });
    }

    // Staff with an authenticator app (TOTP) may use that code instead of the emailed code.
    const submitted = String(req.body.otp || req.body.totp || '').replace(/\s+/g, '');
    let totpUsed = false;
    if (pending.role !== 'client' && account.totp_secret) {
      const secret = decryptTotpSecret(account.totp_secret);
      totpUsed = Boolean(secret) && verifyTotp(secret, submitted);
    }

    if (!totpUsed) {
      const otp = await consumeOtp(account.email, 'login', submitted, {
        role: pending.role,
        subjectId: account.id,
        tableSql: ROLE_TABLE[pending.role],
        actorLabel: actorLabel(pending.role, account),
        teamAdminId: teamAdminFor(pending.role, account),
        ip: req.ip || null,
      });
      if (otp.error) {
        if (otp.locked) {
          await logActivity({
            actorRole: pending.role,
            actorId: account.id,
            actorLabel: actorLabel(pending.role, account),
            action: 'account_locked',
            targetType: pending.role === 'client' ? 'user' : pending.role,
            targetId: account.id,
            teamAdminId: teamAdminFor(pending.role, account),
            meta: { stage: 'otp', failedAttempts: otp.failedAttempts ?? null },
          });
          if (pending.role !== 'client') {
            await alertSuperAdmins(
              'LifeMap security alert: staff account locked',
              `The ${pending.role === 'admin' ? 'admin' : 'super admin'} account "${account.username}" was locked after repeated incorrect sign-in codes (IP ${req.ip || 'unknown'}).`
            );
          }
        }
        return res.status(otp.status || 400).json({ error: otp.error });
      }
    }

    await clearFailures(ROLE_TABLE[pending.role], account.id);

    const jti = newJti();
    await createSession({ role: pending.role, subjectId: account.id, jti, ...clientMeta(req) });

    await logActivity({
      actorRole: pending.role,
      actorId: account.id,
      actorLabel: actorLabel(pending.role, account),
      action: 'login',
      targetType: pending.role === 'client' ? 'user' : pending.role,
      targetId: account.id,
      teamAdminId: teamAdminFor(pending.role, account),
      meta: { ip: req.ip || null, method: totpUsed ? 'totp' : 'email_otp' },
    });

    const token = pending.role === 'client'
      ? generateToken(account.id, jti)
      : generateAdminToken(account.id, pending.role, jti);

    return res.json({
      message: 'Login successful',
      role: pending.role,
      user: publicUser(pending.role, account),
      token,
    });
  } catch (error) {
    console.error('Login verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Password reset ----------

const FORGOT_MESSAGE = 'If an account matches, we have emailed a reset link. It expires in 15 minutes.';

router.post('/forgot-password', forgotLimiter, [
  body('emailOrUsername').trim().notEmpty().withMessage('Enter your email or username'),
], async (req, res) => {
  if (validationFailed(req, res)) return;

  // Always the same response, sent before any lookup work so timing does not leak account existence.
  res.json({ message: FORGOT_MESSAGE });

  try {
    const identifier = String(req.body.emailOrUsername || '').trim();
    let found = null;

    if (identifier.includes('@')) {
      const client = await findClientByEmail(identifier);
      if (client) found = { role: 'client', account: client };
    }
    if (!found) {
      const admin = await findStaff('admin', identifier);
      if (admin) found = { role: 'admin', account: admin };
    }
    if (!found) {
      const superAdmin = await findStaff('super_admin', identifier);
      if (superAdmin) found = { role: 'super_admin', account: superAdmin };
    }
    if (!found || !found.account.email) return;

    const { role, account } = found;
    const token = await createResetOrInviteToken({
      role,
      subjectId: account.id,
      email: account.email,
      purpose: 'reset',
      ttlMs: RESET_TTL_MS,
    });
    const link = resetLink(token, 'reset');
    await notifyEmail(
      account.email,
      'Reset your LifeMap password',
      `We received a request to reset your LifeMap password.\n\nUse this link within 15 minutes:\n${link}\n\nIf you did not request this, ignore this email; your password will not change.`
    );
    await logActivity({
      actorRole: role,
      actorId: account.id,
      actorLabel: actorLabel(role, account),
      action: 'password_reset_requested',
      targetType: role === 'client' ? 'user' : role,
      targetId: account.id,
      teamAdminId: teamAdminFor(role, account),
    });
  } catch (error) {
    console.error('Forgot password error:', error);
  }
});

router.post('/reset-password', resetLimiter, [
  body('token').isString().notEmpty().withMessage('Reset link is missing'),
  strongPassword('password'),
], async (req, res) => {
  try {
    // Validate the password first so a weak password does not burn the one-time link.
    if (validationFailed(req, res)) return;

    const consumed = await consumeResetToken(String(req.body.token), ['reset', 'invite']);
    if (consumed.error) {
      return res.status(consumed.status || 400).json({ error: consumed.error });
    }
    const tokenRow = consumed.row;
    const role = tokenRow.role;
    const account = await loadAccount(role, tokenRow.subject_id);
    if (!account) {
      return res.status(400).json({ error: 'This link is invalid or already used' });
    }

    const passwordHash = await bcrypt.hash(String(req.body.password), 12);
    await pool.query(
      `UPDATE ${ROLE_TABLE[role]}
       SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, account.id]
    );
    await revokeAllSessions(role, account.id);

    const wasInvite = tokenRow.purpose === 'invite';
    await notifyEmail(
      account.email || tokenRow.email,
      wasInvite ? 'Your LifeMap password was set' : 'Your LifeMap password was changed',
      `The password for your LifeMap account was just ${wasInvite ? 'set' : 'changed'}. All existing sessions were signed out.\n\nIf this was not you, contact ${PRIVACY_CONTACT} immediately.`
    );
    await logActivity({
      actorRole: role,
      actorId: account.id,
      actorLabel: actorLabel(role, account),
      action: wasInvite ? 'invite_accepted' : 'password_reset',
      targetType: role === 'client' ? 'user' : role,
      targetId: account.id,
      teamAdminId: teamAdminFor(role, account),
    });

    return res.json({
      message: wasInvite ? 'Password set. You can sign in now.' : 'Password updated. Sign in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/change-password', sensitiveLimiter, authenticateToken, [
  body('currentPassword').notEmpty().withMessage('Enter your current password'),
  strongPassword('newPassword'),
  body('otp').notEmpty().withMessage('Enter the 6-digit code we emailed you'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const { currentPassword, newPassword, otp } = req.body;

    const result = await pool.query(
      'SELECT id, email, password_hash, admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];

    const isValidPassword = await bcrypt.compare(String(currentPassword), user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const code = await consumeOtp(user.email, 'sensitive', otp);
    if (code.error) {
      return res.status(code.status || 400).json({ error: code.error });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 12);
    await pool.query(
      'UPDATE "user" SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, user.id]
    );
    await revokeAllSessions('client', user.id);

    await notifyEmail(
      user.email,
      'Your LifeMap password was changed',
      `Your LifeMap password was just changed and all devices were signed out.\n\nIf this was not you, reset your password right away and contact ${PRIVACY_CONTACT}.`
    );
    await logActivity({
      actorRole: 'client',
      actorId: user.id,
      actorLabel: user.email,
      action: 'password_changed',
      targetType: 'user',
      targetId: user.id,
      teamAdminId: user.admin_id || null,
    });

    res.json({ message: 'Password changed successfully. Please sign in again.', reauthRequired: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Session management ----------

router.post('/logout', async (req, res) => {
  try {
    const token = bearerToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
        if (decoded.jti) {
          await pool.query(
            'UPDATE auth_session SET revoked_at = NOW() WHERE jti = $1 AND revoked_at IS NULL',
            [decoded.jti]
          );
        }
      } catch {
        // invalid token: nothing to revoke
      }
    }
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/sessions/revoke-all', authenticateToken, async (req, res) => {
  try {
    await revokeAllSessions('client', req.user.id);
    await logActivity({
      actorRole: 'client',
      actorId: req.user.id,
      actorLabel: req.user.email,
      action: 'sessions_revoked_all',
      targetType: 'user',
      targetId: req.user.id,
    });
    res.json({ message: 'Signed out of all devices', reauthRequired: true });
  } catch (error) {
    console.error('Revoke sessions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Profile ----------

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, created_at, consent_version, consent_at, last_login_at
       FROM "user" WHERE id = $1 AND deleted_at IS NULL`,
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
        created_at: user.created_at,
        consent_version: user.consent_version,
        consent_at: user.consent_at,
        last_login_at: user.last_login_at,
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profile', sensitiveLimiter, authenticateToken, [
  body('name').optional().trim().isLength({ min: 2 }),
  body('email').optional().isEmail().withMessage('Please provide a valid email address'),
  body('currentPassword').optional(),
  body('otp').optional(),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const current = await pool.query(
      'SELECT id, email, name, password_hash, admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const existing = current.rows[0];

    const name = req.body.name ? String(req.body.name).trim() : undefined;
    const newEmail = req.body.email ? normalizeEmail(req.body.email) : undefined;
    const emailChanging = Boolean(newEmail) && newEmail !== normalizeEmail(existing.email);

    if (name === undefined && !emailChanging) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    if (emailChanging) {
      if (!req.body.currentPassword || !req.body.otp) {
        return res.status(400).json({
          error: 'Changing your email requires your current password and a security code',
          requires: ['currentPassword', 'otp'],
        });
      }
      const ok = await bcrypt.compare(String(req.body.currentPassword), existing.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const taken = await pool.query(
        'SELECT id FROM "user" WHERE LOWER(email) = $1 AND id != $2',
        [newEmail, existing.id]
      );
      if (taken.rows.length > 0) {
        return res.status(400).json({ error: 'Email already taken' });
      }
      const code = await consumeOtp(existing.email, 'sensitive', req.body.otp);
      if (code.error) {
        return res.status(code.status || 400).json({ error: code.error });
      }
    }

    const updates = [];
    const values = [];
    let paramCount = 1;
    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (emailChanging) {
      updates.push(`email = $${paramCount++}`);
      values.push(newEmail);
    }
    values.push(existing.id);

    const result = await pool.query(
      `UPDATE "user" SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount} RETURNING id, email, name, created_at, updated_at`,
      values
    );
    const user = result.rows[0];

    if (emailChanging) {
      await notifyEmail(
        existing.email,
        'Your LifeMap email address was changed',
        `The email address on your LifeMap account was changed to ${maskEmail(newEmail)}.\n\nIf this was not you, contact ${PRIVACY_CONTACT} immediately.`
      );
      await logActivity({
        actorRole: 'client',
        actorId: existing.id,
        actorLabel: newEmail,
        action: 'profile_email_changed',
        targetType: 'user',
        targetId: existing.id,
        teamAdminId: existing.admin_id || null,
        meta: { from: maskEmail(existing.email), to: maskEmail(newEmail) },
      });
    }

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    console.error('Profile update error:', error);

    if (error.code === '23505') {
      return res.status(400).json({ error: 'Email already exists. Please use a different email address.' });
    } else if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid data provided. Please check your information.' });
    } else if (error.code === '23514') {
      return res.status(400).json({ error: 'Invalid data format. Please check your input.' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Privacy (DPDP) ----------

router.get('/privacy-meta', (req, res) => {
  res.json({
    version: PRIVACY_NOTICE_VERSION,
    contact: PRIVACY_CONTACT,
    contactEmail: PRIVACY_CONTACT,
    contactName: PRIVACY_CONTACT_NAME,
    hostingRegion: DATA_HOSTING_REGION,
    privacyUrl: `${APP_BASE_URL}/privacy`,
    termsUrl: `${APP_BASE_URL}/terms`,
  });
});

router.post('/privacy-requests', privacyLimiter, authenticateToken, [
  body('type').isIn(PRIVACY_REQUEST_TYPES).withMessage('Choose a valid request type'),
  body('details').optional({ values: 'falsy' }).isString().trim().isLength({ max: 2000 })
    .withMessage('Details must be 2000 characters or fewer'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;

    const type = req.body.type;
    const details = req.body.details ? String(req.body.details).trim() : '';
    if (type !== 'withdraw_consent' && details.length < 3) {
      return res.status(400).json({ error: 'Please describe your request' });
    }

    const owner = await pool.query(
      'SELECT admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [req.user.id]
    );
    const teamAdminId = owner.rows[0]?.admin_id || null;

    const ref = newPrivacyRef();
    const dueAt = new Date(Date.now() + PRIVACY_RESPONSE_DAYS * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      `INSERT INTO privacy_request (ref, user_id, type, details, due_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ref, type, status, details, due_at, created_at`,
      [ref, req.user.id, type, details || null, dueAt]
    );
    const request = result.rows[0];

    await logActivity({
      actorRole: 'client',
      actorId: req.user.id,
      actorLabel: req.user.email,
      action: 'privacy_request_created',
      targetType: 'privacy_request',
      targetId: request.id,
      teamAdminId,
      meta: { ref, type },
    });

    const dueText = dueAt.toISOString().slice(0, 10);
    await notifyEmail(
      req.user.email,
      `LifeMap privacy request received (${ref})`,
      `We received your ${type.replace(/_/g, ' ')} request.\n\nReference: ${ref}\nWe will respond by ${dueText}.\n\nQuestions: ${PRIVACY_CONTACT}`
    );
    await notifyEmail(
      PRIVACY_CONTACT,
      `New privacy request ${ref}`,
      `A ${type.replace(/_/g, ' ')} request (${ref}) was submitted. Review it in the admin console. Due ${dueText}.`
    );

    res.status(201).json({ message: 'Request received', request });
  } catch (error) {
    console.error('Privacy request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/privacy-requests', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, ref, type, status, details, due_at, closed_at, created_at, updated_at
       FROM privacy_request WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ requests: result.rows });
  } catch (error) {
    console.error('Privacy requests list error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Client activity (transparency) ----------

// The signed-in client's own account activity only (rows where they are the actor).
router.get('/activity-log', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const result = await pool.query(
      `SELECT id, action, target_type, target_id, meta, created_at
       FROM activity_log
       WHERE actor_role = 'client' AND actor_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ entries: result.rows });
  } catch (error) {
    console.error('Client activity log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// A client opened their own plan (staff use POST /api/admin/activity/plan-view).
router.post('/activity/plan-view', authenticateToken, async (req, res) => {
  try {
    const owner = await pool.query('SELECT admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
    const logged = await logPlanView({
      actorRole: 'client',
      actorId: req.user.id,
      actorLabel: req.user.email,
      clientId: req.user.id,
      teamAdminId: owner.rows[0]?.admin_id || null,
    });
    res.json({ logged });
  } catch (error) {
    console.error('Plan view log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Staff authenticator app (TOTP) ----------

async function loadStaffSecurity(req) {
  const result = await pool.query(
    `SELECT id, username, email, password_hash, totp_secret, totp_pending_secret
     FROM ${ROLE_TABLE[req.admin.role]} WHERE id = $1`,
    [req.admin.id]
  );
  return result.rows[0] || null;
}

const staffActor = (req) => ({
  actorRole: req.admin.role,
  actorId: req.admin.id,
  actorLabel: req.admin.username,
  targetType: req.admin.role,
  targetId: req.admin.id,
  teamAdminId: req.admin.role === 'admin' ? req.admin.id : null,
});

router.get('/totp/status', authenticateAdmin, async (req, res) => {
  try {
    const row = await loadStaffSecurity(req);
    res.json({ enabled: Boolean(row?.totp_secret) });
  } catch (error) {
    console.error('TOTP status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 1: create a pending secret and return the otpauth:// URL for the authenticator app.
router.post('/totp/setup', sensitiveLimiter, authenticateAdmin, async (req, res) => {
  try {
    const row = await loadStaffSecurity(req);
    if (!row) return res.status(404).json({ error: 'Account not found' });
    if (row.totp_secret) {
      return res.status(400).json({ error: 'An authenticator app is already enabled. Disable it first to set up a new one.' });
    }
    const secret = generateTotpSecret();
    await pool.query(
      `UPDATE ${ROLE_TABLE[req.admin.role]} SET totp_pending_secret = $1, updated_at = NOW() WHERE id = $2`,
      [encryptTotpSecret(secret), row.id]
    );
    res.json({
      secret,
      otpauthUrl: otpauthUrl({ secret, account: row.email || row.username }),
      message: 'Add this to your authenticator app, then confirm with a 6-digit code.',
    });
  } catch (error) {
    console.error('TOTP setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 2: prove the app works by entering a current code; only then is the secret saved.
router.post('/totp/enable', sensitiveLimiter, authenticateAdmin, [
  body('code').notEmpty().withMessage('Enter the 6-digit code from your authenticator app'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const row = await loadStaffSecurity(req);
    if (!row) return res.status(404).json({ error: 'Account not found' });
    const pending = decryptTotpSecret(row.totp_pending_secret);
    if (!pending) {
      return res.status(400).json({ error: 'Start the authenticator setup first' });
    }
    if (!verifyTotp(pending, req.body.code)) {
      return res.status(400).json({ error: 'That code is incorrect. Check your authenticator app and try again.' });
    }
    await pool.query(
      `UPDATE ${ROLE_TABLE[req.admin.role]}
       SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    await logActivity({ ...staffActor(req), action: 'totp_enabled' });
    if (row.email) {
      await notifyEmail(
        row.email,
        'Authenticator app enabled on your LifeMap account',
        'An authenticator app was added to your LifeMap account. You can now sign in with its 6-digit code instead of the emailed code.\n\nIf this was not you, contact a super admin immediately.'
      );
    }
    res.json({ message: 'Authenticator app enabled', enabled: true });
  } catch (error) {
    console.error('TOTP enable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Disabling needs the password and a fresh proof of possession: a current authenticator code or an emailed code.
router.post('/totp/disable', sensitiveLimiter, authenticateAdmin, [
  body('password').notEmpty().withMessage('Enter your password'),
  body('otp').notEmpty().withMessage('Enter an authenticator code or the code we emailed you'),
], async (req, res) => {
  try {
    if (validationFailed(req, res)) return;
    const row = await loadStaffSecurity(req);
    if (!row) return res.status(404).json({ error: 'Account not found' });
    if (!row.totp_secret) {
      return res.status(400).json({ error: 'No authenticator app is enabled' });
    }
    const passwordOk = await bcrypt.compare(String(req.body.password), row.password_hash || '');
    if (!passwordOk) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    const secret = decryptTotpSecret(row.totp_secret);
    let proven = Boolean(secret) && verifyTotp(secret, req.body.otp);
    if (!proven) {
      if (!row.email) return res.status(400).json({ error: 'That code is incorrect' });
      const code = await consumeOtp(row.email, 'sensitive', req.body.otp);
      if (code.error) return res.status(code.status || 400).json({ error: code.error });
      proven = true;
    }
    await pool.query(
      `UPDATE ${ROLE_TABLE[req.admin.role]}
       SET totp_secret = NULL, totp_pending_secret = NULL, updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
    await logActivity({ ...staffActor(req), action: 'totp_disabled' });
    if (row.email) {
      await notifyEmail(
        row.email,
        'Authenticator app removed from your LifeMap account',
        'The authenticator app was removed from your LifeMap account. Sign-in now uses the emailed code only.\n\nIf this was not you, contact a super admin immediately.'
      );
    }
    res.json({ message: 'Authenticator app disabled', enabled: false });
  } catch (error) {
    console.error('TOTP disable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
