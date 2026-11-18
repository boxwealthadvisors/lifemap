import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import ApiService from '../services/api';
import { downloadBlob, formatDate, formatDateTime } from '../lib/password';

const loadingCard = (
  <div className="lm-card" style={{ padding: 36, textAlign: 'center', color: 'var(--lm-muted)' }}>Loading…</div>
);

// Tab strip shared by the admin and super admin consoles
export function AdminTabs({ tabs, active, onChange }) {
  return (
    <div className="lm-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={active === tab.id ? 'on' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// Modal that asks for free text (a reason, notes) plus optional extra controls.
// `onConfirm(text)` may be async; the modal stays open until it resolves.
export function TextPromptModal({
  title,
  description,
  label = 'Reason',
  placeholder = '',
  initial = '',
  minLength = 3,
  confirmLabel = 'Confirm',
  danger = false,
  disabled = false,
  multiline = true,
  children,
  onConfirm,
  onClose,
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();
  const valid = trimmed.length >= minLength;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || disabled) return;
    try {
      setBusy(true);
      await onConfirm(trimmed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lm-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {description ? <p className="sub">{description}</p> : null}
        <form onSubmit={submit} className="stack">
          {children}
          <div>
            <label htmlFor="prompt-text">{label}{minLength > 0 ? ' *' : ''}</label>
            {multiline ? (
              <textarea
                id="prompt-text"
                className="lm-inp"
                value={text}
                placeholder={placeholder}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            ) : (
              <input
                id="prompt-text"
                className="lm-inp"
                value={text}
                placeholder={placeholder}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            )}
            {minLength > 0 ? <p className="lm-hint">At least {minLength} characters. This is recorded in the activity log.</p> : null}
          </div>
          <div className="lm-modal-acts">
            <button type="button" className="lm-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button
              type="submit"
              className="lm-btn"
              disabled={busy || !valid || disabled}
              style={danger ? { background: 'linear-gradient(135deg, #e2574c, #b42318)' } : undefined}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function actionLabel(action) {
  return String(action || '').replace(/_/g, ' ');
}

function compactMeta(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}

const PAGE_SIZE = 50;

// Activity log. Super admin sees everything (and can filter by team); an admin sees their own team.
export function ActivityLogSection({ isSuper = false, admins = [] }) {
  const [filters, setFilters] = useState({ q: '', action: '', from: '', to: '', team: '' });
  const [applied, setApplied] = useState({});
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiService.getActivityLog({ ...applied, limit: PAGE_SIZE, offset });
      setEntries(res.entries || []);
      setTotal(res.total || 0);
    } catch (error) {
      toast.error(error.message || 'Could not load the activity log');
    } finally {
      setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => { load(); }, [load]);

  const applyFilters = (e) => {
    e.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  };

  const clearFilters = () => {
    const empty = { q: '', action: '', from: '', to: '', team: '' };
    setFilters(empty);
    setOffset(0);
    setApplied({});
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      const { blob, filename } = await ApiService.exportActivityLog(applied);
      downloadBlob(blob, filename);
      toast.success('Activity log exported');
    } catch (error) {
      toast.error(error.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="lm-card">
      <div className="lm-reghead">
        <h3>{isSuper ? 'Activity log' : 'Team activity'}</h3>
        <span className="count">{total} entries</span>
        <div className="r">
          <button type="button" className="lm-ghost" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>
      <form onSubmit={applyFilters} className="lm-inline-form" style={{ padding: '0 16px 12px' }}>
        <input
          className="lm-inp"
          placeholder="Search who, what or details"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          style={{ minWidth: 220 }}
        />
        <input
          className="lm-inp"
          placeholder="Action (e.g. login)"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        />
        <input
          className="lm-inp"
          type="date"
          aria-label="From date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
        <input
          className="lm-inp"
          type="date"
          aria-label="To date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        />
        {isSuper ? (
          <select
            className="lm-inp"
            aria-label="Team"
            value={filters.team}
            onChange={(e) => setFilters({ ...filters, team: e.target.value })}
          >
            <option value="">All teams</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.username}</option>
            ))}
          </select>
        ) : null}
        <button type="submit" className="lm-ghost primary">Apply</button>
        <button type="button" className="lm-ghost" onClick={clearFilters}>Clear</button>
      </form>
      <div className="lm-tblwrap">
        <table className="lm-tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              {isSuper ? <th>Team</th> : null}
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && entries.length === 0 ? (
              <tr><td className="empty" colSpan={isSuper ? 6 : 5}>Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td className="empty" colSpan={isSuper ? 6 : 5}>No activity found</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.created_at)}</td>
                <td>{entry.actor_label || '—'}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{entry.actor_role}</div></td>
                <td>{actionLabel(entry.action)}</td>
                <td>{entry.target_type ? `${entry.target_type}${entry.target_id ? ` #${entry.target_id}` : ''}` : '—'}</td>
                {isSuper ? <td>{entry.team_label || '—'}</td> : null}
                <td style={{ maxWidth: 320, fontSize: 12.5, color: 'var(--lm-muted)', wordBreak: 'break-word' }}>{compactMeta(entry.meta) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lm-inline-form" style={{ padding: '12px 16px', justifyContent: 'space-between' }}>
        <span className="lm-hint" style={{ margin: 0 }}>Showing {from}–{to} of {total}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lm-ghost" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
          <button type="button" className="lm-ghost" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
        </span>
      </div>
    </div>
  );
}

const PRIVACY_STATUS_OPTIONS = ['Received', 'In progress', 'Closed', 'Rejected'];
const PRIVACY_TYPE_LABEL = {
  correction: 'Correction',
  withdraw_consent: 'Withdraw consent',
  complaint: 'Complaint',
};

function privacyTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'on';
  if (s === 'rejected') return 'off';
  return 'warn';
}

// Privacy requests raised by clients. Super admin sees all; an admin sees their own clients'.
export function PrivacyRequestsAdminSection() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notesFor, setNotesFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiService.getPrivacyRequestsAdmin(statusFilter || undefined);
      setRequests(res.requests || []);
    } catch (error) {
      toast.error(error.message || 'Could not load privacy requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const applyUpdate = (updated) => {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  };

  const changeStatus = async (request, status) => {
    if (status === request.status) return;
    try {
      setBusyId(request.id);
      const res = await ApiService.updatePrivacyRequest(request.id, { status });
      if (res.request) applyUpdate(res.request);
      toast.success(res.clientNotified ? `Marked ${status}. The client was emailed.` : `Marked ${status}`);
    } catch (error) {
      toast.error(error.message || 'Could not update the request');
    } finally {
      setBusyId(null);
    }
  };

  const saveNotes = async (notes) => {
    try {
      const res = await ApiService.updatePrivacyRequest(notesFor.id, { notes });
      if (res.request) applyUpdate(res.request);
      toast.success('Notes saved');
      setNotesFor(null);
    } catch (error) {
      toast.error(error.message || 'Could not save notes');
    }
  };

  return (
    <div className="lm-card">
      <div className="lm-reghead">
        <h3>Privacy requests</h3>
        <span className="count">{requests.length} requests</span>
        <div className="r">
          <select className="lm-inp" aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {PRIVACY_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <p className="lm-hint" style={{ padding: '0 16px 8px', margin: 0 }}>
        Respond to each request within 90 days. Changing the status emails the client.
      </p>
      <div className="lm-tblwrap">
        <table className="lm-tbl">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Client</th>
              <th>Type</th>
              <th>Details</th>
              <th>Due</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && requests.length === 0 ? (
              <tr><td className="empty" colSpan={7}>Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td className="empty" colSpan={7}>No privacy requests</td></tr>
            ) : requests.map((r) => (
              <tr key={r.id}>
                <td>{r.ref}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{formatDate(r.created_at)}</div></td>
                <td>{r.user_name || '—'}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{r.user_email}</div></td>
                <td>{PRIVACY_TYPE_LABEL[r.type] || r.type}</td>
                <td style={{ maxWidth: 280, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {r.details || '—'}
                  {r.notes ? <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--lm-muted)' }}>Note: {r.notes}</div> : null}
                </td>
                <td>
                  {r.closed_at ? `Closed ${formatDate(r.closed_at)}` : formatDate(r.due_at)}
                  {r.overdue ? <div><span className="lm-badge off">Overdue</span></div> : null}
                </td>
                <td>
                  <select
                    className="lm-inp"
                    aria-label={`Status for ${r.ref}`}
                    value={r.status}
                    disabled={busyId === r.id}
                    onChange={(e) => changeStatus(r, e.target.value)}
                  >
                    {PRIVACY_STATUS_OPTIONS.includes(r.status) ? null : <option value={r.status}>{r.status}</option>}
                    {PRIVACY_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div style={{ marginTop: 4 }}><span className={`lm-badge ${privacyTone(r.status)}`}>{r.status}</span></div>
                </td>
                <td><button type="button" className="lm-ghost" onClick={() => setNotesFor(r)}>Notes</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notesFor ? (
        <TextPromptModal
          title={`Notes for ${notesFor.ref}`}
          description="Notes are included in the status email when you change the status afterwards."
          label="Notes"
          initial={notesFor.notes || ''}
          minLength={0}
          confirmLabel="Save notes"
          onConfirm={saveNotes}
          onClose={() => setNotesFor(null)}
        />
      ) : null}
    </div>
  );
}

// Recycle bin (super admin): restore within 90 days or purge permanently
export function DeletedItemsSection({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiService.getDeletedItems();
      setItems(res.items || []);
    } catch (error) {
      toast.error(error.message || 'Could not load deleted items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (item) => {
    try {
      setBusyId(item.id);
      const res = await ApiService.restoreDeletedItem(item.id);
      toast.success(res?.message || 'Restored');
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.message || 'Could not restore');
    } finally {
      setBusyId(null);
    }
  };

  const purge = async () => {
    const item = purgeTarget;
    try {
      const res = await ApiService.purgeDeletedItem(item.id);
      toast.success(res?.message || 'Permanently deleted');
      setPurgeTarget(null);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.message || 'Could not delete permanently');
    }
  };

  return (
    <div className="lm-card">
      <div className="lm-reghead">
        <h3>Deleted items</h3>
        <span className="count">{items.length} items</span>
      </div>
      <p className="lm-hint" style={{ padding: '0 16px 8px', margin: 0 }}>
        Deleted clients and admins can be restored until their purge date (90 days), then are removed permanently.
      </p>
      <div className="lm-tblwrap">
        <table className="lm-tbl">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
              <th>Email</th>
              <th>Reason</th>
              <th>Deleted</th>
              <th>Purges on</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td className="empty" colSpan={7}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="empty" colSpan={7}>Nothing has been deleted</td></tr>
            ) : items.map((item) => (
              <tr key={item.id}>
                <td>{item.entity_type === 'user' ? 'Client' : 'Admin'}</td>
                <td>{item.label || '—'}</td>
                <td>{item.email || '—'}</td>
                <td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{item.reason || '—'}</td>
                <td>{formatDate(item.deleted_at)}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{item.deleted_by_role}</div></td>
                <td>{formatDate(item.purge_after)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" className="lm-ghost" disabled={busyId === item.id} onClick={() => restore(item)}>Restore</button>
                    <button type="button" className="lm-ghost" onClick={() => setPurgeTarget(item)} style={{ color: '#b42318' }}>Purge</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {purgeTarget ? (
        <div className="lm-modal-overlay" onClick={() => setPurgeTarget(null)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete permanently?</h2>
            <p className="sub">
              {purgeTarget.label || purgeTarget.email || 'This record'} and all of its data will be removed for good.
              This cannot be undone.
            </p>
            <div className="lm-modal-acts">
              <button type="button" className="lm-ghost" onClick={() => setPurgeTarget(null)}>Cancel</button>
              <button type="button" className="lm-btn" onClick={purge} style={{ background: 'linear-gradient(135deg, #e2574c, #b42318)' }}>
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Periodic access review (super admin): keep or deactivate each admin
export function AccessReviewSection({ onChanged }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kept, setKept] = useState({});
  const [deactivating, setDeactivating] = useState(null);
  const [reassignTo, setReassignTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReview(await ApiService.getAccessReview());
    } catch (error) {
      toast.error(error.message || 'Could not load the access review');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const otherActiveAdmins = useMemo(
    () => (review?.admins || []).filter((a) => a.is_active && a.id !== deactivating?.id),
    [review, deactivating]
  );

  const keep = (admin) => {
    setKept((prev) => ({ ...prev, [admin.id]: new Date().toISOString() }));
    toast.success(`Kept access for ${admin.username}`);
  };

  const confirmDeactivate = async (reason) => {
    if (deactivating.client_count > 0 && !reassignTo) {
      toast.error('Choose an admin to receive their clients');
      return;
    }
    try {
      await ApiService.deactivateAdmin(deactivating.id, {
        reassignToAdminId: reassignTo ? Number(reassignTo) : undefined,
        reason,
      });
      toast.success(`${deactivating.username} deactivated`);
      setDeactivating(null);
      setReassignTo('');
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.message || 'Could not deactivate');
    }
  };

  if (loading && !review) return loadingCard;

  const admins = review?.admins || [];
  const superAdmins = review?.superAdmins || [];

  return (
    <>
      <div className="lm-card" style={{ marginBottom: 16 }}>
        <div className="lm-reghead">
          <h3>Access review</h3>
          <span className="count">
            {admins.length} admins · {review?.unassignedClients ?? 0} unassigned clients
          </span>
          <div className="r">
            <button type="button" className="lm-ghost" onClick={load} disabled={loading}>Refresh</button>
          </div>
        </div>
        <p className="lm-hint" style={{ padding: '0 16px 8px', margin: 0 }}>
          Review who still needs access. Admins with no sign-in for 90 days are flagged dormant.
          {review?.generatedAt ? ` Generated ${formatDateTime(review.generatedAt)}.` : ''}
        </p>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Admin</th>
                <th>Email</th>
                <th>Clients</th>
                <th>Last login</th>
                <th>Created on</th>
                <th>Flags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.length === 0 ? (
                <tr><td className="empty" colSpan={7}>No admins to review</td></tr>
              ) : admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.username}{a.name ? <div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{a.name}</div> : null}</td>
                  <td>{a.email || '—'}</td>
                  <td>{a.client_count}</td>
                  <td>{a.last_login_at ? formatDateTime(a.last_login_at) : 'Never'}</td>
                  <td>{formatDate(a.created_at)}</td>
                  <td>
                    <span className={`lm-badge ${a.is_active ? 'on' : 'off'}`}>{a.is_active ? 'Active' : 'Inactive'}</span>
                    {a.dormant ? <span className="lm-badge warn" style={{ marginLeft: 4 }}>Dormant</span> : null}
                    {a.locked ? <span className="lm-badge off" style={{ marginLeft: 4 }}>Locked</span> : null}
                    {kept[a.id] ? <span className="lm-badge on" style={{ marginLeft: 4 }}>Reviewed</span> : null}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="lm-ghost" onClick={() => keep(a)}>Keep</button>
                      <button
                        type="button"
                        className="lm-ghost"
                        disabled={!a.is_active}
                        style={a.is_active ? { color: '#b42318' } : undefined}
                        onClick={() => { setReassignTo(''); setDeactivating(a); }}
                      >
                        Deactivate
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
          <h3>Super admins</h3>
          <span className="count">{superAdmins.length}</span>
        </div>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Last login</th>
                <th>Created on</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {superAdmins.map((s) => (
                <tr key={s.id}>
                  <td>{s.username}</td>
                  <td>{s.email || '—'}</td>
                  <td>{s.last_login_at ? formatDateTime(s.last_login_at) : 'Never'}</td>
                  <td>{formatDate(s.created_at)}</td>
                  <td>{s.locked ? <span className="lm-badge off">Locked</span> : <span className="lm-badge on">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deactivating ? (
        <TextPromptModal
          title={`Deactivate ${deactivating.username}?`}
          description={deactivating.client_count > 0
            ? `${deactivating.client_count} client(s) must move to another active admin first.`
            : 'They will be signed out and will no longer be able to sign in.'}
          confirmLabel="Deactivate"
          danger
          disabled={deactivating.client_count > 0 && !reassignTo}
          onConfirm={confirmDeactivate}
          onClose={() => setDeactivating(null)}
        >
          {deactivating.client_count > 0 ? (
            <div>
              <label htmlFor="reassign-to">Reassign clients to *</label>
              <select id="reassign-to" className="lm-inp" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                <option value="">Select admin</option>
                {otherActiveAdmins.map((a) => (
                  <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''}</option>
                ))}
              </select>
            </div>
          ) : null}
        </TextPromptModal>
      ) : null}
    </>
  );
}
