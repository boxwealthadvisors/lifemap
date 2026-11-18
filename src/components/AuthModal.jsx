import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { passwordProblem, PASSWORD_HINT } from '../lib/password';
import { X } from 'lucide-react';

function modeFromTab(tab) {
  return tab === 'signup' || tab === 'register' ? 'signup' : 'signin';
}

const mutedStyle = { margin: '6px 0 0', fontSize: 13, color: 'var(--muted, #5b6b80)' };
const centerStyle = { margin: '4px 0 0', fontSize: 14, textAlign: 'center' };

const emptySignup = { name: '', email: '', password: '', confirm: '', otp: '', consent: false };

const AuthModal = ({ isOpen, onClose, onAuthenticated, initialMode, defaultTab }) => {
  const { login, verifyLogin, resendLoginOtp, register, requestOtp, error, loading, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const controlled = isOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [mode, setMode] = useState(modeFromTab(initialMode || defaultTab || 'signin')); // signin | signup | forgot | loginOtp
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [loginForm, setLoginForm] = useState({ identifier: '', password: '' });
  const [challenge, setChallenge] = useState({ pendingToken: '', challengeEmail: '', role: '' });
  const [loginOtp, setLoginOtp] = useState('');
  const [resending, setResending] = useState(false);
  const [signupForm, setSignupForm] = useState(emptySignup);
  const [forgotId, setForgotId] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');

  const open = controlled ? isOpen : internalOpen;

  const resetTransient = () => {
    setOtpSent(false);
    setDevCode('');
    setLoginOtp('');
    setForgotMessage('');
    setLocalError('');
    setNotice('');
  };

  const close = () => {
    if (onClose) onClose();
    if (!controlled) setInternalOpen(false);
  };

  const switchMode = (next) => {
    clearError();
    resetTransient();
    if (next !== 'loginOtp') setChallenge({ pendingToken: '', challengeEmail: '', role: '' });
    setMode(next);
  };

  useEffect(() => {
    if (!controlled) return;
    if (isOpen) {
      setMode(modeFromTab(initialMode || defaultTab || 'signin'));
      resetTransient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled, isOpen, initialMode, defaultTab]);

  useEffect(() => {
    if (controlled) return undefined;
    const handler = (event) => {
      const tab = event?.detail?.tab || 'signin';
      setMode(modeFromTab(tab));
      resetTransient();
      clearError();
      setInternalOpen(true);
    };
    window.addEventListener('openAuthModal', handler);
    return () => window.removeEventListener('openAuthModal', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Shared by the password-only path and the OTP step
  const finishSignIn = async (response) => {
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
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    try {
      const response = await login(loginForm);
      if (response.requiresOtp) {
        setChallenge({
          pendingToken: response.pendingToken,
          challengeEmail: response.challengeEmail || '',
          role: response.role || '',
        });
        setDevCode(response.devCode || '');
        setLoginOtp('');
        setNotice('');
        setLoginForm((prev) => ({ ...prev, password: '' }));
        setMode('loginOtp');
        return;
      }
      await finishSignIn(response);
    } catch {
      // Error is handled by context
    }
  };

  const handleLoginOtpSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    try {
      const response = await verifyLogin(challenge.pendingToken, loginOtp);
      setChallenge({ pendingToken: '', challengeEmail: '', role: '' });
      setLoginOtp('');
      await finishSignIn(response);
    } catch {
      // Error is handled by context
    }
  };

  const handleResendLoginOtp = async () => {
    clearError();
    setNotice('');
    try {
      setResending(true);
      const response = await resendLoginOtp(challenge.pendingToken);
      setDevCode(response?.devCode || '');
      setNotice('We sent you a new code.');
    } catch {
      // Error is handled by context
    } finally {
      setResending(false);
    }
  };

  const signupPasswordProblem = signupForm.password ? passwordProblem(signupForm.password) : null;
  const passwordMismatch = mode === 'signup' && signupForm.confirm && signupForm.password !== signupForm.confirm;

  const handleSendCode = async (e) => {
    e?.preventDefault?.();
    clearError();
    setLocalError('');
    if (!signupForm.consent) {
      setLocalError('Please accept the Privacy Notice to continue.');
      return;
    }
    if (signupForm.password !== signupForm.confirm) return;
    const problem = passwordProblem(signupForm.password);
    if (problem) {
      setLocalError(problem);
      return;
    }
    try {
      setSendingOtp(true);
      const response = await requestOtp(signupForm.email, 'signup');
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
    setLocalError('');
    if (!signupForm.consent) {
      setLocalError('Please accept the Privacy Notice to continue.');
      return;
    }
    try {
      const response = await register({
        name: signupForm.name,
        email: signupForm.email,
        password: signupForm.password,
        otp: signupForm.otp,
        consentAccepted: signupForm.consent === true,
      });
      setSignupForm(emptySignup);
      await onAuthenticated?.({ mode: 'register', user: response.user, role: 'client' });
      close();
    } catch {
      // Error is handled by context
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    clearError();
    setLocalError('');
    try {
      setForgotBusy(true);
      const response = await ApiService.forgotPassword(forgotId.trim());
      setForgotMessage(
        response?.message
        || 'If an account matches, we have emailed a reset link. It expires in 15 minutes.'
      );
    } catch (err) {
      // Only validation / rate-limit problems reach here; never reveal whether an account exists
      setLocalError(err.message || 'Could not send the reset link. Try again later.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleLoginChange = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
    clearError();
  };

  const handleSignupChange = (field, value) => {
    setSignupForm((prev) => ({ ...prev, [field]: value }));
    clearError();
    setLocalError('');
  };

  if (!open) return null;

  const heading = {
    signin: 'Sign in',
    signup: 'Create your account',
    forgot: 'Reset your password',
    loginOtp: 'Check your email',
  }[mode];

  const subheading = {
    signup: 'We will email you a 6-digit code to confirm your address.',
    forgot: 'Enter your email or username and we will email you a reset link.',
    loginOtp: `Enter the 6-digit code we sent to ${challenge.challengeEmail || 'your email'}${challenge.role && challenge.role !== 'client' ? ', or the code from your authenticator app if you have set one up' : ''}.`,
  }[mode];

  const shownError = localError || error;

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
            <h2>{heading}</h2>
            {subheading ? (
              <p style={{ margin: '6px 0 0', color: 'var(--muted, #5b6b80)', fontSize: 14 }}>
                {subheading}
              </p>
            ) : null}
          </div>
          <button type="button" className="lm-iconbtn" onClick={close} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {shownError && (
          <Alert className="mb-4 border-red-200 bg-red-50">
            <AlertDescription className="text-red-800">
              {shownError}
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

        {mode === 'signin' && (
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
              <p style={{ margin: '6px 0 0', fontSize: 13, textAlign: 'right' }}>
                <button type="button" className="lm-tlink" onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              </p>
            </div>
            <Button type="submit" className="lm-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            <p style={centerStyle}>
              New here?{' '}
              <button type="button" className="lm-tlink" onClick={() => switchMode('signup')}>
                Sign up
              </button>
            </p>
          </form>
        )}

        {mode === 'loginOtp' && (
          <form onSubmit={handleLoginOtpSubmit} className="stack">
            <div>
              <Label htmlFor="login-otp">Sign-in code</Label>
              <Input
                id="login-otp"
                className="lm-inp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={loginOtp}
                onChange={(e) => { setLoginOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); clearError(); }}
                required
                minLength={6}
                maxLength={6}
                autoFocus
              />
              {devCode ? (
                <p style={mutedStyle}>Dev code: {devCode}</p>
              ) : (
                <p style={mutedStyle}>The code expires in 10 minutes.</p>
              )}
              {notice ? <p style={{ ...mutedStyle, color: 'var(--lm-green, #0d8a78)' }}>{notice}</p> : null}
            </div>
            <Button
              type="submit"
              className="lm-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading || loginOtp.length !== 6}
            >
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </Button>
            <p style={centerStyle}>
              <button type="button" className="lm-tlink" onClick={handleResendLoginOtp} disabled={resending}>
                {resending ? 'Sending…' : 'Resend code'}
              </button>
              {' · '}
              <button type="button" className="lm-tlink" onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            </p>
          </form>
        )}

        {mode === 'forgot' && (
          forgotMessage ? (
            <div className="stack">
              <Alert className="border-green-200 bg-green-50">
                <AlertDescription className="text-green-800">{forgotMessage}</AlertDescription>
              </Alert>
              <p style={centerStyle}>
                <button type="button" className="lm-tlink" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              </p>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="stack">
              <div>
                <Label htmlFor="forgot-id">Email or username</Label>
                <Input
                  id="forgot-id"
                  className="lm-inp"
                  type="text"
                  placeholder="Email or username"
                  value={forgotId}
                  onChange={(e) => { setForgotId(e.target.value); setLocalError(''); }}
                  required
                  autoComplete="username"
                />
              </div>
              <Button type="submit" className="lm-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={forgotBusy}>
                {forgotBusy ? 'Sending…' : 'Email me a reset link'}
              </Button>
              <p style={centerStyle}>
                <button type="button" className="lm-tlink" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              </p>
            </form>
          )
        )}

        {mode === 'signup' && (
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
                placeholder="Create a strong password"
                value={signupForm.password}
                onChange={(e) => handleSignupChange('password', e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                disabled={otpSent}
              />
              <p style={{ ...mutedStyle, color: signupPasswordProblem ? 'var(--lm-coral, #c0392b)' : mutedStyle.color }}>
                {signupPasswordProblem && signupForm.password ? `${signupPasswordProblem}. ` : ''}
                {PASSWORD_HINT}
              </p>
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

            <div style={{ fontSize: 13, color: 'var(--muted, #5b6b80)', lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 6px' }}>
                <strong>What we collect:</strong> your name, email address, and the plan details you enter
                (age, income, assets, goals, loans, expenses and insurance).
              </p>
              <p style={{ margin: '0 0 6px' }}>
                <strong>Why:</strong> only to run LifeMap and keep your plan saved. We do not sell your data.
              </p>
              <p style={{ margin: '0 0 6px' }}>
                <strong>Who at BOX can see it:</strong> your assigned relationship manager (if you have one),
                BOX operations staff who support LifeMap, and BOX&apos;s privacy officer. Staff access to your
                plan is logged.
              </p>
              <p style={{ margin: 0 }}>
                You can ask us to correct your data, withdraw consent or raise a complaint at any time from
                Privacy &amp; Data in your account. Read the full{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="lm-tlink" style={{ textDecoration: 'underline' }}>Privacy Notice</a>.
              </p>
            </div>
            <label
              htmlFor="signup-consent"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, lineHeight: 1.45,
                cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontWeight: 500,
                color: 'inherit', marginBottom: 0,
              }}
            >
              <input
                id="signup-consent"
                type="checkbox"
                checked={signupForm.consent}
                onChange={(e) => handleSignupChange('consent', e.target.checked)}
                required
                style={{ marginTop: 3 }}
              />
              <span>
                I have read and agree to the{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="lm-tlink" style={{ textDecoration: 'underline' }}>Privacy Notice</a>
                {' '}and the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="lm-tlink" style={{ textDecoration: 'underline' }}>Terms of Use</a>,
                and consent to BOX Wealth processing my personal data as described.
              </span>
            </label>

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
                  <p style={mutedStyle}>Dev code: {devCode}</p>
                ) : (
                  <p style={mutedStyle}>Check your inbox for a 6-digit code.</p>
                )}
              </div>
            ) : null}
            <Button
              type="submit"
              className="lm-btn"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading || sendingOtp || passwordMismatch || !signupForm.consent}
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
            <p style={centerStyle}>
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
