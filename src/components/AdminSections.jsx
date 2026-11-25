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

const ACTIVITY_ACTIONS = [
  'login', 'failed_login', 'account_locked', 'client_signup',
  'password_reset_requested', 'password_reset', 'password_changed', 'invite_accepted',
  'sessions_revoked_all', 'profile_email_changed',
  'totp_enabled', 'totp_disabled',
  'plan_view', 'plan_edit', 'plan_row_restored',
  'client_created', 'client_updated', 'client_deleted', 'client_restored',
  'client_transferred', 'client_transferred_out', 'client_reset_link_sent',
  'admin_created', 'admin_updated', 'admin_deactivated', 'admin_deleted', 'admin_restored',
  'admin_reset_link_sent', 'admin_username_changed', 'admin_email_changed', 'admin_password_changed',
  'super_admin_username_changed', 'super_admin_email_changed', 'super_admin_password_changed',
  'clients_reassigned_in', 'associate_change',
  'privacy_request_created', 'privacy_request_updated',
  'access_review_viewed', 'access_review_keep', 'access_review_deactivate',
  'legal_hold_set', 'legal_hold_released', 'permanent_purge', 'activity_log_exported',
];

const EMPTY_FILTERS = { q: '', action: '', from: '', to: '', team: '', clientId: '', clientName: '', userId: '' };

// Activity log. Super admin sees everything (and can filter by team); an admin sees their own team.
export function ActivityLogSection({ isSuper = false, admins = [] }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState({});
  const [offset, setOffset] = useState(0);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [archives, setArchives] = useState([]);
  const [archivesTotal, setArchivesTotal] = useState(0);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

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

  const loadArchives = useCallback(async () => {
    if (!isSuper) return;
    setArchivesLoading(true);
    try {
      const res = await ApiService.getActivityLogArchives({ limit: 30 });
      setArchives(res.archives || []);
      setArchivesTotal(res.total || 0);
    } catch (error) {
      toast.error(error.message || 'Could not load daily archives');
    } finally {
      setArchivesLoading(false);
    }
  }, [isSuper]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadArchives(); }, [loadArchives]);

  const applyFilters = (e) => {
    e.preventDefault();
    setOffset(0);
    setApplied({ ...filters });
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
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

  const handleDownloadArchive = async (day) => {
    try {
      const { blob, filename } = await ApiService.downloadActivityLogArchive(day);
      downloadBlob(blob, filename);
      toast.success(`Downloaded archive for ${day}`);
    } catch (error) {
      toast.error(error.message || 'Archive download failed');
    }
  };

  const handleRunArchive = async () => {
    try {
      setArchiveBusy(true);
      const res = await ApiService.runActivityLogArchive();
      const archived = res?.result?.archived || res?.result;
      toast.success(
        archived?.skipped
          ? `Archive already exists for ${archived.day}`
          : `Archived ${archived?.rowCount ?? 0} rows for ${archived?.day || 'yesterday'}`
      );
      await loadArchives();
    } catch (error) {
      toast.error(error.message || 'Archive job failed');
    } finally {
      setArchiveBusy(false);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <>
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
        <select
          className="lm-inp"
          aria-label="Action"
          value={filters.action}
          onChange={(e) => setFilters({ ...filters, action: e.target.value })}
        >
          <option value="">All actions</option>
          {ACTIVITY_ACTIONS.map((a) => (
            <option key={a} value={a}>{actionLabel(a)}</option>
          ))}
        </select>
        <input
          className="lm-inp"
          placeholder="Client name or email"
          aria-label="Client name or email"
          title="Filter by client name or email"
          value={filters.clientName}
          onChange={(e) => setFilters({ ...filters, clientName: e.target.value })}
          style={{ minWidth: 160 }}
        />
        <input
          className="lm-inp"
          inputMode="numeric"
          placeholder="Client ID"
          aria-label="Client ID"
          value={filters.clientId}
          onChange={(e) => setFilters({ ...filters, clientId: e.target.value.replace(/\D/g, '') })}
          style={{ width: 100 }}
        />
        <input
          className="lm-inp"
          inputMode="numeric"
          placeholder="Actor ID"
          aria-label="Actor (user) ID"
          title="Id of the person who performed the action"
          value={filters.userId}
          onChange={(e) => setFilters({ ...filters, userId: e.target.value.replace(/\D/g, '') })}
          style={{ width: 100 }}
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
                <td>
                  {entry.target_label
                    || (entry.target_type ? `${entry.target_type}${entry.target_id ? ` #${entry.target_id}` : ''}` : '—')}
                  {entry.target_label && entry.target_type ? (
                    <div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>
                      {entry.target_type}{entry.target_id ? ` #${entry.target_id}` : ''}
                    </div>
                  ) : null}
                </td>
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

    {isSuper ? (
      <div className="lm-card" style={{ marginTop: 16 }}>
        <div className="lm-reghead">
          <h3>Daily archives</h3>
          <span className="count">{archivesTotal} days</span>
          <div className="r">
            <button type="button" className="lm-ghost" onClick={handleRunArchive} disabled={archiveBusy}>
              {archiveBusy ? 'Archiving…' : 'Archive yesterday now'}
            </button>
          </div>
        </div>
        <p className="lm-hint" style={{ padding: '0 16px 8px', margin: 0 }}>
          Nightly CSV snapshots of the activity log (kept 400 days). Live log rows are never deleted.
          Optional: set <code>LOG_ARCHIVE_WEBHOOK_URL</code> to also push each day to external storage.
        </p>
        <div className="lm-tblwrap">
          <table className="lm-tbl">
            <thead>
              <tr>
                <th>Day (UTC)</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Archived at</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {archivesLoading && archives.length === 0 ? (
                <tr><td className="empty" colSpan={5}>Loading…</td></tr>
              ) : archives.length === 0 ? (
                <tr><td className="empty" colSpan={5}>No daily archives yet — run “Archive yesterday now” or wait for the nightly job.</td></tr>
              ) : archives.map((row) => {
                const day = typeof row.day === 'string' ? row.day.slice(0, 10) : new Date(row.day).toISOString().slice(0, 10);
                const kb = row.bytes != null ? `${Math.max(1, Math.round(Number(row.bytes) / 1024))} KB` : '—';
                return (
                  <tr key={row.id || day}>
                    <td>{day}</td>
                    <td>{row.row_count}</td>
                    <td>{kb}</td>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>
                      <button type="button" className="lm-ghost" onClick={() => handleDownloadArchive(day)}>
                        Download CSV
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    ) : null}
    </>
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

const DUE_SOON_DAYS = 14;

// Open request due within the next 14 days (and not already overdue)
function isDueSoon(request) {
  if (request.closed_at || request.overdue || !request.due_at) return false;
  const status = String(request.status || '').toLowerCase();
  if (status === 'closed' || status === 'rejected' || status === 'completed') return false;
  const due = new Date(request.due_at).getTime();
  if (Number.isNaN(due)) return false;
  const msLeft = due - Date.now();
  return msLeft >= 0 && msLeft <= DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
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
              <th>Team</th>
              <th>Type</th>
              <th>Details</th>
              <th>Due</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && requests.length === 0 ? (
              <tr><td className="empty" colSpan={8}>Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td className="empty" colSpan={8}>No privacy requests</td></tr>
            ) : requests.map((r) => (
              <tr key={r.id}>
                <td>{r.ref}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{formatDate(r.created_at)}</div></td>
                <td>{r.user_name || '—'}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{r.user_email}</div></td>
                <td>{r.team_label || 'Unassigned'}</td>
                <td>{PRIVACY_TYPE_LABEL[r.type] || r.type}</td>
                <td style={{ maxWidth: 280, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {r.details || '—'}
                  {r.notes ? <div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--lm-muted)' }}>Note: {r.notes}</div> : null}
                </td>
                <td>
                  {r.closed_at ? `Closed ${formatDate(r.closed_at)}` : formatDate(r.due_at)}
                  {r.overdue ? <div><span className="lm-badge off">Overdue</span></div> : null}
                  {isDueSoon(r) ? <div><span className="lm-badge warn">Due soon</span></div> : null}
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

const DELETED_TYPE_LABEL = {
  user: 'Client',
  admin: 'Admin',
  financial_goal: 'Goal',
  financial_expense: 'Expense',
  financial_loan: 'Loan',
  assets: 'Asset',
  work_assets: 'Work asset',
  planned_loan: 'Planned loan',
  financial_insurance: 'Insurance',
};

// Recycle bin (super admin): restore within 90 days or purge permanently
export function DeletedItemsSection({ onChanged, isSuper = true }) {
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

  const toggleHold = async (item) => {
    try {
      setBusyId(item.id);
      const res = await ApiService.setDeletedItemLegalHold(item.id, !item.legal_hold);
      toast.success(res?.message || (item.legal_hold ? 'Legal hold released' : 'Legal hold set'));
      await load();
    } catch (error) {
      toast.error(error.message || 'Could not update the legal hold');
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
        {isSuper
          ? 'Deleted clients, admins and plan entries can be restored until their purge date (90 days). Items under legal hold are never purged automatically.'
          : 'Clients you deleted from your team. Names and emails stay visible here. Only a super admin can restore or permanently delete them.'}
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
              {isSuper ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td className="empty" colSpan={isSuper ? 7 : 6}>Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td className="empty" colSpan={isSuper ? 7 : 6}>Nothing has been deleted</td></tr>
            ) : items.map((item) => (
              <tr key={item.id}>
                <td>{DELETED_TYPE_LABEL[item.entity_type] || item.entity_type}</td>
                <td>
                  {item.label || item.client_name || '—'}
                  {item.client_name && item.label && item.client_name !== item.label ? (
                    <div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>Client: {item.client_name}</div>
                  ) : null}
                </td>
                <td>{item.email || '—'}</td>
                <td style={{ maxWidth: 260, wordBreak: 'break-word' }}>{item.reason || '—'}</td>
                <td>{formatDate(item.deleted_at)}<div style={{ fontSize: 11.5, color: 'var(--lm-slate)' }}>{item.deleted_by_role}</div></td>
                <td>
                  {formatDate(item.purge_after)}
                  {item.legal_hold ? <div><span className="lm-badge warn">Legal hold</span></div> : null}
                </td>
                {isSuper ? (
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="lm-ghost" disabled={busyId === item.id} onClick={() => restore(item)}>Restore</button>
                      <button type="button" className="lm-ghost" disabled={busyId === item.id} onClick={() => toggleHold(item)}>
                        {item.legal_hold ? 'Release hold' : 'Legal hold'}
                      </button>
                      <button
                        type="button"
                        className="lm-ghost"
                        disabled={Boolean(item.legal_hold)}
                        title={item.legal_hold ? 'Release the legal hold first' : undefined}
                        onClick={() => setPurgeTarget(item)}
                        style={item.legal_hold ? undefined : { color: '#b42318' }}
                      >
                        Purge
                      </button>
                    </div>
                  </td>
                ) : null}
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
  const [deactivating, setDeactivating] = useState(null);
  const [reassignTo, setReassignTo] = useState('');
  const [keepingId, setKeepingId] = useState(null);
  const [associate, setAssociate] = useState(null); // { fromAdminId, toAdminId } while the modal is open
  const [associateBusy, setAssociateBusy] = useState(false);

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
  const activeAdmins = useMemo(() => (review?.admins || []).filter((a) => a.is_active), [review]);

  // "Keep" is recorded on the server (access_review_decision) and in the activity log
  const keep = async (admin) => {
    try {
      setKeepingId(admin.id);
      await ApiService.submitAccessReviewDecision({ adminId: admin.id, decision: 'Keep' });
      toast.success(`Kept access for ${admin.username}`);
      await load();
    } catch (error) {
      toast.error(error.message || 'Could not record the decision');
    } finally {
      setKeepingId(null);
    }
  };

  const confirmAssociateChange = async () => {
    try {
      setAssociateBusy(true);
      const res = await ApiService.associateChange({
        fromAdminId: Number(associate.fromAdminId),
        toAdminId: Number(associate.toAdminId),
      });
      toast.success(res?.message || 'Associate change complete');
      setAssociate(null);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.message || 'Could not complete the associate change');
    } finally {
      setAssociateBusy(false);
    }
  };

  const confirmDeactivate = async (reason) => {
    if (deactivating.client_count > 0 && !reassignTo) {
      toast.error('Choose an admin to receive their clients');
      return;
    }
    try {
      await ApiService.submitAccessReviewDecision({
        adminId: deactivating.id,
        decision: 'Deactivate',
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
            <button
              type="button"
              className="lm-ghost primary"
              onClick={() => setAssociate({ fromAdminId: '', toAdminId: '' })}
              disabled={activeAdmins.length < 2}
              title={activeAdmins.length < 2 ? 'Needs at least two active admins' : undefined}
            >
              Associate change
            </button>
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
                    {a.last_decision === 'Keep' ? (
                      <span className="lm-badge on" style={{ marginLeft: 4 }} title={a.last_decision_at ? `Reviewed ${formatDateTime(a.last_decision_at)}` : undefined}>Reviewed</span>
                    ) : null}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="lm-ghost" disabled={keepingId === a.id} onClick={() => keep(a)}>
                        {keepingId === a.id ? 'Saving…' : 'Keep'}
                      </button>
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

      {associate ? (
        <div className="lm-modal-overlay" onClick={associateBusy ? undefined : () => setAssociate(null)}>
          <div className="lm-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Associate change</h2>
            <p className="sub">
              Move all clients from the outgoing associate to the incoming one. The outgoing associate is
              deactivated and signed out everywhere, and the incoming associate is emailed a link to set up their password.
            </p>
            <div className="stack">
              <div>
                <label htmlFor="assoc-from">Outgoing associate *</label>
                <select
                  id="assoc-from"
                  className="lm-inp"
                  value={associate.fromAdminId}
                  onChange={(e) => setAssociate({ ...associate, fromAdminId: e.target.value })}
                >
                  <option value="">Select admin</option>
                  {activeAdmins.map((a) => (
                    <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''} · {a.client_count} client(s)</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="assoc-to">Incoming associate *</label>
                <select
                  id="assoc-to"
                  className="lm-inp"
                  value={associate.toAdminId}
                  onChange={(e) => setAssociate({ ...associate, toAdminId: e.target.value })}
                >
                  <option value="">Select admin</option>
                  {activeAdmins.filter((a) => String(a.id) !== String(associate.fromAdminId)).map((a) => (
                    <option key={a.id} value={a.id}>{a.username}{a.name ? ` (${a.name})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="lm-modal-acts">
                <button type="button" className="lm-ghost" onClick={() => setAssociate(null)} disabled={associateBusy}>Cancel</button>
                <button
                  type="button"
                  className="lm-btn"
                  onClick={confirmAssociateChange}
                  disabled={associateBusy || !associate.fromAdminId || !associate.toAdminId}
                >
                  {associateBusy ? 'Working…' : 'Confirm associate change'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
