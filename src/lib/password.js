// Mirrors the backend password rules so people get feedback before submitting.
export const PASSWORD_HINT =
  'At least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.';

// Returns a short message describing the first unmet rule, or null when the password is acceptable
export function passwordProblem(value) {
  const p = String(value || '');
  if (p.length < 8) return 'Use at least 8 characters';
  if (!/[a-z]/.test(p)) return 'Add a lowercase letter';
  if (!/[A-Z]/.test(p)) return 'Add an uppercase letter';
  if (!/[0-9]/.test(p)) return 'Add a number';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Add a special character (for example ! @ # ?)';
  return null;
}

export const PRIVACY_CONTACT_FALLBACK = 'privacy@boxwealth.in';
export const PRIVACY_NOTICE_VERSION_FALLBACK = 'v1.0-2026-11-16';

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
