import React, { useState } from 'react';
import { toast } from 'sonner';
import ApiService from '../services/api';

function generateLoginPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function AccountSettingsModal({ role, admin, onClose, onSaved }) {
  const isSuper = role === 'super_admin';
  const [form, setForm] = useState({
    username: admin?.username || '',
    name: admin?.name || '',
    email: admin?.email || '',
    currentPassword: '',
    password: '',
    confirmPassword: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password && form.password !== form.confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }
    if (form.password && !form.currentPassword) {
      toast.error('Enter your current password to set a new one');
      return;
    }

    const payload = {
      username: form.username.trim(),
    };
    if (!isSuper) {
      payload.name = form.name.trim();
      payload.email = form.email.trim();
    }
    if (form.password) {
      payload.password = form.password;
      payload.current_password = form.currentPassword;
    }

    try {
      setSaving(true);
      const response = isSuper
        ? await ApiService.updateSuperAdminProfile(payload)
        : await ApiService.updateAdminProfile(payload);
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
            ? 'Change your super admin username or password.'
            : 'Change your advisor login, name, email, or password.'}
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
            <>
              <div>
                <label htmlFor="acct-name">Name</label>
                <input
                  id="acct-name"
                  className="lm-inp"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="acct-email">Email</label>
                <input
                  id="acct-email"
                  className="lm-inp"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </>
          )}
          <div>
            <label htmlFor="acct-current">Current password {form.password ? '' : '(only if changing password)'}</label>
            <input
              id="acct-current"
              className="lm-inp"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              required={Boolean(form.password)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="acct-new">New password (leave blank to keep)</label>
            <input
              id="acct-new"
              className="lm-inp"
              type="password"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="acct-confirm">Confirm new password</label>
            <input
              id="acct-confirm"
              className="lm-inp"
              type="password"
              minLength={6}
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              autoComplete="new-password"
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

export function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    password: '',
    confirmPassword: '',
  });
  const [saving, setSaving] = useState(false);
  const [issuedPassword, setIssuedPassword] = useState(null);

  const handleGenerate = () => {
    const password = generateLoginPassword();
    setForm((prev) => ({ ...prev, password, confirmPassword: password }));
  };

  const copyPassword = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy. Select the password and copy it yourself.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password && form.password !== form.confirmPassword) {
      toast.error('New password and confirmation do not match');
      return;
    }

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
    };
    if (form.password) payload.password = form.password;

    try {
      setSaving(true);
      const response = await ApiService.updateUser(user.id, payload);
      onSaved(response.user);
      if (form.password) {
        setIssuedPassword(form.password);
        toast.success('Client updated. Copy the new password and give it to them privately.');
        return;
      }
      toast.success('Client updated');
      onClose();
    } catch (error) {
      toast.error(error.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lm-modal-overlay" onClick={issuedPassword ? undefined : onClose}>
      <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit client</h2>
        {issuedPassword ? (
          <div className="stack">
            <p className="sub">Give this password to the client. LifeMap will not show it again.</p>
            <div>
              <label htmlFor="issued-pass">New password</label>
              <input id="issued-pass" className="lm-inp" readOnly value={issuedPassword} />
            </div>
            <div className="lm-modal-acts">
              <button type="button" className="lm-ghost" onClick={() => copyPassword(issuedPassword)}>Copy</button>
              <button type="button" className="lm-btn" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <p className="sub">Change their sign-in email, name, or reset their password. Leave password blank to keep the current one.</p>
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
                <label htmlFor="edit-user-pass">New password (optional)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="edit-user-pass"
                    className="lm-inp"
                    type="text"
                    minLength={6}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="off"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="lm-ghost" onClick={handleGenerate}>Generate</button>
                </div>
              </div>
              <div>
                <label htmlFor="edit-user-confirm">Confirm new password</label>
                <input
                  id="edit-user-confirm"
                  className="lm-inp"
                  type="text"
                  minLength={6}
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="submit" className="lm-btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
