import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapGate } from '../components/LifemapChrome';
import ApiService from '../services/api';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';

// Handles both "reset my password" (/reset-password) and the first-time
// "set your password" invite link (/set-password). Both use ?token=...
export default function ResetPasswordPage({ invite }) {
  const location = useLocation();
  const navigate = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search]);
  const isInvite = invite ?? location.pathname.startsWith('/set-password');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const title = isInvite ? 'Set your password' : 'Choose a new password';
  const subtitle = isInvite
    ? 'Welcome to LifeMap. Choose a password to activate your account.'
    : 'Enter a new password for your LifeMap account. This link works once and expires in 15 minutes.';

  const problem = password ? passwordProblem(password) : null;
  const mismatch = Boolean(confirm) && password !== confirm;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('This link is missing its token. Open the link from your email again.');
      return;
    }
    const weak = passwordProblem(password);
    if (weak) {
      setError(weak);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    try {
      setBusy(true);
      const response = await ApiService.resetPassword({ token, password });
      const message = response?.message
        || (isInvite ? 'Password set. You can sign in now.' : 'Password updated. Sign in with your new password.');
      setDone(message);
      toast.success(message);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.message || 'This link is invalid or has expired. Request a new one.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <LifemapGate title={isInvite ? 'Password set' : 'Password updated'} subtitle={done}>
        <div className="stack">
          <button type="button" className="lm-btn" onClick={() => navigate('/?signin=1', { replace: true })}>
            Sign in
          </button>
        </div>
      </LifemapGate>
    );
  }

  if (!token) {
    return (
      <LifemapGate title="Link not valid" subtitle="This link is missing its token. Open the link from your email again, or request a new one.">
        <div className="stack">
          <Link className="lm-btn" to="/?signin=1">Back to sign in</Link>
        </div>
      </LifemapGate>
    );
  }

  return (
    <LifemapGate title={title} subtitle={subtitle}>
      <form onSubmit={handleSubmit} className="stack">
        {error ? (
          <div role="alert" style={{ background: '#fef6f5', color: '#b42318', border: '1px solid #f5c6c0', borderRadius: 8, padding: '10px 12px', fontSize: 13.5 }}>
            {error}
          </div>
        ) : null}
        <div>
          <label htmlFor="rp-password">New password</label>
          <input
            id="rp-password"
            className="lm-inp"
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
          />
          <p className="lm-hint" style={problem ? { color: '#b42318' } : undefined}>
            {problem ? `${problem}. ` : ''}{PASSWORD_HINT}
          </p>
        </div>
        <div>
          <label htmlFor="rp-confirm">Confirm password</label>
          <input
            id="rp-confirm"
            className="lm-inp"
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setError(''); }}
            autoComplete="new-password"
            required
            minLength={8}
          />
          {mismatch ? <p className="lm-hint" style={{ color: '#b42318' }}>Passwords do not match</p> : null}
        </div>
        <button type="submit" className="lm-btn" disabled={busy || mismatch || !password || !confirm}>
          {busy ? 'Saving…' : (isInvite ? 'Set password' : 'Update password')}
        </button>
      </form>
    </LifemapGate>
  );
}
