import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { Trash2, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { AccountSettingsModal } from '../components/AccountSettingsModal';

export default function SuperAdminPage() {
  const { admin, setAdmin, adminLogout, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [showEditAdmin, setShowEditAdmin] = useState(null);
  const [showTransferUser, setShowTransferUser] = useState(null);
  const [showAccount, setShowAccount] = useState(false);

  const [adminForm, setAdminForm] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
  });

  useEffect(() => {
    if (!isSuperAdmin) {
      navigate('/super-admin/login');
      return;
    }
    loadData();
  }, [isSuperAdmin, navigate]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [adminsRes, usersRes] = await Promise.all([
        ApiService.getAdmins(),
        ApiService.getAllUsers(),
      ]);
      setAdmins(adminsRes.admins || []);
      setUsers(usersRes.users || []);
    } catch (error) {
      toast.error('Failed to load data: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAdmin = async (e) => {
    e.preventDefault();
    try {
      await ApiService.createAdmin({
        username: adminForm.username.trim(),
        password: adminForm.password,
        name: adminForm.name.trim() || undefined,
        email: adminForm.email.trim() || undefined,
      });
      toast.success('Admin created successfully');
      setShowCreateAdmin(false);
      setAdminForm({ username: '', password: '', name: '', email: '' });
      loadData();
    } catch (error) {
      toast.error('Failed to create admin: ' + error.message);
    }
  };

  const handleUpdateAdmin = async (e) => {
    e.preventDefault();
    try {
      const updateData = {
        username: adminForm.username.trim(),
        name: adminForm.name.trim() || undefined,
        email: adminForm.email.trim() || undefined,
      };
      if (adminForm.password) updateData.password = adminForm.password;
      await ApiService.updateAdmin(showEditAdmin.id, updateData);
      toast.success('Admin updated successfully');
      setShowEditAdmin(null);
      setAdminForm({ username: '', password: '', name: '', email: '' });
      loadData();
    } catch (error) {
      toast.error('Failed to update admin: ' + error.message);
    }
  };

  const handleDeleteAdmin = async (adminId) => {
    if (!confirm('Are you sure you want to delete this admin? Users assigned to this admin will be unassigned.')) {
      return;
    }
    try {
      await ApiService.deleteAdmin(adminId);
      toast.success('Admin deleted successfully');
      loadData();
    } catch (error) {
      toast.error('Failed to delete admin: ' + error.message);
    }
  };

  const handleTransferUser = async (userId, adminId) => {
    try {
      await ApiService.transferUser(userId, adminId || null);
      toast.success('User transferred successfully');
      setShowTransferUser(null);
      loadData();
    } catch (error) {
      toast.error('Failed to transfer user: ' + error.message);
    }
  };

  const handleLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  const adminFormFields = (
    <>
      <div>
        <label htmlFor="adm-user">Username</label>
        <input id="adm-user" className="lm-inp" value={adminForm.username} onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })} required />
      </div>
      <div>
        <label htmlFor="adm-pass">Password{showEditAdmin ? ' (leave blank to keep)' : ' (min 6 characters)'}</label>
        <input id="adm-pass" className="lm-inp" type="password" minLength={showEditAdmin ? undefined : 6} value={adminForm.password} onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} required={!showEditAdmin} />
      </div>
      <div>
        <label htmlFor="adm-name">Name</label>
        <input id="adm-name" className="lm-inp" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor="adm-email">Email</label>
        <input id="adm-email" className="lm-inp" type="email" value={adminForm.email} onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
      </div>
    </>
  );

  if (loading) {
    return (
      <LifemapAdminShell title="Super admin" kicker="BOX Wealth">
        <div className="lm-card" style={{ padding: 48, textAlign: 'center', color: 'var(--lm-muted)' }}>Loading…</div>
      </LifemapAdminShell>
    );
  }

  return (
    <LifemapAdminShell
      title="Admins and users"
      kicker={`Signed in as ${admin?.username || 'Super admin'}`}
      actions={(
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lm-ghost" onClick={() => setShowAccount(true)}>Account</button>
          <button type="button" className="lm-btn" onClick={handleLogout}>Logout</button>
        </span>
      )}
    >
      <div className="lm-card" style={{ marginBottom: 16 }}>
        <div className="lm-reghead">
          <h3>Admin register</h3>
          <span className="count">{admins.length} admins</span>
          <div className="r">
            <button type="button" className="lm-ghost primary" onClick={() => setShowCreateAdmin(true)}>+ Create admin</button>
          </div>
        </div>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Email</th>
                <th>Users</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No admins yet</td></tr>
              ) : admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.username}</td>
                  <td>{a.name || '—'}</td>
                  <td>{a.email || '—'}</td>
                  <td>{a.user_count || 0}</td>
                  <td>
                    <span className={`lm-badge ${a.is_active ? 'on' : 'off'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="lm-iconbtn" aria-label="Edit admin" onClick={() => {
                        setShowEditAdmin(a);
                        setAdminForm({ username: a.username, password: '', name: a.name || '', email: a.email || '' });
                      }}>
                        <Edit className="h-4 w-4" />
                      </button>
                      <button type="button" className="lm-iconbtn danger" aria-label="Delete admin" onClick={() => handleDeleteAdmin(a.id)}>
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

      <div className="lm-card">
        <div className="lm-reghead">
          <h3>User register</h3>
          <span className="count">{users.length} people</span>
        </div>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Assigned admin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td className="empty" colSpan={4}>No users yet</td></tr>
              ) : users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name}</td>
                  <td>{u.admin_username || 'Unassigned'}</td>
                  <td>
                    <button type="button" className="lm-ghost" onClick={() => setShowTransferUser(u.id)}>Transfer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
            <form onSubmit={handleCreateAdmin} className="stack">
              {adminFormFields}
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowCreateAdmin(false)}>Cancel</button>
                <button type="submit" className="lm-btn">Create admin</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showEditAdmin ? (
        <div className="lm-modal-overlay" onClick={() => setShowEditAdmin(null)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit admin</h2>
            <form onSubmit={handleUpdateAdmin} className="stack">
              {adminFormFields}
              <label>
                <input
                  type="checkbox"
                  checked={!!showEditAdmin.is_active}
                  onChange={(e) => setShowEditAdmin({ ...showEditAdmin, is_active: e.target.checked })}
                  style={{ marginRight: 8 }}
                />
                Active
              </label>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowEditAdmin(null)}>Cancel</button>
                <button type="submit" className="lm-btn">Update admin</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showTransferUser ? (
        <div className="lm-modal-overlay" onClick={() => setShowTransferUser(null)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Transfer user</h2>
            <p className="sub">Move this person to another admin, or leave them unassigned.</p>
            <div className="stack">
              <div>
                <label htmlFor="xfer-admin">Admin</label>
                <select
                  id="xfer-admin"
                  className="lm-inp"
                  defaultValue=""
                  onChange={(e) => handleTransferUser(showTransferUser, e.target.value === 'none' ? null : parseInt(e.target.value, 10))}
                >
                  <option value="" disabled>Select admin</option>
                  <option value="none">Unassigned</option>
                  {admins.filter((a) => a.is_active).map((a) => (
                    <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowTransferUser(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </LifemapAdminShell>
  );
}
