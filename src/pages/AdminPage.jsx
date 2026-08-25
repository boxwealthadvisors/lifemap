import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { Trash2, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { AccountSettingsModal, EditUserModal } from '../components/AccountSettingsModal';
import ClientPlanView from '../components/ClientPlanView';

export default function AdminPage() {
  const { admin, setAdmin, adminLogout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [editClient, setEditClient] = useState(null);

  const [clientForm, setClientForm] = useState({
    email: '',
    password: '',
    name: '',
  });

  useEffect(() => {
    if (!isAdmin) {
      navigate('/admin/login');
      return;
    }
    loadClients();
  }, [isAdmin, navigate]);

  const loadClients = async () => {
    try {
      setLoading(true);
      const response = await ApiService.getAdminUsers();
      setClients(response.users || []);
    } catch (error) {
      console.error('Failed to load clients:', error);
      toast.error('Failed to load clients: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    try {
      await ApiService.createUser(clientForm);
      toast.success('Client created');
      setShowCreateClient(false);
      setClientForm({ email: '', password: '', name: '' });
      loadClients();
    } catch (error) {
      toast.error('Failed to create client: ' + error.message);
    }
  };

  const handleDeleteClient = async (clientId) => {
    if (!confirm('Delete this client? All of their plan data will be deleted.')) {
      return;
    }
    try {
      await ApiService.deleteUser(clientId);
      toast.success('Client deleted');
      if (selectedClient?.id === clientId) setSelectedClient(null);
      loadClients();
    } catch (error) {
      toast.error('Failed to delete client: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  if (loading) {
    return (
      <LifemapAdminShell title="Admin" kicker="BOX Wealth">
        <div className="lm-card" style={{ padding: 48, textAlign: 'center', color: 'var(--lm-muted)' }}>Loading…</div>
      </LifemapAdminShell>
    );
  }

  if (selectedClient) {
    return (
      <ClientPlanView
        clientId={selectedClient.id}
        clientName={selectedClient.name || selectedClient.email}
        onBack={() => setSelectedClient(null)}
      />
    );
  }

  return (
    <LifemapAdminShell
      title="Your clients"
      kicker={`Signed in as ${admin?.name || admin?.username || 'Admin'}`}
      actions={(
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lm-ghost" onClick={() => setShowAccount(true)}>Account</button>
          <button type="button" className="lm-btn" onClick={handleLogout}>Logout</button>
        </span>
      )}
    >
      <div className="lm-card">
        <div className="lm-reghead">
          <h3>Client register</h3>
          <span className="count">{clients.length} clients</span>
          <div className="r">
            <button type="button" className="lm-ghost primary" onClick={() => setShowCreateClient(true)}>+ Create client</button>
          </div>
        </div>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={4}>No clients assigned to you yet</td>
                </tr>
              ) : clients.map((client) => (
                <tr
                  key={client.id}
                  className={selectedClient?.id === client.id ? 'on' : ''}
                  onClick={() => setSelectedClient(client)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{client.email}</td>
                  <td>{client.name}</td>
                  <td>{client.created_at ? new Date(client.created_at).toLocaleDateString() : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="lm-iconbtn" onClick={() => setEditClient(client)} aria-label="Edit client">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button type="button" className="lm-iconbtn danger" onClick={() => handleDeleteClient(client.id)} aria-label="Delete client">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAccount ? (
        <AccountSettingsModal
          role="admin"
          admin={admin}
          onClose={() => setShowAccount(false)}
          onSaved={(updated) => setAdmin({ ...admin, ...updated })}
        />
      ) : null}

      {editClient ? (
        <EditUserModal
          user={editClient}
          onClose={() => setEditClient(null)}
          onSaved={(updated) => {
            setClients((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
            if (selectedClient?.id === updated.id) setSelectedClient({ ...selectedClient, ...updated });
          }}
        />
      ) : null}

      {showCreateClient ? (
        <div className="lm-modal-overlay" onClick={() => setShowCreateClient(false)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create client</h2>
            <p className="sub">They will be able to sign in and save a plan.</p>
            <form onSubmit={handleCreateClient} className="stack">
              <div>
                <label htmlFor="new-email">Email</label>
                <input id="new-email" className="lm-inp" type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} required />
              </div>
              <div>
                <label htmlFor="new-password">Password</label>
                <input id="new-password" className="lm-inp" type="password" value={clientForm.password} onChange={(e) => setClientForm({ ...clientForm, password: e.target.value })} required minLength={6} />
              </div>
              <div>
                <label htmlFor="new-name">Name</label>
                <input id="new-name" className="lm-inp" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} required />
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowCreateClient(false)}>Cancel</button>
                <button type="submit" className="lm-btn">Create client</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </LifemapAdminShell>
  );
}
