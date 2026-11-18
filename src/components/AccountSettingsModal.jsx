import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import ApiService from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';

// Authenticator app (TOTP) for staff sign-in: an alternative to the emailed code.
function TotpSection({ accountEmail }) {
  const [enabled, setEnabled] = useState(null); // null = loading
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState('');
  const [disable, setDisable] = useState({ open: false, password: '', otp: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ApiService.getTotpStatus()
      .then((res) => { if (!cancelled) setEnabled(Boolean(res.enabled)); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    try {
      setBusy(true);
      setSetup(await ApiService.setupTotp());
      setCode('');
    } catch (error) {
      toast.error(error.message || 'Could not start the authenticator setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    try {
      setBusy(true);
      await ApiService.enableTotp(code.trim());
      setEnabled(true);
      setSetup(null);
      toast.success('Authenticator app enabled');
    } catch (error) {
      toast.error(error.message || 'That code did not work');
    } finally {
      setBusy(false);
    }
  };

  const sendEmailCode = async () => {
    try {
      const res = await ApiService.requestOtp({ email: accountEmail, purpose: 'sensitive' });
      toast.success(res?.devCode ? `Code sent (dev code ${res.devCode})` : 'We emailed you a code');
    } catch (error) {
      toast.error(error.message || 'Could not send the code');
    }
  };

  const remove = async () => {
    try {
      setBusy(true);
      await ApiService.disableTotp({ password: disable.password, otp: disable.otp.trim() });
      setEnabled(false);
      setDisable({ open: false, password: '', otp: '' });
      toast.success('Authenticator app disabled');
    } catch (error) {
      toast.error(error.message || 'Could not disable the authenticator app');
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--lm-line, #e3e8ef)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15 }}>Authenticator app</h3>
      <p className="lm-hint" style={{ margin: '0 0 8px' }}>
        {enabled
          ? 'On. You can sign in with the 6-digit code from your authenticator app instead of the emailed code.'
          : 'Optional. Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...) instead of the emailed sign-in code.'}
      </p>

      {!enabled && !setup ? (
        <button type="button" className="lm-ghost" onClick={start} disabled={busy}>Set up authenticator app</button>
      ) : null}

      {!enabled && setup ? (
        <div className="stack">
          <p className="lm-hint" style={{ margin: 0 }}>
            In your app, add an account manually with this key (time-based, 6 digits), or open the link on a device that has the app:
          </p>
          <code style={{ display: 'block', padding: 8, background: 'var(--lm-bg, #f4f6fa)', borderRadius: 6, wordBreak: 'break-all' }}>
            {setup.secret}
          </code>
          <a className="lm-tlink" href={setup.otpauthUrl} style={{ textDecoration: 'underline' }}>Open in authenticator app</a>
          <div>
            <label htmlFor="totp-code">Code from the app</label>
            <input
              id="totp-code"
              className="lm-inp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="lm-btn" onClick={confirm} disabled={busy || code.length !== 6}>Enable</button>
            <button type="button" className="lm-ghost" onClick={() => setSetup(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}

      {enabled && !disable.open ? (
        <button type="button" className="lm-ghost" style={{ color: '#b42318' }} onClick={() => setDisable({ ...disable, open: true })}>
          Disable authenticator app
        </button>
      ) : null}

      {enabled && disable.open ? (
        <div className="stack">
          <div>
            <label htmlFor="totp-off-pass">Password</label>
            <input
              id="totp-off-pass"
              className="lm-inp"
              type="password"
              autoComplete="current-password"
              value={disable.password}
              onChange={(e) => setDisable({ ...disable, password: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="totp-off-otp">Authenticator code or emailed code</label>
            <input
              id="totp-off-otp"
              className="lm-inp"
              inputMode="numeric"
              maxLength={6}
              value={disable.otp}
              onChange={(e) => setDisable({ ...disable, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
            />
            <p className="lm-hint">
              Lost your phone?{' '}
              <button type="button" className="lm-tlink" onClick={sendEmailCode}>Email me a code instead</button>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="lm-btn" onClick={remove} disabled={busy || !disable.password || disable.otp.length !== 6}>
              Disable
            </button>
            <button type="button" className="lm-ghost" onClick={() => setDisable({ open: false, password: '', otp: '' })} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Staff (admin / super admin) changing their own sign-in details.
// ANY change to username, email or password needs the current password AND a security code we email
// to the address on file (requested here before saving). Passwords are never set on anyone else's behalf.
export function AccountSettingsModal({ role, admin, onClose, onSaved }) {
  const isSuper = role === 'super_admin';
  const { adminLogout } = useAuth();
  const [form, setForm] = useState({
    username: admin?.username || '',
    name: admin?.name || '',
    email: admin?.email || '',
    currentPassword: '',
    password: '',
    confirmPassword: '',
    otp: '',
  });
  const [saving, setSaving] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [devCode, setDevCode] = useState('');

  const initial = {
    username: admin?.username || '',
    name: admin?.name || '',
    email: admin?.email || '',
  };
  const usernameChanged = form.username.trim() !== initial.username;
  const emailChanged = form.email.trim().toLowerCase() !== String(initial.email).toLowerCase();
  const nameChanged = !isSuper && form.name.trim() !== initial.name;
  const needsCurrent = usernameChanged || emailChanged || Boolean(form.password);
  const newPasswordProblem = form.password ? passwordProblem(form.password) : null;

  // The security code goes to the address currently on file (not the new one)
  const sendCode = async () => {
    if (!initial.email) {
      toast.error('No email address is on file for this account. Ask a super admin to add one first.');
      return false;
    }
    try {
      setSendingCode(true);
      const res = await ApiService.requestOtp({ email: initial.email, purpose: 'sensitive' });
      setCodeSent(true);
      setDevCode(res?.devCode || '');
      toast.success(`We emailed a security code to ${initial.email}`);
      return true;
    } catch (error) {
      toast.error(error.message || 'Could not send the security code');
      return false;
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password && form.password !== form.confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }
    if (newPasswordProblem) {
      toast.error(newPasswordProblem);
      return;
    }
    if (needsCurrent && !form.currentPassword) {
      toast.error('Enter your current password to change your username, email or password');
      return;
    }
    if (!usernameChanged && !emailChanged && !nameChanged && !form.password) {
      toast.message('Nothing to change');
      return;
    }
    if (needsCurrent && form.otp.trim().length !== 6) {
      // Request the security code first, then let them type it in
      if (!codeSent) await sendCode();
      else toast.error('Enter the 6-digit security code we emailed you');
      return;
    }

    const payload = {};
    if (usernameChanged) payload.username = form.username.trim();
    if (nameChanged) payload.name = form.name.trim();
    if (emailChanged) payload.email = form.email.trim();
    if (form.password) payload.password = form.password;
    if (needsCurrent) {
      payload.current_password = form.currentPassword;
      payload.otp = form.otp.trim();
    }

    try {
      setSaving(true);
      const response = isSuper
        ? await ApiService.updateSuperAdminProfile(payload)
        : await ApiService.updateAdminProfile(payload);
      if (response.reauthRequired) {
        // Every session is revoked after a password change
        toast.success('Password changed. Please sign in again.');
        await adminLogout();
        window.location.assign('/?signin=1');
        return;
      }
      toast.success('Account updated');
      onSaved(response.admin);
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to update account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lm-modal-overlay" onClick={onClose}>
      <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Your account</h2>
        <p className="sub">
          {isSuper
            ? 'Change your super admin username, email or password.'
            : 'Change your advisor login, name, email, or password.'}
          {' '}Changing your username, email or password needs your current password and a security code we email
          to you, and we send an alert when it happens.
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <div>
            <label htmlFor="acct-user">Username</label>
            <input
              id="acct-user"
              className="lm-inp"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              minLength={3}
            />
          </div>
          {isSuper ? null : (
            <div>
              <label htmlFor="acct-name">Name</label>
              <input
                id="acct-name"
                className="lm-inp"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          )}
          <div>
            <label htmlFor="acct-email">Email</label>
            <input
              id="acct-email"
              className="lm-inp"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {isSuper ? null : <p className="lm-hint">Advisor emails must be @boxwealth.in addresses.</p>}
          </div>
          <div>
            <label htmlFor="acct-current">
              Current password {needsCurrent ? '' : '(needed to change username, email or password)'}
            </label>
            <input
              id="acct-current"
              className="lm-inp"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required={needsCurrent}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="acct-new">New password (leave blank to keep)</label>
            <input
              id="acct-new"
              className="lm-inp"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
            {form.password ? (
              <p className="lm-hint" style={newPasswordProblem ? { color: '#b42318' } : undefined}>
                {newPasswordProblem ? `${newPasswordProblem}. ` : ''}{PASSWORD_HINT}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="acct-confirm">Confirm new password</label>
            <input
              id="acct-confirm"
              className="lm-inp"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              autoComplete="new-password"
              disabled={!form.password}
            />
          </div>
          {needsCurrent ? (
            <div>
              <label htmlFor="acct-otp">Security code</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  id="acct-otp"
                  className="lm-inp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  maxLength={6}
                  value={form.otp}
                  onChange={(e) => setForm({ ...form, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                />
                <button type="button" className="lm-ghost" onClick={sendCode} disabled={sendingCode || saving}>
                  {sendingCode ? 'Sending…' : (codeSent ? 'Resend code' : 'Email me a code')}
                </button>
              </div>
              <p className="lm-hint">
                {codeSent
                  ? `We emailed a code to ${initial.email}. It expires in 10 minutes.${devCode ? ` Dev code: ${devCode}` : ''}`
                  : `Click "Email me a code" to send a code to ${initial.email || 'your email'} before saving.`}
              </p>
            </div>
          ) : null}
          <div className="lm-modal-acts">
            <button type="button" className="lm-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="lm-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
        <TotpSection accountEmail={initial.email} />
      </div>
    </div>
  );
}

// Staff editing a client's name / email. Passwords are never set here: send a reset link instead.
export function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
  });
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    if (form.name.trim() !== (user?.name || '')) payload.name = form.name.trim();
    if (form.email.trim().toLowerCase() !== String(user?.email || '').toLowerCase()) payload.email = form.email.trim();
    if (Object.keys(payload).length === 0) {
      toast.message('Nothing to change');
      return;
    }

    try {
      setSaving(true);
      const response = await ApiService.updateUser(user.id, payload);
      onSaved(response.user);
      toast.success('Client updated');
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  const handleSendReset = async () => {
    try {
      setSendingReset(true);
      const response = await ApiService.sendUserReset(user.id);
      toast.success(response?.message || 'Reset link sent');
    } catch (error) {
      toast.error(error.message || 'Could not send the reset link');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="lm-modal-overlay" onClick={onClose}>
      <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit client</h2>
        <p className="sub">
          Change their sign-in email or name. Passwords are never set for a client: send them a link and they choose their own.
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <div>
            <label htmlFor="edit-user-email">Email</label>
            <input
              id="edit-user-email"
              className="lm-inp"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <p className="lm-hint">Changing the email signs the client out of their devices.</p>
          </div>
          <div>
            <label htmlFor="edit-user-name">Name</label>
            <input
              id="edit-user-name"
              className="lm-inp"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={2}
            />
          </div>
          <div>
            <button type="button" className="lm-ghost" onClick={handleSendReset} disabled={sendingReset}>
              {sendingReset ? 'Sending…' : 'Send reset link'}
            </button>
          </div>
          <div className="lm-modal-acts">
            <button type="button" className="lm-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="lm-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
