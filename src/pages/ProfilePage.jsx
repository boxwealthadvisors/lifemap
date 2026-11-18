import React, { useEffect, useState } from 'react';
import { Pencil, Save, X } from 'lucide-react';
import PageHeader from '@/components/PageHeader.jsx';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminUser } from '@/contexts/AdminUserContext';
import ApiService from '@/services/api';
import { passwordProblem, PASSWORD_HINT } from '@/lib/password';
import { toast } from 'sonner';

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

const emptyPasswordData = { currentPassword: '', newPassword: '', confirmPassword: '', otp: '' };
const emptyEmailData = { newEmail: '', currentPassword: '', otp: '' };

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth();
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

  // Sensitive changes (password / email) need the current password and an emailed code
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [passwordData, setPasswordData] = useState(emptyPasswordData);
  const [emailData, setEmailData] = useState(emptyEmailData);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

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

  // ---- Sensitive changes: security code, password, email ----

  const resetSensitiveState = () => {
    setPasswordData(emptyPasswordData);
    setEmailData(emptyEmailData);
    setOtpSent(false);
    setDevCode('');
  };

  const closePasswordModal = () => {
    setChangePasswordOpen(false);
    resetSensitiveState();
  };

  const closeEmailModal = () => {
    setChangeEmailOpen(false);
    resetSensitiveState();
  };

  // The code is always sent to the email currently on the account
  const handleSendSecurityCode = async () => {
    const accountEmail = user?.email || profile.email;
    if (!accountEmail) {
      toast.error('No email address is on file for this account');
      return;
    }
    try {
      setSendingOtp(true);
      const res = await ApiService.requestOtp({ email: accountEmail, purpose: 'sensitive' });
      setOtpSent(true);
      setDevCode(res?.devCode || '');
      toast.success('We emailed you a 6-digit code');
    } catch (error) {
      toast.error(error.message || 'Could not send the code');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    const problem = passwordProblem(passwordData.newPassword);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!passwordData.currentPassword) {
      toast.error('Enter your current password');
      return;
    }
    if (!otpSent || passwordData.otp.length < 6) {
      toast.error('Request a security code and enter the 6 digits');
      return;
    }

    setChangingPassword(true);
    try {
      await ApiService.changePassword({
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
        otp: passwordData.otp,
      });
      toast.success('Password changed. Please sign in again.');
      closePasswordModal();
      // Backend signs out every device after a password change
      await logout();
      window.location.assign('/?signin=1');
    } catch (error) {
      console.error('Failed to change password:', error);
      toast.error(error.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleChangeEmail = async () => {
    const newEmail = emailData.newEmail.trim();
    if (!newEmail) {
      toast.error('Enter your new email address');
      return;
    }
    if (!emailData.currentPassword) {
      toast.error('Enter your current password');
      return;
    }
    if (!otpSent || emailData.otp.length < 6) {
      toast.error('Request a security code and enter the 6 digits');
      return;
    }
    setChangingEmail(true);
    try {
      const res = await ApiService.updateProfile({
        email: newEmail,
        currentPassword: emailData.currentPassword,
        otp: emailData.otp,
      });
      if (res.user) applyUserRecord(res.user);
      toast.success('Email updated');
      closeEmailModal();
    } catch (error) {
      console.error('Failed to change email:', error);
      toast.error(error.message || 'Failed to change email');
    } finally {
      setChangingEmail(false);
    }
  };

  // Admin viewing a client: no passwords are ever set or shown, only a reset/invite email
  const handleSendResetLink = async () => {
    if (!window.confirm('Email this client a link to set a new password?')) return;
    setSendingReset(true);
    try {
      const res = await ApiService.sendUserReset(effectiveUserId);
      toast.success(res?.message || 'Reset link sent');
    } catch (error) {
      toast.error(error.message || 'Could not send the reset link');
    } finally {
      setSendingReset(false);
    }
  };

  const renderPasswordField = () => (
    <label className="lm-field">
      <span>Password *</span>
      <div className="lm-field-ctrl">
        <input className="lm-inp" type="password" value="••••••••••••" readOnly />
        {isAdminMode ? (
          <button type="button" className="lm-ghost" onClick={handleSendResetLink} disabled={sendingReset}>
            {sendingReset ? 'Sending…' : 'Send reset link'}
          </button>
        ) : (
          <button
            type="button"
            className="lm-iconbtn"
            onClick={() => { resetSensitiveState(); setChangePasswordOpen(true); }}
            aria-label="Change password"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
      </div>
    </label>
  );

  const renderField = (field, label, type = 'text', wide = false) => {
    if (field === 'password') return renderPasswordField();

    const isEditing = editing[field];
    const value = isEditing ? (tempValues[field] ?? profile[field]) : profile[field];
    // Clients change their own email through the code-protected dialog
    const emailViaDialog = field === 'email' && !isAdminMode;

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
                type={type}
                value={value}
                readOnly
              />
              <button
                type="button"
                className="lm-iconbtn"
                onClick={() => {
                  if (emailViaDialog) {
                    resetSensitiveState();
                    setChangeEmailOpen(true);
                  } else {
                    handleEdit(field);
                  }
                }}
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

  const securityCodeBlock = (value, onChange) => (
    <div>
      <label htmlFor="sec-otp">Security code</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="sec-otp"
          className="lm-inp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          style={{ flex: 1 }}
          disabled={!otpSent}
        />
        <button type="button" className="lm-ghost" onClick={handleSendSecurityCode} disabled={sendingOtp}>
          {sendingOtp ? 'Sending…' : (otpSent ? 'Resend code' : 'Email me a code')}
        </button>
      </div>
      <p className="lm-hint">
        {devCode
          ? `Dev code: ${devCode}`
          : `We send the code to ${user?.email || 'your email'}. It expires in 10 minutes.`}
      </p>
    </div>
  );

  const newPasswordProblem = passwordData.newPassword ? passwordProblem(passwordData.newPassword) : null;

  return (
    <div className="lm-body">
      <div id="sec-register">
        <PageHeader
          title="Your profile"
          description={isAdminMode
            ? 'This is the client account LifeMap greets and saves the plan against. You can edit their details, or email them a link to set a new password.'
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
        <div className="lm-modal-overlay" onClick={closePasswordModal}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Change password</h2>
            <p className="sub">
              Enter your current password, choose a new one and confirm with the code we email you.
              You will be signed out of every device afterwards.
            </p>
            <div className="stack">
              <div>
                <label htmlFor="cur-pass">Current password</label>
                <input id="cur-pass" className="lm-inp" type="password" autoComplete="current-password" value={passwordData.currentPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, currentPassword: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="new-pass">New password</label>
                <input id="new-pass" className="lm-inp" type="password" autoComplete="new-password" value={passwordData.newPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, newPassword: e.target.value }))} />
                <p className="lm-hint" style={newPasswordProblem ? { color: '#b42318' } : undefined}>
                  {newPasswordProblem ? `${newPasswordProblem}. ` : ''}{PASSWORD_HINT}
                </p>
              </div>
              <div>
                <label htmlFor="conf-pass">Confirm new password</label>
                <input id="conf-pass" className="lm-inp" type="password" autoComplete="new-password" value={passwordData.confirmPassword} onChange={(e) => setPasswordData((prev) => ({ ...prev, confirmPassword: e.target.value }))} />
              </div>
              {securityCodeBlock(passwordData.otp, (otp) => setPasswordData((prev) => ({ ...prev, otp })))}
            </div>
            <div className="lm-modal-acts">
              <button type="button" className="lm-ghost" onClick={closePasswordModal}>Cancel</button>
              <button
                type="button"
                className="lm-btn"
                onClick={handleChangePassword}
                disabled={
                  changingPassword
                  || !passwordData.currentPassword
                  || !passwordData.newPassword
                  || !passwordData.confirmPassword
                  || passwordData.otp.length < 6
                }
              >
                {changingPassword ? 'Saving…' : 'Save password'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {changeEmailOpen ? (
        <div className="lm-modal-overlay" onClick={closeEmailModal}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Change email</h2>
            <p className="sub">
              Confirm with your current password and a code sent to your current email ({user?.email}).
            </p>
            <div className="stack">
              <div>
                <label htmlFor="new-email-addr">New email</label>
                <input id="new-email-addr" className="lm-inp" type="email" autoComplete="email" value={emailData.newEmail} onChange={(e) => setEmailData((prev) => ({ ...prev, newEmail: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="email-cur-pass">Current password</label>
                <input id="email-cur-pass" className="lm-inp" type="password" autoComplete="current-password" value={emailData.currentPassword} onChange={(e) => setEmailData((prev) => ({ ...prev, currentPassword: e.target.value }))} />
              </div>
              {securityCodeBlock(emailData.otp, (otp) => setEmailData((prev) => ({ ...prev, otp })))}
            </div>
            <div className="lm-modal-acts">
              <button type="button" className="lm-ghost" onClick={closeEmailModal}>Cancel</button>
              <button
                type="button"
                className="lm-btn"
                onClick={handleChangeEmail}
                disabled={changingEmail || !emailData.newEmail || !emailData.currentPassword || emailData.otp.length < 6}
              >
                {changingEmail ? 'Saving…' : 'Save email'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
