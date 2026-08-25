import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ApiService from '../services/api';
import { Trash2, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import Shell from '../components/Shell';
import MockupHost from '../components/MockupHost';
import { LifemapAdminShell } from '../components/LifemapChrome';
import { AdminUserProvider } from '../contexts/AdminUserContext';
import AdminInsurancePage from './AdminInsurancePage';
import { AccountSettingsModal, EditUserModal } from '../components/AccountSettingsModal';

export default function AdminPage() {
  const { admin, setAdmin, adminLogout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [activeTab, setActiveTab] = useState('users');

  const [userForm, setUserForm] = useState({
    email: '',
    password: '',
    name: '',
  });

  useEffect(() => {
    if (!isAdmin) {
      navigate('/admin/login');
      return;
    }
    loadUsers();
  }, [isAdmin, navigate]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await ApiService.getAdminUsers();
      console.log('📋 Loaded users:', { count: response.users?.length || 0, users: response.users });
      setUsers(response.users || []);
    } catch (error) {
      console.error('❌ Failed to load users:', error);
      toast.error('Failed to load users: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await ApiService.createUser(userForm);
      toast.success('User created successfully');
      setShowCreateUser(false);
      setUserForm({ email: '', password: '', name: '' });
      loadUsers();
    } catch (error) {
      toast.error('Failed to create user: ' + error.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!confirm('Are you sure you want to delete this user? All their data will be deleted.')) {
      return;
    }
    try {
      await ApiService.deleteUser(userId);
      toast.success('User deleted successfully');
      if (selectedUser?.id === userId) {
        setSelectedUser(null);
        setActiveTab('users');
      }
      loadUsers();
    } catch (error) {
      toast.error('Failed to delete user: ' + error.message);
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

  if (selectedUser && activeTab === 'user-view') {
    return (
      <UserDataView
        userId={selectedUser.id}
        userName={selectedUser.name}
        onBack={() => {
          setActiveTab('users');
          setSelectedUser(null);
        }}
      />
    );
  }

  return (
    <LifemapAdminShell
      title="Your users"
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
          <h3>User register</h3>
          <span className="count">{users.length} people</span>
          <div className="r">
            <button type="button" className="lm-ghost primary" onClick={() => setShowCreateUser(true)}>+ Create user</button>
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
              {users.length === 0 ? (
                <tr>
                  <td className="empty" colSpan={4}>No users assigned to you yet</td>
                </tr>
              ) : users.map((user) => (
                <tr
                  key={user.id}
                  className={selectedUser?.id === user.id ? 'on' : ''}
                  onClick={() => {
                    setSelectedUser(user);
                    setActiveTab('user-view');
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{user.email}</td>
                  <td>{user.name}</td>
                  <td>{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="lm-iconbtn" onClick={() => setEditUser(user)} aria-label="Edit user">
                        <Edit className="h-4 w-4" />
                      </button>
                      <button type="button" className="lm-iconbtn danger" onClick={() => handleDeleteUser(user.id)} aria-label="Delete user">
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

      {editUser ? (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={(updated) => {
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
            if (selectedUser?.id === updated.id) setSelectedUser({ ...selectedUser, ...updated });
          }}
        />
      ) : null}

      {showCreateUser ? (
        <div className="lm-modal-overlay" onClick={() => setShowCreateUser(false)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create user</h2>
            <p className="sub">They will be able to sign in and save a plan.</p>
            <form onSubmit={handleCreateUser} className="stack">
              <div>
                <label htmlFor="new-email">Email</label>
                <input id="new-email" className="lm-inp" type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
              </div>
              <div>
                <label htmlFor="new-password">Password</label>
                <input id="new-password" className="lm-inp" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required minLength={6} />
              </div>
              <div>
                <label htmlFor="new-name">Name</label>
                <input id="new-name" className="lm-inp" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setShowCreateUser(false)}>Cancel</button>
                <button type="submit" className="lm-btn">Create user</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </LifemapAdminShell>
  );
}

const PAGE_BY_SECTION = {
  dashboard: 'fp',
  assets: 'assets',
  'work-assets': 'work',
  goals: 'goals',
  loans: 'loans',
  expenses: 'expenses',
};

function sectionFromPath(path) {
  const clean = String(path || '').split('?')[0];
  if (clean === '/' || clean === '') return 'dashboard';
  if (clean === '/assets') return 'assets';
  if (clean === '/work-assets') return 'work-assets';
  if (clean === '/goals') return 'goals';
  if (clean === '/loans') return 'loans';
  if (clean === '/expenses') return 'expenses';
  if (clean === '/insurance') return 'insurance';
  return null;
}

function UserDataView({ userId, userName, onBack }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const { admin, adminLogout } = useAuth();

  const handleAdminLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  return (
    <AdminUserProvider userId={userId}>
      <div className="lm-admin-plan">
        <div className="lm-admin-plan-bar">
          <button type="button" className="lm-tlink" onClick={onBack}>← All users</button>
          <span className="lm-admin-plan-who">Viewing {userName}</span>
          <span className="lm-admin-plan-acts">
            <span>{admin?.name || admin?.username || 'Admin'}</span>
            <button type="button" className="lm-btn" onClick={handleAdminLogout}>Logout</button>
          </span>
        </div>
        {activeSection === 'insurance' ? (
          <div className="lm-admin-plan-insurance">
            <Shell
              adminMode
              activeSection="insurance"
              onSectionChange={setActiveSection}
              adminUserName={admin?.name || admin?.username}
              userName={userName}
            >
              <AdminInsurancePage />
            </Shell>
          </div>
        ) : (
          <MockupHost
            page={PAGE_BY_SECTION[activeSection]}
            accountLabel={userName}
            onNavigate={(path) => {
              const next = sectionFromPath(path);
              if (next) setActiveSection(next);
            }}
            onExit={onBack}
          />
        )}
      </div>
    </AdminUserProvider>
  );
}

