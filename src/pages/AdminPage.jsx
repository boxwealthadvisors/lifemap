import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { Trash2, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { AccountSettingsModal, EditUserModal } from '../components/AccountSettingsModal';
import ClientPlanView from '../components/ClientPlanView';
import {
  ActivityLogSection,
  AdminTabs,
  DeletedItemsSection,
  PrivacyRequestsAdminSection,
  TextPromptModal,
} from '../components/AdminSections';
import { formatDate, formatDateTime } from '../lib/password';

const TABS = [
  { id: 'clients', label: 'Clients' },
  { id: 'deleted', label: 'Deleted clients' },
  { id: 'privacy', label: 'Privacy requests' },
  { id: 'activity', label: 'Activity (team)' },
];

export default function AdminPage() {
  const { admin, setAdmin, adminLogout, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('clients');
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Clients choose their own password from an emailed invite link
  const [clientForm, setClientForm] = useState({ email: '', name: '' });

  useEffect(() => {
    if (authLoading) return;
    if (admin?.role === 'super_admin') {
      navigate('/super-admin');
      return;
    }
    if (!isAdmin) {
      navigate('/?signin=1');
      return;
    }
    loadClients();
  }, [authLoading, isAdmin, admin, navigate]);

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
      setCreating(true);
      const response = await ApiService.createUser({
        email: clientForm.email.trim(),
        name: clientForm.name.trim(),
      });
      if (response.inviteEmailSent === false) {
        toast.warning(response.message || 'Client created, but the invite email could not be sent.');
      } else {
        toast.success(`Client created. We emailed ${clientForm.email.trim()} a link to set their password.`);
      }
      setShowCreateClient(false);
      setClientForm({ email: '', name: '' });
      loadClients();
    } catch (error) {
      toast.error('Failed to create client: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClient = async (reason) => {
    const client = deleteTarget;
    try {
      await ApiService.deleteUser(client.id, reason);
      toast.success('Client deleted. A super admin can restore them for 90 days.');
      if (selectedClient?.id === client.id) setSelectedClient(null);
      setDeleteTarget(null);
      loadClients();
    } catch (error) {
      toast.error('Failed to delete client: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  if (authLoading || loading) {
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
        onClientUpdated={(updated) => {
          setSelectedClient((prev) => (prev ? { ...prev, ...updated } : prev));
          setClients((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        }}
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
      <AdminTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'clients' ? (
        <div className="lm-card">
          <div className="lm-reghead">
            <h3>Client register</h3>
            <span className="count">{clients.length} clients</span>
            <div className="r">
              <button type="button" className="lm-ghost primary" onClick={() => setShowCreateClient(true)}>+ Create client</button>
            </div>
          </div>
          <p className="lm-hint" style={{ padding: '0 16px 8px', margin: 0 }}>
            New clients get an email to set their own password. Deleted clients can be restored by a super admin for 90 days.
          </p>
          <div className="lm-tblwrap">
            <table className="lm-tbl">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Created on</th>
                  <th>Last login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td className="empty" colSpan={5}>No clients assigned to you yet</td>
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
                    <td>{formatDate(client.created_at)}</td>
                    <td>{client.last_login_at ? formatDateTime(client.last_login_at) : 'Never'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="lm-iconbtn" onClick={() => setEditClient(client)} aria-label="Edit client">
                          <Edit className="h-4 w-4" />
                        </button>
                        <button type="button" className="lm-iconbtn danger" onClick={() => setDeleteTarget(client)} aria-label="Delete client">
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
      ) : null}

      {tab === 'deleted' ? <DeletedItemsSection isSuper={false} /> : null}
      {tab === 'privacy' ? <PrivacyRequestsAdminSection /> : null}
      {tab === 'activity' ? <ActivityLogSection isSuper={false} /> : null}

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

      {deleteTarget ? (
        <TextPromptModal
          title="Delete client?"
          description={`${deleteTarget.name || deleteTarget.email} will be signed out and removed from your list. A super admin can restore them for 90 days.`}
          label="Reason for deleting"
          placeholder="For example: client asked to close their account"
          confirmLabel="Delete client"
          danger
          onConfirm={handleDeleteClient}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}

      {showCreateClient ? (
        <div className="lm-modal-overlay" onClick={() => setShowCreateClient(false)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create client</h2>
            <p className="sub">We will email them a link to set their own password. You never see or set it.</p>
            <form onSubmit={handleCreateClient} className="stack">
              <div>
                <label htmlFor="new-name">Name</label>
                <input id="new-name" className="lm-inp" value={clientForm.name} onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })} required minLength={2} />
              </div>
              <div>
                <label htmlFor="new-email">Email</label>
                <input id="new-email" className="lm-inp" type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} required />
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowCreateClient(false)}>Cancel</button>
                <button type="submit" className="lm-btn" disabled={creating}>{creating ? 'Creating…' : 'Create and send invite'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </LifemapAdminShell>
  );
}
