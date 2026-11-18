import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader.jsx';
import { useAuth } from '@/contexts/AuthContext';
import ApiService from '@/services/api';
import {
  PRIVACY_CONTACT_FALLBACK,
  PRIVACY_NOTICE_VERSION_FALLBACK,
  formatDate,
} from '@/lib/password';

const REQUEST_TYPES = [
  {
    value: 'correction',
    label: 'Correct my data',
    help: 'Tell us what is wrong and what it should say.',
    detailsRequired: true,
  },
  {
    value: 'withdraw_consent',
    label: 'Withdraw my consent',
    help: 'We will stop processing your data and may close your account. Add a note if you like.',
    detailsRequired: false,
  },
  {
    value: 'complaint',
    label: 'Raise a complaint',
    help: 'Describe your concern about how your personal data is handled.',
    detailsRequired: true,
  },
];

const TYPE_LABEL = Object.fromEntries(REQUEST_TYPES.map((t) => [t.value, t.label]));

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'on';
  if (s === 'rejected') return 'off';
  return 'warn';
}

export default function PrivacyDataPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const [meta, setMeta] = useState({
    version: PRIVACY_NOTICE_VERSION_FALLBACK,
    contact: PRIVACY_CONTACT_FALLBACK,
  });
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [form, setForm] = useState({ type: 'correction', details: '' });
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const selected = REQUEST_TYPES.find((t) => t.value === form.type) || REQUEST_TYPES[0];

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await ApiService.listPrivacyRequests();
      setRequests(res.requests || []);
    } catch (error) {
      toast.error(error.message || 'Could not load your requests');
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    ApiService.getPrivacyMeta()
      .then((res) => setMeta((prev) => ({ ...prev, ...res })))
      .catch(() => { /* fall back to built-in contact */ });
  }, []);

  useEffect(() => {
    if (user) loadRequests();
  }, [user, loadRequests]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const details = form.details.trim();
    if (selected.detailsRequired && details.length < 3) {
      toast.error('Please describe your request');
      return;
    }
    try {
      setSubmitting(true);
      const res = await ApiService.createPrivacyRequest({ type: form.type, details });
      toast.success(`Request received${res?.request?.ref ? ` (${res.request.ref})` : ''}`);
      setForm((prev) => ({ ...prev, details: '' }));
      loadRequests();
    } catch (error) {
      toast.error(error.message || 'Could not submit your request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeAll = async () => {
    if (!window.confirm('Sign out of all devices? You will need to sign in again everywhere, including here.')) return;
    try {
      setRevoking(true);
      await ApiService.revokeAllSessions();
      toast.success('Signed out of all devices');
      await logout();
      window.location.assign('/');
    } catch (error) {
      toast.error(error.message || 'Could not sign you out of other devices');
      setRevoking(false);
    }
  };

  if (authLoading) {
    return (
      <div className="lm-body">
        <div className="lm-card" style={{ padding: 48, textAlign: 'center', color: 'var(--lm-muted)' }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="lm-body">
        <PageHeader title="Privacy & Data" />
        <div className="lm-card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ marginTop: 0 }}>Sign in to manage your privacy requests.</p>
          <button
            type="button"
            className="lm-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('openAuthModal', { detail: { tab: 'login' } }))}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="lm-body">
      <div id="sec-register">
        <PageHeader
          title="Privacy & Data"
          description="Your rights over the personal data LifeMap holds about you: ask for a correction, withdraw consent, or raise a complaint. We aim to respond within 90 days."
        />

        <div className="lm-card" style={{ marginBottom: 16 }}>
          <div className="lm-reghead"><h3>Your privacy</h3></div>
          <div style={{ padding: '4px 16px 16px', fontSize: 14, lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 6px' }}>
              {user.consent_version
                ? <>You accepted Privacy Notice <strong>{user.consent_version}</strong>. </>
                : <>Current Privacy Notice: <strong>{meta.version}</strong>. </>}
              Read the <Link to="/privacy" className="lm-tlink" style={{ padding: 0, textDecoration: 'underline' }}>Privacy Notice</Link> and{' '}
              <Link to="/terms" className="lm-tlink" style={{ padding: 0, textDecoration: 'underline' }}>Terms of Use</Link>.
            </p>
            <p style={{ margin: 0 }}>
              Privacy contact: <a href={`mailto:${meta.contact}`}>{meta.contact}</a>
            </p>
          </div>
        </div>

        <div className="lm-card" style={{ marginBottom: 16 }}>
          <div className="lm-reghead"><h3>Make a request</h3></div>
          <form onSubmit={handleSubmit} className="stack" style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="lm-field wide" style={{ gridColumn: 'auto' }}>
              <span>Request type</span>
              <select
                className="lm-inp"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="lm-hint">{selected.help}</p>
            </label>
            <label className="lm-field wide" style={{ gridColumn: 'auto' }}>
              <span>Details{selected.detailsRequired ? ' *' : ' (optional)'}</span>
              <textarea
                className="lm-inp"
                value={form.details}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder="What would you like us to know?"
              />
              <p className="lm-hint">{form.details.length}/2000</p>
            </label>
            <div>
              <button type="submit" className="lm-btn" disabled={submitting}>
                {submitting ? 'Sending…' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>

        <div className="lm-card" style={{ marginBottom: 16 }}>
          <div className="lm-reghead">
            <h3>Your requests</h3>
            <span className="count">{requests.length} total</span>
          </div>
          <div className="lm-tblwrap">
            <table className="lm-tbl">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>We respond by</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {loadingRequests && requests.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>Loading…</td></tr>
                ) : requests.length === 0 ? (
                  <tr><td className="empty" colSpan={6}>You have not made any requests</td></tr>
                ) : requests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.ref}</td>
                    <td>{TYPE_LABEL[r.type] || r.type}</td>
                    <td><span className={`lm-badge ${statusTone(r.status)}`}>{r.status}</span></td>
                    <td>{formatDate(r.created_at)}</td>
                    <td>{r.closed_at ? `Closed ${formatDate(r.closed_at)}` : formatDate(r.due_at)}</td>
                    <td style={{ maxWidth: 320, whiteSpace: 'pre-wrap' }}>{r.details || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lm-card">
          <div className="lm-reghead"><h3>Sessions</h3></div>
          <div style={{ padding: '4px 16px 16px' }}>
            <p style={{ marginTop: 0, fontSize: 14 }}>
              Lost a device or used a shared computer? Sign out everywhere. You will be asked to sign in again.
            </p>
            <button type="button" className="lm-ghost" onClick={handleRevokeAll} disabled={revoking}>
              {revoking ? 'Signing out…' : 'Sign out of all devices'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
