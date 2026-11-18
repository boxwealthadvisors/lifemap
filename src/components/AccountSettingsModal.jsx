import React, { useState } from 'react';
import { toast } from 'sonner';
import ApiService from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';

// Staff (admin / super admin) changing their own sign-in details.
// The backend requires the current password for any password or email change, so we ask for it
// for every change. Passwords are never set on anyone else's behalf.
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
  });
  const [saving, setSaving] = useState(false);

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

    const payload = {};
    if (usernameChanged) payload.username = form.username.trim();
    if (nameChanged) payload.name = form.name.trim();
    if (emailChanged) payload.email = form.email.trim();
    if (form.password) payload.password = form.password;
    if (needsCurrent) payload.current_password = form.currentPassword;

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
          {' '}Your current password is needed for any sign-in change, and we email an alert when it happens.
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
          <div className="lm-modal-acts">
            <button type="button" className="lm-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="lm-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
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
