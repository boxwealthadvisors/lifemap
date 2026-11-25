import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { Trash2, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { AccountSettingsModal } from '../components/AccountSettingsModal';
import ClientPlanView from '../components/ClientPlanView';
import {
  AccessReviewSection,
  ActivityLogSection,
  AdminTabs,
  DeletedItemsSection,
  PrivacyRequestsAdminSection,
  TextPromptModal,
} from '../components/AdminSections';
import { formatDate, formatDateTime } from '../lib/password';

const TABS = [
  { id: 'admins', label: 'Admins' },
  { id: 'clients', label: 'Clients' },
  { id: 'activity', label: 'Activity log' },
  { id: 'deleted', label: 'Deleted items' },
  { id: 'privacy', label: 'Privacy requests' },
  { id: 'access', label: 'Access review' },
];

const emptyAdminForm = { username: '', name: '', email: '' };

function statusBadge(status) {
  if (status === 'locked') return <span className="lm-badge off">Locked</span>;
  if (status === 'unassigned') return <span className="lm-badge warn">Unassigned</span>;
  return <span className="lm-badge on">Active</span>;
}

export default function SuperAdminPage() {
  const { admin, setAdmin, adminLogout, isSuperAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('admins');
  const [admins, setAdmins] = useState([]);
  const [users, setUsers] = useState([]);
  const [clientFilter, setClientFilter] = useState('all'); // all | unassigned
  const [loading, setLoading] = useState(true);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [showEditAdmin, setShowEditAdmin] = useState(null);
  const [savingAdmin, setSavingAdmin] = useState(false);
  const [offboard, setOffboard] = useState(null); // { admin, mode: 'deactivate' | 'delete' }
  const [reassignTo, setReassignTo] = useState('');
  const [transfer, setTransfer] = useState(null); // client being transferred
  const [transferTo, setTransferTo] = useState('');
  const [deleteClient, setDeleteClient] = useState(null);
  const [showAccount, setShowAccount] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);

  // Admins never get a password set for them: they receive an invite link
  const [adminForm, setAdminForm] = useState(emptyAdminForm);

  const loadAdmins = useCallback(async () => {
    const res = await ApiService.getAdmins();
    setAdmins(res.admins || []);
  }, []);

  const loadUsers = useCallback(async (filter = clientFilter) => {
    const res = await ApiService.getAllUsers({ unassigned: filter === 'unassigned' });
    setUsers(res.users || []);
  }, [clientFilter]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([loadAdmins(), loadUsers()]);
    } catch (error) {
      toast.error('Failed to load data: ' + error.message);
    } finally {
      setLoading(false);
    }
  }, [loadAdmins, loadUsers]);

  useEffect(() => {
    if (authLoading) return;
    if (!isSuperAdmin) {
      navigate('/?signin=1');
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isSuperAdmin, navigate]);

  const changeClientFilter = async (next) => {
    setClientFilter(next);
    try {
      await loadUsers(next);
    } catch (error) {
      toast.error('Failed to load clients: ' + error.message);
    }
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    try {
      setCreatingAdmin(true);
      const response = await ApiService.createAdmin({
        username: adminForm.username.trim(),
        name: adminForm.name.trim() || undefined,
        email: adminForm.email.trim(),
      });
      if (response.inviteEmailSent === false) {
        toast.warning(response.message || 'Admin created, but the invite email could not be sent.');
      } else {
        toast.success(`Admin created. We emailed ${adminForm.email.trim()} a link to set their password.`);
      }
      setShowCreateAdmin(false);
      setAdminForm(emptyAdminForm);
      loadData();
    } catch (error) {
      toast.error('Failed to create admin: ' + error.message);
    } finally {
      setCreatingAdmin(false);
    }
  };

  const handleUpdateAdmin = async (e) => {
    e.preventDefault();
    try {
      setSavingAdmin(true);
      await ApiService.updateAdmin(showEditAdmin.id, {
        username: adminForm.username.trim(),
        name: adminForm.name.trim() || undefined,
        email: adminForm.email.trim() || undefined,
      });
      toast.success('Admin updated');
      setShowEditAdmin(null);
      setAdminForm(emptyAdminForm);
      loadAdmins().catch(() => {});
    } catch (error) {
      toast.error('Failed to update admin: ' + error.message);
    } finally {
      setSavingAdmin(false);
    }
  };

  const handleReactivate = async () => {
    try {
      await ApiService.updateAdmin(showEditAdmin.id, { is_active: true });
      toast.success('Admin reactivated');
      setShowEditAdmin(null);
      loadAdmins().catch(() => {});
    } catch (error) {
      toast.error('Failed to reactivate admin: ' + error.message);
    }
  };

  const handleSendAdminReset = async (a) => {
    try {
      const res = await ApiService.sendAdminReset(a.id);
      toast.success(res?.message || 'Reset link sent');
    } catch (error) {
      toast.error('Could not send the reset link: ' + error.message);
    }
  };

  const openOffboard = (a, mode) => {
    setReassignTo('');
    setOffboard({ admin: a, mode });
  };

  const handleOffboard = async (reason) => {
    const { admin: target, mode } = offboard;
    if ((target.user_count || 0) > 0 && !reassignTo) {
      toast.error('Choose an admin to receive their clients');
      return;
    }
    const payload = { reassignToAdminId: reassignTo ? Number(reassignTo) : undefined, reason };
    try {
      if (mode === 'delete') {
        await ApiService.deleteAdmin(target.id, payload);
        toast.success('Admin deleted. You can restore them from Deleted items for 90 days.');
      } else {
        await ApiService.deactivateAdmin(target.id, payload);
        toast.success('Admin deactivated');
      }
      setOffboard(null);
      setShowEditAdmin(null);
      setReassignTo('');
      loadData();
    } catch (error) {
      toast.error(`Failed to ${mode === 'delete' ? 'delete' : 'deactivate'} admin: ${error.message}`);
    }
  };

  const handleTransferClient = async (reason) => {
    try {
      // A client must always go to an active admin; there is no "unassigned" target.
      await ApiService.transferUser(transfer.id, parseInt(transferTo, 10), reason);
      toast.success('Client transferred');
      setTransfer(null);
      setTransferTo('');
      loadData();
    } catch (error) {
      toast.error('Failed to transfer client: ' + error.message);
    }
  };

  const handleDeleteClient = async (reason) => {
    try {
      await ApiService.deleteUser(deleteClient.id, reason);
      toast.success('Client deleted. You can restore them from Deleted items for 90 days.');
      setDeleteClient(null);
      loadData();
    } catch (error) {
      toast.error('Failed to delete client: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  const activeAdmins = admins.filter((a) => a.is_active);
  const receivers = offboard ? activeAdmins.filter((a) => a.id !== offboard.admin.id) : [];
  const transferTarget = activeAdmins.find((a) => String(a.id) === String(transferTo))?.username;

  const adminFormFields = (
    <>
      <div>
        <label htmlFor="adm-user">Username</label>
        <input id="adm-user" className="lm-inp" value={adminForm.username} onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })} required minLength={3} />
      </div>
      <div>
        <label htmlFor="adm-name">Name</label>
        <input id="adm-name" className="lm-inp" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="adm-email">Email</label>
        <input id="adm-email" className="lm-inp" type="email" placeholder="name@boxwealth.in" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} required={!showEditAdmin} />
        <p className="lm-hint">Must be a @boxwealth.in address. The admin sets their own password from an emailed link.</p>
      </div>
    </>
  );

  if (authLoading || loading) {
    return (
      <LifemapAdminShell title="Super admin" kicker="BOX Wealth">
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
          setUsers((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        }}
      />
    );
  }

  return (
    <LifemapAdminShell
      title="Admins and clients"
      kicker={`Signed in as ${admin?.username || 'Super admin'}`}
      actions={(
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lm-ghost" onClick={() => setShowAccount(true)}>Account</button>
          <button type="button" className="lm-btn" onClick={handleLogout}>Logout</button>
        </span>
      )}
    >
      <AdminTabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'admins' ? (
        <div className="lm-card">
          <div className="lm-reghead">
            <h3>Admin register</h3>
            <span className="count">{admins.length} admins</span>
            <div className="r">
              <button type="button" className="lm-ghost primary" onClick={() => { setAdminForm(emptyAdminForm); setShowCreateAdmin(true); }}>+ Create admin</button>
            </div>
          </div>
          <div className="lm-tblwrap">
            <table className="lm-tbl">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Clients</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th>Created on</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr><td className="empty" colSpan={8}>No admins yet</td></tr>
                ) : admins.map((a) => (
                  <tr key={a.id}>
                    <td>{a.username}</td>
                    <td>{a.name || '—'}</td>
                    <td>{a.email || '—'}</td>
                    <td>{a.user_count || 0}</td>
                    <td>
                      <span className={`lm-badge ${a.is_active ? 'on' : 'off'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>{a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}</td>
                    <td>{formatDate(a.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="lm-iconbtn" aria-label="Edit admin" onClick={() => {
                          setShowEditAdmin(a);
                          setAdminForm({ username: a.username, name: a.name || '', email: a.email || '' });
                        }}>
                          <Edit className="h-4 w-4" />
                        </button>
                        <button type="button" className="lm-iconbtn danger" aria-label="Delete admin" onClick={() => openOffboard(a, 'delete')}>
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

      {tab === 'clients' ? (
        <div className="lm-card">
          <div className="lm-reghead">
            <h3>Client register</h3>
            <span className="count">{users.length} clients</span>
            <div className="r">
              <select
                className="lm-inp"
                aria-label="Filter clients"
                value={clientFilter}
                onChange={(e) => changeClientFilter(e.target.value)}
              >
                <option value="all">All clients</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </div>
          </div>
          <div className="lm-tblwrap">
            <table className="lm-tbl">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Assigned admin</th>
                  <th>Status</th>
                  <th>Created on</th>
                  <th>Last login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td className="empty" colSpan={7}>{clientFilter === 'unassigned' ? 'No unassigned clients' : 'No clients yet'}</td></tr>
                ) : users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedClient(u)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{u.email}</td>
                    <td>{u.name}</td>
                    <td>{u.admin_username || 'Unassigned'}</td>
                    <td>{statusBadge(u.status)}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="lm-ghost" onClick={() => { setTransferTo(''); setTransfer(u); }}>
                          {u.admin_id ? 'Transfer' : 'Assign'}
                        </button>
                        <button type="button" className="lm-iconbtn danger" aria-label="Delete client" onClick={() => setDeleteClient(u)}>
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

      {tab === 'activity' ? <ActivityLogSection isSuper admins={admins} /> : null}
      {tab === 'deleted' ? <DeletedItemsSection isSuper onChanged={loadData} /> : null}
      {tab === 'privacy' ? <PrivacyRequestsAdminSection /> : null}
      {tab === 'access' ? <AccessReviewSection onChanged={loadData} /> : null}

      {showAccount ? (
        <AccountSettingsModal
          role="super_admin"
          admin={admin}
          onClose={() => setShowAccount(false)}
          onSaved={(updated) => setAdmin({ ...admin, ...updated })}
        />
      ) : null}

      {showCreateAdmin ? (
        <div className="lm-modal-overlay" onClick={() => setShowCreateAdmin(false)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create admin</h2>
            <p className="sub">We will email them an invite to set their own password.</p>
            <form onSubmit={handleCreateAdmin} className="stack">
              {adminFormFields}
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowCreateAdmin(false)}>Cancel</button>
                <button type="submit" className="lm-btn" disabled={creatingAdmin}>{creatingAdmin ? 'Creating…' : 'Create and send invite'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showEditAdmin ? (
        <div className="lm-modal-overlay" onClick={() => setShowEditAdmin(null)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit admin</h2>
            <p className="sub">Passwords are never set here. Send a link and they choose their own.</p>
            <form onSubmit={handleUpdateAdmin} className="stack">
              {adminFormFields}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="lm-ghost" onClick={() => handleSendAdminReset(showEditAdmin)}>Send reset link</button>
                {showEditAdmin.is_active ? (
                  <button type="button" className="lm-ghost" style={{ color: '#b42318' }} onClick={() => openOffboard(showEditAdmin, 'deactivate')}>Deactivate…</button>
                ) : (
                  <button type="button" className="lm-ghost" onClick={handleReactivate}>Reactivate</button>
                )}
                <button type="button" className="lm-ghost" style={{ color: '#b42318' }} onClick={() => openOffboard(showEditAdmin, 'delete')}>Delete…</button>
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowEditAdmin(null)}>Cancel</button>
                <button type="submit" className="lm-btn" disabled={savingAdmin}>{savingAdmin ? 'Saving…' : 'Update admin'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {offboard ? (
        <TextPromptModal
          title={`${offboard.mode === 'delete' ? 'Delete' : 'Deactivate'} ${offboard.admin.username}?`}
          description={
            `${(offboard.admin.user_count || 0) > 0
              ? `Their ${offboard.admin.user_count} client(s) must move to another active admin first. `
              : ''}${offboard.mode === 'delete'
              ? 'They are signed out and removed. You can restore them from Deleted items for 90 days.'
              : 'They are signed out and can no longer sign in until reactivated.'}`
          }
          label="Reason"
          placeholder="For example: left the company"
          confirmLabel={offboard.mode === 'delete' ? 'Delete admin' : 'Deactivate admin'}
          danger
          disabled={(offboard.admin.user_count || 0) > 0 && !reassignTo}
          onConfirm={handleOffboard}
          onClose={() => setOffboard(null)}
        >
          {(offboard.admin.user_count || 0) > 0 ? (
            <div>
              <label htmlFor="reassign-to">Reassign clients to *</label>
              <select id="reassign-to" className="lm-inp" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                <option value="">Select admin</option>
                {receivers.map((a) => (
                  <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''}</option>
                ))}
              </select>
            </div>
          ) : null}
        </TextPromptModal>
      ) : null}

      {transfer ? (
        <TextPromptModal
          title={transfer.admin_username ? 'Transfer client' : 'Assign client to an admin'}
          description={`Move ${transfer.name || transfer.email} from ${transfer.admin_username || 'Unassigned'}${transferTarget ? ` to ${transferTarget}` : ''}. The advisors involved are emailed with your reason.`}
          label="Reason for transfer"
          placeholder="For example: advisor on leave"
          confirmLabel="Confirm transfer"
          disabled={!transferTo}
          onConfirm={handleTransferClient}
          onClose={() => setTransfer(null)}
        >
          <div>
            <label htmlFor="xfer-admin">Move to *</label>
            <select id="xfer-admin" className="lm-inp" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
              <option value="" disabled>Select an active admin</option>
              {activeAdmins.filter((a) => a.id !== transfer.admin_id).map((a) => (
                <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''}</option>
              ))}
            </select>
          </div>
        </TextPromptModal>
      ) : null}

      {deleteClient ? (
        <TextPromptModal
          title="Delete client?"
          description={`${deleteClient.name || deleteClient.email} will be signed out and removed. You can restore them from Deleted items for 90 days.`}
          label="Reason for deleting"
          placeholder="For example: client asked to close their account"
          confirmLabel="Delete client"
          danger
          onConfirm={handleDeleteClient}
          onClose={() => setDeleteClient(null)}
        />
      ) : null}
    </LifemapAdminShell>
  );
}
