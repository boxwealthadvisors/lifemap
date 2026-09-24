import React, { useEffect, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminUser } from '@/contexts/AdminUserContext';
import ApiService from '@/services/api';
import { toast } from 'sonner';

function generateLoginPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const adminUser = useAdminUser();
  const isAdminMode = !!adminUser?.userId;
  const effectiveUserId = isAdminMode ? adminUser.userId : (user?.id || null);

  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    age: '',
    income: '',
    workTenure: '',
    financialProfileId: null
  });

  const [editing, setEditing] = useState({
    firstName: false,
    lastName: false,
    email: false,
    age: false,
    income: false,
    workTenure: false
  });

  const [tempValues, setTempValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [issuedPassword, setIssuedPassword] = useState(null);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!isAdminMode && user) {
      const { firstName, lastName } = splitName(user.name);
      setProfile((prev) => ({
        ...prev,
        firstName,
        lastName,
        email: user.email || ''
      }));
    }

    const load = async () => {
      if (!effectiveUserId) return;
      try {
        if (isAdminMode) {
          const [userRes, fpRes] = await Promise.all([
            ApiService.getUserProfile(effectiveUserId).catch(() => ({})),
            ApiService.getFinancialProfileForUser(effectiveUserId).catch(() => ({})),
          ]);
          const client = userRes.user || {};
          const { firstName, lastName } = splitName(client.name || adminUser?.clientName);
          const data = fpRes.profile || userRes.profile || {};
          setProfile((prev) => ({
            ...prev,
            firstName: firstName || prev.firstName,
            lastName: lastName || prev.lastName,
            email: client.email || prev.email,
            age: data.age || '',
            income: data.current_annual_gross_income || '',
            workTenure: data.work_tenure_years || '',
            financialProfileId: data.id || null
          }));
          return;
        }

        const res = await ApiService.getFinancialProfile(effectiveUserId);
        const data = res.profile || res;
        if (data) {
          setProfile((prev) => ({
            ...prev,
            age: data.age || '',
            income: data.current_annual_gross_income || '',
            workTenure: data.work_tenure_years || '',
            financialProfileId: data.id || null
          }));
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
      }
    };

    load();
  }, [user, effectiveUserId, isAdminMode, adminUser?.clientName]);

  const handleEdit = (field) => {
    setEditing((prev) => ({ ...prev, [field]: true }));
    setTempValues((prev) => ({ ...prev, [field]: profile[field] }));
  };

  const handleCancel = (field) => {
    setEditing((prev) => ({ ...prev, [field]: false }));
    setTempValues((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const applyUserRecord = (updated) => {
    const { firstName, lastName } = splitName(updated.name);
    setProfile((prev) => ({
      ...prev,
      firstName,
      lastName,
      email: updated.email || prev.email
    }));
    if (!isAdminMode && updated) setUser(updated);
    if (isAdminMode) adminUser?.onClientUpdated?.(updated);
  };

  const handleSave = async (field) => {
    setLoading(true);
    try {
      if (field === 'email' || field === 'firstName' || field === 'lastName') {
        const fullName = field === 'firstName'
          ? `${tempValues[field]} ${profile.lastName}`.trim()
          : field === 'lastName'
            ? `${profile.firstName} ${tempValues[field]}`.trim()
            : `${profile.firstName} ${profile.lastName}`.trim();
        const payload = field === 'email'
          ? { email: tempValues[field] }
          : { name: fullName };
        const updatedUser = isAdminMode
          ? await ApiService.updateUser(effectiveUserId, payload)
          : await ApiService.updateProfile(payload);
        if (updatedUser.user) {
          applyUserRecord(updatedUser.user);
          toast.success(field === 'email' ? 'Email updated successfully' : 'Name updated successfully');
        }
      } else if (['age', 'income', 'workTenure'].includes(field)) {
        const age = field === 'age' ? parseInt(tempValues[field], 10) : parseInt(profile.age, 10) || 30;
        const income = field === 'income' ? parseFloat(tempValues[field]) : parseFloat(profile.income) || 0;
        const workTenure = field === 'workTenure' ? parseInt(tempValues[field], 10) : parseInt(profile.workTenure, 10) || 0;
        const create = (body) => isAdminMode
          ? ApiService.createFinancialProfileForUser({ ...body, userId: effectiveUserId }, effectiveUserId)
          : ApiService.createFinancialProfile(body);
        const update = (id, body) => isAdminMode
          ? ApiService.updateFinancialProfileForUser(id, body, effectiveUserId)
          : ApiService.updateFinancialProfile(id, body);

        if (!profile.financialProfileId) {
          const newProfile = await create({
            age,
            current_annual_gross_income: income,
            work_tenure_years: workTenure
          });
          if (newProfile.profile) {
            setProfile((prev) => ({
              ...prev,
              [field]: tempValues[field],
              financialProfileId: newProfile.profile.id
            }));
            toast.success(`${field === 'age' ? 'Age' : field === 'income' ? 'Income' : 'Work Tenure'} updated successfully`);
          }
        } else {
          const updateData = {};
          if (field === 'age') updateData.age = age;
          else if (field === 'income') updateData.current_annual_gross_income = income;
          else if (field === 'workTenure') updateData.work_tenure_years = workTenure;
          const updatedProfile = await update(profile.financialProfileId, updateData);
          if (updatedProfile.profile) {
            setProfile((prev) => ({ ...prev, [field]: tempValues[field] }));
            toast.success(`${field === 'age' ? 'Age' : field === 'income' ? 'Income' : 'Work Tenure'} updated successfully`);
          }
        }
      }

      setEditing((prev) => ({ ...prev, [field]: false }));
      setTempValues((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error(error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters long');
      return;
    }

    if (!isAdminMode && !passwordData.currentPassword) {
      toast.error('Enter your current password');
      return;
    }

    setChangingPassword(true);
    try {
      if (isAdminMode) {
        await ApiService.updateUser(effectiveUserId, { password: passwordData.newPassword });
        setIssuedPassword(passwordData.newPassword);
        toast.success('Password updated. Copy it and give it to the client privately.');
      } else {
        await ApiService.changePassword({
          currentPassword: passwordData.currentPassword,
          newPassword: passwordData.newPassword
        });
        toast.success('Password changed successfully');
        setChangePasswordOpen(false);
      }
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error) {
      console.error('Failed to change password:', error);
      toast.error(error.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const copyIssued = async () => {
    try {
      await navigator.clipboard.writeText(issuedPassword);
      toast.success('Password copied');
    } catch {
      toast.error('Could not copy. Select the password and copy it yourself.');
    }
  };

  const renderField = (field, label, type = 'text', wide = false) => {
    const isEditing = editing[field];
    const value = isEditing ? (tempValues[field] ?? profile[field]) : profile[field];

    return (
      <label className={`lm-field ${wide ? 'wide' : ''}`}>
        <span>{label} *</span>
        <div className="lm-field-ctrl">
          {isEditing ? (
            <>
              <input
                className="lm-inp"
                type={type}
                value={value}
                onChange={(e) => setTempValues((prev) => ({ ...prev, [field]: e.target.value }))}
                disabled={loading}
              />
              <button type="button" className="lm-iconbtn ok" onClick={() => handleSave(field)} disabled={loading} aria-label="Save">
                <Save className="h-4 w-4" />
              </button>
              <button type="button" className="lm-iconbtn danger" onClick={() => handleCancel(field)} disabled={loading} aria-label="Cancel">
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <input
                className="lm-inp"
                type={field === 'password' ? 'password' : type}
                value={field === 'password' ? '••••••••••••' : value}
                readOnly
              />
              <button
                type="button"
                className="lm-iconbtn"
                onClick={() => field === 'password' ? setChangePasswordOpen(true) : handleEdit(field)}
                aria-label={`Edit ${label}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </label>
    );
  };

  return (
    <div className="lm-body">
      <div id="sec-register">
        <PageHeader
          title="Your profile"
          description={isAdminMode
            ? 'This is the client account LifeMap greets and saves the plan against. You can edit it the same way they can.'
            : 'The details LifeMap uses to greet you and to keep your plan saved against this account.'}
        />

        <div className="lm-card">
          <div className="lm-reghead">
            <h3>Account details</h3>
          </div>
          <div className="lm-fields">
            {renderField('firstName', 'First name')}
            {renderField('lastName', 'Last name')}
            {renderField('email', 'Email')}
            {renderField('password', 'Password', 'password')}
            {renderField('age', 'Age', 'number')}
            {renderField('workTenure', 'Work tenure', 'number')}
            {renderField('income', 'Current annual gross income (₹)', 'number', true)}
          </div>
          <div className="lm-note">* Mandatory fields</div>
        </div>
      </div>

      {changePasswordOpen ? (
        <div className="lm-modal-overlay" onClick={() => { setChangePasswordOpen(false); setIssuedPassword(null); }}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            {issuedPassword ? (
              <>
                <h2>New password</h2>
                <p className="sub">Give this password to the client. LifeMap will not show it again.</p>
                <div className="stack">
                  <div>
                    <label htmlFor="issued-pass">Password</label>
                    <input id="issued-pass" className="lm-inp" readOnly value={issuedPassword} />
                  </div>
                </div>
                <div className="lm-modal-acts">
                  <button type="button" className="lm-ghost" onClick={copyIssued}>Copy</button>
                  <button type="button" className="lm-btn" onClick={() => { setChangePasswordOpen(false); setIssuedPassword(null); }}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h2>{isAdminMode ? 'Reset password' : 'Change password'}</h2>
                <p className="sub">
                  {isAdminMode
                    ? 'Set a new sign-in password for this client. Leave it with them privately.'
                    : 'Enter your current password and choose a new one.'}
                </p>
                <div className="stack">
                  {isAdminMode ? null : (
                    <div>
                      <label htmlFor="cur-pass">Current password</label>
                      <input id="cur-pass" className="lm-inp" type="password" value={passwordData.currentPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, currentPassword: e.target.value }))} />
                    </div>
                  )}
                  <div>
                    <label htmlFor="new-pass">New password</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input id="new-pass" className="lm-inp" type={isAdminMode ? 'text' : 'password'} value={passwordData.newPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, newPassword: e.target.value }))} style={{ flex: 1 }} />
                      {isAdminMode ? (
                        <button type="button" className="lm-ghost" onClick={() => {
                          const password = generateLoginPassword();
                          setPasswordData((prev) => ({ ...prev, newPassword: password, confirmPassword: password }));
                        }}>Generate</button>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="conf-pass">Confirm new password</label>
                    <input id="conf-pass" className="lm-inp" type={isAdminMode ? 'text' : 'password'} value={passwordData.confirmPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, confirmPassword: e.target.value }))} />
                  </div>
                </div>
                <div className="lm-modal-acts">
                  <button type="button" className="lm-ghost" onClick={() => { setChangePasswordOpen(false); setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' }); }}>Cancel</button>
                  <button
                    type="button"
                    className="lm-btn"
                    onClick={handleChangePassword}
                    disabled={changingPassword || !passwordData.newPassword || !passwordData.confirmPassword || (!isAdminMode && !passwordData.currentPassword)}
                  >
                    {changingPassword ? 'Saving…' : 'Save password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
