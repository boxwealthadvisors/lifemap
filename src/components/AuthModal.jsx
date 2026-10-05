import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { X } from 'lucide-react';

function modeFromTab(tab) {
  return tab === 'signup' || tab === 'register' ? 'signup' : 'signin';
}

const AuthModal = ({ isOpen, onClose, onAuthenticated, initialMode, defaultTab }) => {
  const { login, register, requestOtp, error, loading, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const controlled = isOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState(modeFromTab(initialMode || defaultTab || 'signin'));
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });
  const [signupForm, setSignupForm] = useState({
    name: '',
    email: '',
    password: '',
    confirm: '',
    otp: '',
  });

  const open = controlled ? isOpen : internalOpen;

  const close = () => {
    if (onClose) onClose();
    if (!controlled) setInternalOpen(false);
  };

  const switchMode = (next) => {
    clearError();
    setMode(next);
    setOtpSent(false);
    setDevCode('');
  };

  useEffect(() => {
    if (!controlled) return;
    if (isOpen) {
      setMode(modeFromTab(initialMode || defaultTab || 'signin'));
      setOtpSent(false);
      setDevCode('');
    }
  }, [controlled, isOpen, initialMode, defaultTab]);

  useEffect(() => {
    if (controlled) return undefined;
    const handler = (event) => {
      const tab = event?.detail?.tab || 'signin';
      setMode(modeFromTab(tab));
      setOtpSent(false);
      clearError();
      setInternalOpen(true);
      setDevCode('');
    };
    window.addEventListener('openAuthModal', handler);
    return () => window.removeEventListener('openAuthModal', handler);
  }, [clearError, controlled]);

  useEffect(() => {
    if (controlled) return;
    const params = new URLSearchParams(location.search);
    if (params.get('signup')) {
      setMode('signup');
      setInternalOpen(true);
    } else if (params.get('signin')) {
      setMode('signin');
      setInternalOpen(true);
    }
  }, [controlled, location.search]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await login(loginForm);
      if (response.role === 'super_admin') {
        close();
        navigate('/super-admin');
        return;
      }
      if (response.role === 'admin') {
        close();
        navigate('/admin');
        return;
      }
      await onAuthenticated?.({ mode: 'login', user: response.user, role: 'client' });
      close();
    } catch {
      // Error is handled by context
    }
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    clearError();
    if (signupForm.password !== signupForm.confirm) {
      return;
    }
    try {
      setSendingOtp(true);
      const response = await requestOtp(signupForm.email);
      setOtpSent(true);
      setDevCode(response?.devCode || '');
    } catch {
      // Error is handled by context
    } finally {
      setSendingOtp(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await register({
        name: signupForm.name,
        email: signupForm.email,
        password: signupForm.password,
        otp: signupForm.otp,
      });
      await onAuthenticated?.({ mode: 'register', user: response.user, role: 'client' });
      close();
    } catch {
      // Error is handled by context
    }
  };

  const handleLoginChange = (field, value) => {
    setLoginForm(prev => ({ ...prev, [field]: value }));
    clearError();
  };

  const handleSignupChange = (field, value) => {
    setSignupForm(prev => ({ ...prev, [field]: value }));
    clearError();
  };

  if (!open) return null;

  const passwordMismatch = mode === 'signup' && signupForm.confirm && signupForm.password !== signupForm.confirm;

  return (
    <div className="lm-modal-overlay" onClick={close}>
      <div className="lm-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div>
            <div className="lm-gate-brand" style={{ marginBottom: 8 }}>
              <span className="lm-mark" />
              <span>
                <span className="lm-brand-name">LifeMap</span>
                <span className="lm-brand-by">by BOX Wealth</span>
              </span>
            </div>
            <h2>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h2>
            {mode === 'signup' ? (
              <p style={{ margin: '6px 0 0', color: 'var(--muted, #5b6b80)', fontSize: 14 }}>
                We will email you a 6-digit code to confirm your address.
              </p>
            ) : null}
          </div>
          <button type="button" className="lm-iconbtn" onClick={close} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <Alert className="mb-4 border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        )}
        {passwordMismatch && (
          <Alert className="mb-4 border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">
              Passwords do not match
            </AlertDescription>
          </Alert>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleLoginSubmit} className="stack">
            <div>
              <Label htmlFor="login-identifier">Email or username</Label>
              <Input
                id="login-identifier"
                className="lm-inp"
                type="text"
                placeholder="Email or username"
                value={loginForm.identifier}
                onChange={(e) => handleLoginChange('identifier', e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                className="lm-inp"
                type="password"
                placeholder="Enter password"
                value={loginForm.password}
                onChange={(e) => handleLoginChange('password', e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="lm-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <p style={{ margin: '4px 0 0', fontSize: 14, textAlign: 'center' }}>
              New here?{' '}
              <button type="button" className="lm-tlink" onClick={() => switchMode('signup')}>
                Sign up
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={otpSent ? handleRegisterSubmit : handleSendCode} className="stack">
            <div>
              <Label htmlFor="signup-name">Your name</Label>
              <Input
                id="signup-name"
                className="lm-inp"
                type="text"
                placeholder="How should we address you?"
                value={signupForm.name}
                onChange={(e) => handleSignupChange('name', e.target.value)}
                required
                minLength={2}
                autoComplete="name"
                disabled={otpSent}
              />
            </div>
            <div>
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                className="lm-inp"
                type="email"
                placeholder="you@example.com"
                value={signupForm.email}
                onChange={(e) => handleSignupChange('email', e.target.value)}
                required
                autoComplete="email"
                disabled={otpSent}
              />
            </div>
            <div>
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                className="lm-inp"
                type="password"
                placeholder="At least 8 characters"
                value={signupForm.password}
                onChange={(e) => handleSignupChange('password', e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={otpSent}
              />
            </div>
            <div>
              <Label htmlFor="signup-confirm">Confirm password</Label>
              <Input
                id="signup-confirm"
                className="lm-inp"
                type="password"
                placeholder="Re-enter password"
                value={signupForm.confirm}
                onChange={(e) => handleSignupChange('confirm', e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={otpSent}
              />
            </div>
            {otpSent ? (
              <div>
                <Label htmlFor="signup-otp">Email code</Label>
                <Input
                  id="signup-otp"
                  className="lm-inp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  value={signupForm.otp}
                  onChange={(e) => handleSignupChange('otp', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  minLength={6}
                  maxLength={6}
                />
                {devCode ? (
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted, #5b6b80)' }}>
                    Dev code: {devCode}
                  </p>
                ) : (
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted, #5b6b80)' }}>
                    Check your inbox for a 6-digit code.
                  </p>
                )}
              </div>
            ) : null}
            <Button
              type="submit"
              className="lm-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading || sendingOtp || passwordMismatch}
            >
              {otpSent
                ? (loading ? 'Creating account…' : 'Create account')
                : (sendingOtp ? 'Sending code…' : 'Email me a code')}
            </Button>
            {otpSent ? (
              <p style={{ margin: 0, fontSize: 14, textAlign: 'center' }}>
                <button
                  type="button"
                  className="lm-tlink"
                  onClick={() => { setOtpSent(false); setDevCode(''); setSignupForm((prev) => ({ ...prev, otp: '' })); }}
                >
                  Use a different email
                </button>
                {' · '}
                <button type="button" className="lm-tlink" onClick={handleSendCode} disabled={sendingOtp}>
                  Resend code
                </button>
              </p>
            ) : null}
            <p style={{ margin: '4px 0 0', fontSize: 14, textAlign: 'center' }}>
              Already have an account?{' '}
              <button type="button" className="lm-tlink" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default AuthModal;
