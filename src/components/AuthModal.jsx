import React, { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { X } from 'lucide-react';

const AuthModal = ({ isOpen, onClose, onAuthenticated }) => {
  const { login, error, loading, clearError } = useAuth();
  const navigate = useNavigate();
  const [loginForm, setLoginForm] = useState({
    identifier: '',
    password: ''
  });

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await login(loginForm);
      if (response.role === 'super_admin') {
        onClose();
        navigate('/super-admin');
        return;
      }
      if (response.role === 'admin') {
        onClose();
        navigate('/admin');
        return;
      }
      await onAuthenticated?.({ mode: 'login', user: response.user, role: 'client' });
      onClose();
    } catch {
      // Error is handled by context
    }
  };

  const handleLoginChange = (field, value) => {
    setLoginForm(prev => ({ ...prev, [field]: value }));
    clearError();
  };

  if (!isOpen) return null;

  return (
    <div className="lm-modal-overlay" onClick={onClose}>
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
            <h2>Sign in</h2>
          </div>
          <button type="button" className="lm-iconbtn" onClick={onClose} aria-label="Close">
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

        <form onSubmit={handleLoginSubmit} className="stack">
          <div>
            <Label htmlFor="login-identifier">Username</Label>
            <Input
              id="login-identifier"
              className="lm-inp"
              type="text"
              placeholder="Enter username"
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
        </form>
      </div>
    </div>
  );
};

export default AuthModal;
