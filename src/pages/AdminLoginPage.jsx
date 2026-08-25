import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapGate } from '../components/LifemapChrome';

export default function AdminLoginPage() {
  const { adminLogin, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isAdmin) navigate('/admin');
  }, [isAdmin, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await adminLogin(credentials);
      toast.success('Signed in');
      navigate('/admin');
    } catch (error) {
      toast.error(error.message || error.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LifemapGate title="Admin sign in" subtitle="Manage the client plans assigned to you.">
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <label htmlFor="admin-user">Username</label>
          <input id="admin-user" className="lm-inp" value={credentials.username} onChange={(e) => setCredentials({ ...credentials, username: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="admin-pass">Password</label>
          <input id="admin-pass" className="lm-inp" type="password" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} required />
        </div>
        <button type="submit" className="lm-btn" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </LifemapGate>
  );
}
