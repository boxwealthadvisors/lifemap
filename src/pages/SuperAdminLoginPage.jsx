import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapGate } from '../components/LifemapChrome';

export default function SuperAdminLoginPage() {
  const { superAdminLogin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (isSuperAdmin) navigate('/super-admin');
  }, [isSuperAdmin, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await superAdminLogin(credentials);
      toast.success('Signed in');
      navigate('/super-admin');
    } catch (error) {
      toast.error('Login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LifemapGate title="Super admin sign in" subtitle="Assign admins and move clients between them.">
      <form onSubmit={handleSubmit} className="stack">
        <div>
          <label htmlFor="sa-user">Username</label>
          <input id="sa-user" className="lm-inp" value={credentials.username} onChange={(e) => setCredentials({ ...credentials, username: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="sa-pass">Password</label>
          <input id="sa-pass" className="lm-inp" type="password" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} required />
        </div>
        <button type="submit" className="lm-btn" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </LifemapGate>
  );
}
