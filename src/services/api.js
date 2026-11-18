// API service for Life Sheet backend integration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000/api';

// Endpoints that must never send a bearer token
const AUTH_ENDPOINT_RE = /^\/(otp|login|register|forgot-password|reset-password|login\/verify|login\/resend)$/;

function toQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const text = qs.toString();
  return text ? `?${text}` : '';
}

class ApiService {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.pending = new Map();
    this.dedupeWindowMs = 300;
  }

  // Helper method for making API requests with deduplication
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const dedupeKey = `${method} ${endpoint}`;
    const now = Date.now();

    // Only collapse duplicate GETs. POST/PUT/DELETE must not share a promise —
    // saving several new rows hits the same URL with different bodies.
    if (method === 'GET') {
      const existing = this.pending.get(dedupeKey);
      if (existing && (now - existing.ts) < this.dedupeWindowMs) {
        return existing.promise;
      }
    }

    // Get token from localStorage (check admin token first, then user token)
    const adminToken = localStorage.getItem('adminToken');
    const userToken = localStorage.getItem('authToken');
    // For admin endpoints, prioritize admin token; for regular endpoints, use user token
    const path = endpoint.split('?')[0];
    // /totp/* is the staff authenticator-app API (admin / super admin tokens only)
    const isAdminEndpoint = endpoint.includes('/admin/') || path.startsWith('/totp/');
    // Public auth endpoints never carry a bearer token. The one exception is a "sensitive"
    // OTP request, which the backend only issues to the signed-in account's own email.
    const sensitiveOtp = path === '/otp' && options.body && typeof options.body === 'object'
      && options.body.purpose === 'sensitive';
    const isAuthEndpoint = AUTH_ENDPOINT_RE.test(path) && !sensitiveOtp;
    const token = isAdminEndpoint ? (adminToken || userToken) : (userToken || adminToken);
    
    const controller = new AbortController();
    const signal = controller.signal;
    
    // Build headers - ensure Authorization is set if token exists
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
    
    // Set Authorization header if token exists
    if (token && !isAuthEndpoint) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    const config = {
      headers,
      credentials: 'include', // Include cookies for session management
      signal,
      ...options,
    };
    
    // Final check for admin endpoints - ensure token is present
    if (isAdminEndpoint && !isAuthEndpoint && !token) {
      console.error('[API] Admin endpoint requires token but none found:', endpoint);
    }

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    const fetchPromise = (async () => {
      try {
        const response = await fetch(url, config);
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          // If token is invalid, clear it (but only if it's actually an auth error, not a user not found error)
          if (!isAuthEndpoint && (response.status === 401 || response.status === 403)) {
            // Only clear tokens if the error message indicates authentication failure
            // Don't clear if it's a "User not found" or similar error
            const errorLower = errorText.toLowerCase();
            if (errorLower.includes('access token') || errorLower.includes('unauthorized') || errorLower.includes('invalid token') || errorLower.includes('token required')) {
              console.log('[API] Clearing tokens due to auth error:', errorText);
              localStorage.removeItem('authToken');
              localStorage.removeItem('adminToken');
            } else {
              console.log('[API] Not clearing tokens - error is not auth-related:', errorText);
            }
          }
          let message = errorText || `API request failed with status ${response.status}`;
          try {
            const parsed = JSON.parse(errorText);
            message = parsed.error || parsed.message || message;
            if (Array.isArray(parsed.details) && parsed.details[0]?.msg) {
              message = parsed.details.map((d) => d.msg).join('; ');
            }
          } catch {
            /* plain text */
          }
          throw new Error(message);
        }
        
        return await response.json();
      } finally {
        // Clean up pending request
        const cur = this.pending.get(dedupeKey);
        if (cur && cur.promise === fetchPromise) {
          this.pending.delete(dedupeKey);
        }
      }
    })();

    // Store pending request
    this.pending.set(dedupeKey, { ts: now, promise: fetchPromise, controller });
    return fetchPromise;
  }

  // Authentication APIs
  async requestOtp(payload) {
    return this.request('/otp', {
      method: 'POST',
      body: payload,
    });
  }

  async register(userData) {
    return this.request('/register', {
      method: 'POST',
      body: userData,
    });
  }

  async login(credentials) {
    return this.request('/login', {
      method: 'POST',
      body: credentials,
    });
  }

  // Step 2 of sign-in: { pendingToken, otp } -> { token, role, user }
  async verifyLogin({ pendingToken, otp }) {
    return this.request('/login/verify', {
      method: 'POST',
      body: { pendingToken, otp },
    });
  }

  async resendLoginOtp(pendingToken) {
    return this.request('/login/resend', {
      method: 'POST',
      body: { pendingToken },
    });
  }

  async forgotPassword(emailOrUsername) {
    return this.request('/forgot-password', {
      method: 'POST',
      body: { emailOrUsername },
    });
  }

  async resetPassword({ token, password }) {
    return this.request('/reset-password', {
      method: 'POST',
      body: { token, password },
    });
  }

  async logout() {
    return this.request('/logout', {
      method: 'POST',
    });
  }

  async revokeAllSessions() {
    return this.request('/sessions/revoke-all', {
      method: 'POST',
    });
  }

  // ==================== PRIVACY (DPDP) ====================

  async getPrivacyMeta() {
    return this.request('/privacy-meta');
  }

  async listPrivacyRequests() {
    return this.request('/privacy-requests');
  }

  // The signed-in client's own account activity
  async getMyActivity({ limit = 50 } = {}) {
    return this.request(`/activity-log${toQuery({ limit })}`);
  }

  // Fire-and-forget audit entry: someone opened a client's plan. Pass clientId when staff view a client.
  async logPlanView({ clientId } = {}) {
    if (clientId) {
      return this.request('/admin/activity/plan-view', { method: 'POST', body: { clientId } });
    }
    return this.request('/activity/plan-view', { method: 'POST' });
  }

  // ==================== STAFF AUTHENTICATOR APP (TOTP) ====================

  async getTotpStatus() {
    return this.request('/totp/status');
  }

  async setupTotp() {
    return this.request('/totp/setup', { method: 'POST' });
  }

  async enableTotp(code) {
    return this.request('/totp/enable', { method: 'POST', body: { code } });
  }

  async disableTotp({ password, otp }) {
    return this.request('/totp/disable', { method: 'POST', body: { password, otp } });
  }

  async createPrivacyRequest({ type, details }) {
    return this.request('/privacy-requests', {
      method: 'POST',
      body: { type, details },
    });
  }

  async getProfile() {
    return this.request('/profile');
  }

  async updateProfile(profileData) {
    return this.request('/profile', {
      method: 'PUT',
      body: profileData,
    });
  }

  async changePassword(passwordData) {
    return this.request('/change-password', {
      method: 'POST',
      body: passwordData,
    });
  }

  // OAuth APIs
  async initiateGoogleLogin() {
    // Get the OAuth URL from backend
    const response = await this.request('/oauth/google/login', {
      method: 'GET',
    });
    return response;
  }

  async initiateFacebookLogin() {
    // Get the OAuth URL from backend
    const response = await this.request('/oauth/facebook/login', {
      method: 'GET',
    });
    return response;
  }

  // Demo OAuth APIs (for testing)
  async googleLoginDemo() {
    return this.request('/oauth/demo/google', {
      method: 'GET',
    });
  }

  async facebookLoginDemo() {
    return this.request('/oauth/demo/facebook', {
      method: 'GET',
    });
  }

  // Financial APIs
  async createFinancialProfile(profileData) {
    return this.request('/financial/profile', {
      method: 'POST',
      body: profileData,
    });
  }

  async getFinancialProfile(userId) {
    return this.request(`/financial/profile/${userId}`);
  }

  async updateFinancialProfile(profileId, profileData) {
    return this.request(`/financial/profile/${profileId}`, {
      method: 'PUT',
      body: profileData,
    });
  }

  async createFinancialGoal(goalData) {
    return this.request('/financial/goals', {
      method: 'POST',
      body: goalData,
    });
  }

  async getFinancialGoals(userId) {
    return this.request(`/financial/goals/${userId}`);
  }

  async updateFinancialGoal(goalId, goalData) {
    return this.request(`/financial/goals/${goalId}`, {
      method: 'PUT',
      body: goalData,
    });
  }

  async deleteFinancialGoal(goalId) {
    return this.request(`/financial/goals/${goalId}`, {
      method: 'DELETE',
    });
  }

  // Financial Expenses APIs
  async createFinancialExpense(expenseData) {
    return this.request('/financial/expenses', {
      method: 'POST',
      body: expenseData,
    });
  }

  async getFinancialExpenses(userId) {
    return this.request(`/financial/expenses/${userId}`);
  }

  async updateFinancialExpense(expenseId, expenseData) {
    return this.request(`/financial/expenses/${expenseId}`, {
      method: 'PUT',
      body: expenseData,
    });
  }

  async deleteFinancialExpense(expenseId) {
    return this.request(`/financial/expenses/${expenseId}`, {
      method: 'DELETE',
    });
  }

  async createFinancialScenario(scenarioData) {
    return this.request('/financial/scenarios', {
      method: 'POST',
      body: scenarioData,
    });
  }

  async getFinancialScenarios(userId) {
    return this.request(`/financial/scenarios/${userId}`);
  }

  async createFinancialLoan(data) {
    return this.request('/financial/loans', {
      method: 'POST',
      body: data,
    });
  }

  async getFinancialLoans(userId) {
    return this.request(`/financial/loans/${userId}`);
  }

  async updateFinancialLoan(loanId, data) {
    return this.request(`/financial/loans/${loanId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteFinancialLoan(loanId) {
    return this.request(`/financial/loans/${loanId}`, {
      method: 'DELETE',
    });
  }

  async createPlannedLoan(data) {
    return this.request('/financial/planned-loan', {
      method: 'POST',
      body: data,
    });
  }

  async getPlannedLoans(userId) {
    return this.request(`/financial/planned-loans/${userId}`);
  }

  async updatePlannedLoan(loanId, data) {
    return this.request(`/financial/planned-loan/${loanId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deletePlannedLoan(loanId) {
    return this.request(`/financial/planned-loan/${loanId}`, {
      method: 'DELETE',
    });
  }

  // Financial Expenses APIs
  async createFinancialExpense(expenseData) {
    return this.request('/financial/expense', {
      method: 'POST',
      body: expenseData,
    });
  }

  async getFinancialExpenses(userId) {
    return this.request(`/financial/expense/${userId}`);
  }

  async updateFinancialExpense(expenseId, data) {
    return this.request(`/financial/expense/${expenseId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteFinancialExpense(expenseId) {
    return this.request(`/financial/expense/${expenseId}`, {
      method: 'DELETE',
    });
  }

  // Classify expense using LLM
  async classifyExpense(description, userId) {
    return this.request('/financial/expense/classify', {
      method: 'POST',
      body: { description, user_id: userId },
    });
  }

  // Financial Insurance APIs
  async createFinancialInsurance(insuranceData) {
    return this.request('/financial/insurance', {
      method: 'POST',
      body: insuranceData,
    });
  }

  async getFinancialInsurance(userId) {
    return this.request(`/financial/insurance/${userId}`);
  }

  async updateFinancialInsurance(insuranceId, data) {
    return this.request(`/financial/insurance/${insuranceId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteFinancialInsurance(insuranceId) {
    return this.request(`/financial/insurance/${insuranceId}`, {
      method: 'DELETE',
    });
  }

  // Financial Assets APIs
  async createFinancialAsset(assetData) {
    return this.request('/financial/assets', {
      method: 'POST',
      body: assetData,
    });
  }

  async getFinancialAssets(userId) {
    return this.request(`/financial/assets/${userId}`);
  }

  async updateFinancialAsset(assetId, data) {
    return this.request(`/financial/assets/${assetId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteFinancialAsset(assetId) {
    return this.request(`/financial/assets/${assetId}`, {
      method: 'DELETE',
    });
  }

  // Asset Columns APIs
  async getAssetColumns(userId) {
    return this.request(`/financial/asset-columns/${userId}`);
  }

  async createAssetColumn(columnData) {
    return this.request('/financial/asset-columns', {
      method: 'POST',
      body: columnData,
    });
  }

  async updateAssetColumn(columnId, columnData) {
    return this.request(`/financial/asset-columns/${columnId}`, {
      method: 'PUT',
      body: columnData,
    });
  }

  async deleteAssetColumn(columnId) {
    return this.request(`/financial/asset-columns/${columnId}`, {
      method: 'DELETE',
    });
  }

  // User Tags APIs
  async getUserTags(userId) {
    return this.request(`/financial/user-tags/${userId}`);
  }

  async createUserTag(tagData) {
    return this.request('/financial/user-tag', {
      method: 'POST',
      body: tagData,
    });
  }

  async deleteUserTag(tagId) {
    return this.request(`/financial/user-tag/${tagId}`, {
      method: 'DELETE',
    });
  }

  // Work Assets APIs
  async createWorkAsset(workAssetData) {
    return this.request('/financial/work-asset', {
      method: 'POST',
      body: workAssetData,
    });
  }

  async getWorkAssets(userId) {
    return this.request(`/financial/work-assets/${userId}`);
  }

  async updateWorkAsset(assetId, data) {
    return this.request(`/financial/work-asset/${assetId}`, {
      method: 'PUT',
      body: data,
    });
  }

  async deleteWorkAsset(assetId) {
    return this.request(`/financial/work-asset/${assetId}`, {
      method: 'DELETE',
    });
  }

  // Source Preferences
  async getSourcePreferences() {
    return this.request('/financial/source-preferences');
  }

  async updateSourcePreference(component, source) {
    return this.request('/financial/source-preferences', {
      method: 'POST',
      body: { component, source },
    });
  }

  // Expense Categories APIs
  async getExpenseCategories(userId) {
    return this.request(`/financial/expense-categories/${userId}`);
  }

  async createExpenseCategory(categoryData) {
    return this.request('/financial/expense-category', {
      method: 'POST',
      body: categoryData,
    });
  }

  async deleteExpenseCategory(categoryId) {
    return this.request(`/financial/expense-category/${categoryId}`, {
      method: 'DELETE',
    });
  }

  // Expense Tags APIs
  async getExpenseTags(userId) {
    return this.request(`/financial/expense-tags/${userId}`);
  }

  async createExpenseTag(tagData) {
    return this.request('/financial/expense-tag', {
      method: 'POST',
      body: tagData,
    });
  }

  async deleteExpenseTag(tagId) {
    return this.request(`/financial/expense-tag/${tagId}`, {
      method: 'DELETE',
    });
  }

  // ==================== ADMIN & SUPER ADMIN APIs ====================

  // Super Admin Authentication
  async superAdminLogin(credentials) {
    return this.request('/admin/super-admin/login', {
      method: 'POST',
      body: credentials,
    });
  }

  // Admin Authentication
  async adminLogin(credentials) {
    return this.request('/admin/admin/login', {
      method: 'POST',
      body: credentials,
    });
  }

  async getAdminProfile() {
    return this.request('/admin/admin/profile');
  }

  async updateAdminProfile(profileData) {
    return this.request('/admin/admin/profile', {
      method: 'PUT',
      body: profileData,
    });
  }

  async updateSuperAdminProfile(profileData) {
    return this.request('/admin/super-admin/profile', {
      method: 'PUT',
      body: profileData,
    });
  }

  // Super Admin - Admin Management
  async getAdmins() {
    return this.request('/admin/super-admin/admins');
  }

  async createAdmin(adminData) {
    return this.request('/admin/super-admin/admins', {
      method: 'POST',
      body: adminData,
    });
  }

  async updateAdmin(adminId, adminData) {
    return this.request(`/admin/super-admin/admins/${adminId}`, {
      method: 'PUT',
      body: adminData,
    });
  }

  // Soft delete (recoverable for 90 days). Clients must be reassigned first.
  async deleteAdmin(adminId, { reassignToAdminId, reason } = {}) {
    return this.request(`/admin/super-admin/admins/${adminId}`, {
      method: 'DELETE',
      body: { reassignToAdminId: reassignToAdminId || undefined, reason: reason || undefined },
    });
  }

  async deactivateAdmin(adminId, { reassignToAdminId, reason } = {}) {
    return this.request(`/admin/super-admin/admins/${adminId}/deactivate`, {
      method: 'POST',
      body: { reassignToAdminId: reassignToAdminId || undefined, reason: reason || undefined },
    });
  }

  // Emails an invite (first time) or reset link to an admin
  async sendAdminReset(adminId) {
    return this.request(`/admin/admins/${adminId}/send-reset`, {
      method: 'POST',
    });
  }

  // Emails an invite (first time) or reset link to a client
  async sendUserReset(userId) {
    return this.request(`/admin/users/${userId}/send-reset`, {
      method: 'POST',
    });
  }

  // Super Admin - User Management
  async getAllUsers({ unassigned } = {}) {
    return this.request(`/admin/super-admin/users${unassigned ? '?unassigned=true' : ''}`);
  }

  async transferUser(userId, adminId, reason) {
    return this.request(`/admin/super-admin/users/${userId}/transfer`, {
      method: 'PUT',
      body: { admin_id: adminId, reason },
    });
  }

  // ==================== ACTIVITY LOG / RECYCLE BIN / PRIVACY (staff) ====================

  async getActivityLog(params = {}) {
    return this.request(`/admin/activity-log${toQuery(params)}`);
  }

  // Returns { blob, filename } so the caller can trigger a download
  async exportActivityLog(params = {}) {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
    const response = await fetch(`${this.baseURL}/admin/activity-log/export.csv${toQuery(params)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!response.ok) {
      let message = `Export failed (${response.status})`;
      try {
        const parsed = JSON.parse(await response.text());
        message = parsed.error || message;
      } catch { /* keep default */ }
      throw new Error(message);
    }
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    return {
      blob: await response.blob(),
      filename: match ? match[1] : `lifemap-activity-log-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  async getActivityLogArchives(params = {}) {
    return this.request(`/admin/activity-log/archives${toQuery(params)}`);
  }

  async downloadActivityLogArchive(day) {
    const token = localStorage.getItem('adminToken') || localStorage.getItem('authToken');
    const response = await fetch(`${this.baseURL}/admin/activity-log/archives/${encodeURIComponent(day)}.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (!response.ok) {
      let message = `Archive download failed (${response.status})`;
      try {
        const parsed = JSON.parse(await response.text());
        message = parsed.error || message;
      } catch { /* keep default */ }
      throw new Error(message);
    }
    return {
      blob: await response.blob(),
      filename: `lifemap-activity-log-${day}.csv`,
    };
  }

  async runActivityLogArchive(day) {
    return this.request('/admin/activity-log/archives/run', {
      method: 'POST',
      body: day ? { day } : {},
    });
  }

  async getDeletedItems() {
    return this.request('/admin/deleted-items');
  }

  async restoreDeletedItem(id) {
    return this.request(`/admin/deleted-items/${id}/restore`, { method: 'POST' });
  }

  async purgeDeletedItem(id) {
    return this.request(`/admin/deleted-items/${id}/purge`, { method: 'POST' });
  }

  async setDeletedItemLegalHold(id, hold) {
    return this.request(`/admin/deleted-items/${id}/legal-hold`, { method: 'POST', body: { hold } });
  }

  async getPrivacyRequestsAdmin(status) {
    return this.request(`/admin/privacy-requests${toQuery({ status })}`);
  }

  // Body: { status?: 'Received' | 'In progress' | 'Closed' | 'Rejected', notes? }
  async updatePrivacyRequest(id, { status, notes } = {}) {
    return this.request(`/admin/privacy-requests/${id}`, {
      method: 'PATCH',
      body: { status, notes },
    });
  }

  async getAccessReview() {
    return this.request('/admin/access-review');
  }

  // decision: 'Keep' | 'Deactivate' (Deactivate needs reassignToAdminId when the admin has clients)
  async submitAccessReviewDecision({ adminId, decision, reassignToAdminId, reason } = {}) {
    return this.request('/admin/access-review', {
      method: 'POST',
      body: { adminId, decision, reassignToAdminId: reassignToAdminId || undefined, reason: reason || undefined },
    });
  }

  // Move all clients from one associate to another, deactivate the first and invite the second
  async associateChange({ fromAdminId, toAdminId }) {
    return this.request('/admin/super-admin/associate-change', {
      method: 'POST',
      body: { fromAdminId, toAdminId },
    });
  }

  // Admin - User Management
  async getAdminUsers() {
    return this.request('/admin/admin/users');
  }

  async createUser(userData) {
    return this.request('/admin/admin/users', {
      method: 'POST',
      body: userData,
    });
  }

  async updateUser(userId, userData) {
    return this.request(`/admin/admin/users/${userId}`, {
      method: 'PUT',
      body: userData,
    });
  }

  // Soft delete (recoverable for 90 days); a reason is required
  async deleteUser(userId, reason) {
    return this.request(`/admin/admin/users/${userId}`, {
      method: 'DELETE',
      body: { reason },
    });
  }

  async getUserProfile(userId) {
    return this.request(`/admin/admin/users/${userId}/profile`);
  }

  // Admin - Access User Financial Data (with userId context)
  // These routes use /api/admin/financial which requires userId query parameter
  async getFinancialProfileForUser(userId) {
    return this.request(`/admin/financial/profile/${userId}?userId=${userId}`);
  }

  async updateFinancialProfileForUser(profileId, profileData, userId) {
    return this.request(`/admin/financial/profile/${profileId}?userId=${userId}`, {
      method: 'PUT',
      body: profileData,
    });
  }

  async createFinancialProfileForUser(profileData, userId) {
    return this.request(`/admin/financial/profile?userId=${userId}`, {
      method: 'POST',
      body: profileData,
    });
  }

  async getFinancialGoalsForUser(userId) {
    return this.request(`/admin/financial/goal/${userId}?userId=${userId}`);
  }

  async createFinancialGoalForUser(goalData, userId) {
    return this.request(`/admin/financial/goal?userId=${userId}`, {
      method: 'POST',
      body: goalData,
    });
  }

  async updateFinancialGoalForUser(goalId, goalData, userId) {
    return this.request(`/admin/financial/goal/${goalId}?userId=${userId}`, {
      method: 'PUT',
      body: goalData,
    });
  }

  async deleteFinancialGoalForUser(goalId, userId) {
    return this.request(`/admin/financial/goal/${goalId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async getFinancialExpensesForUser(userId) {
    return this.request(`/admin/financial/expense/${userId}?userId=${userId}`);
  }

  async createFinancialExpenseForUser(expenseData, userId) {
    return this.request(`/admin/financial/expense?userId=${userId}`, {
      method: 'POST',
      body: expenseData,
    });
  }

  async updateFinancialExpenseForUser(expenseId, expenseData, userId) {
    return this.request(`/admin/financial/expense/${expenseId}?userId=${userId}`, {
      method: 'PUT',
      body: expenseData,
    });
  }

  async deleteFinancialExpenseForUser(expenseId, userId) {
    return this.request(`/admin/financial/expense/${expenseId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async classifyExpenseForUser(description, userId) {
    return this.request(`/admin/financial/expense/classify?userId=${userId}`, {
      method: 'POST',
      body: { description, user_id: userId },
    });
  }

  async getFinancialLoansForUser(userId) {
    return this.request(`/admin/financial/loan/${userId}?userId=${userId}`);
  }

  async createFinancialLoanForUser(loanData, userId) {
    return this.request(`/admin/financial/loan?userId=${userId}`, {
      method: 'POST',
      body: loanData,
    });
  }

  async updateFinancialLoanForUser(loanId, loanData, userId) {
    return this.request(`/admin/financial/loan/${loanId}?userId=${userId}`, {
      method: 'PUT',
      body: loanData,
    });
  }

  async deleteFinancialLoanForUser(loanId, userId) {
    return this.request(`/admin/financial/loan/${loanId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async getPlannedLoansForUser(userId) {
    return this.request(`/admin/financial/planned-loans/${userId}?userId=${userId}`);
  }

  async createPlannedLoanForUser(loanData, userId) {
    return this.request(`/admin/financial/planned-loan?userId=${userId}`, {
      method: 'POST',
      body: loanData,
    });
  }

  async updatePlannedLoanForUser(loanId, loanData, userId) {
    return this.request(`/admin/financial/planned-loan/${loanId}?userId=${userId}`, {
      method: 'PUT',
      body: loanData,
    });
  }

  async deletePlannedLoanForUser(loanId, userId) {
    return this.request(`/admin/financial/planned-loan/${loanId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async getFinancialAssetsForUser(userId) {
    return this.request(`/admin/financial/asset/${userId}?userId=${userId}`);
  }

  async createFinancialAssetForUser(assetData, userId) {
    return this.request(`/admin/financial/asset?userId=${userId}`, {
      method: 'POST',
      body: assetData,
    });
  }

  async updateFinancialAssetForUser(assetId, assetData, userId) {
    return this.request(`/admin/financial/asset/${assetId}?userId=${userId}`, {
      method: 'PUT',
      body: assetData,
    });
  }

  async deleteFinancialAssetForUser(assetId, userId) {
    return this.request(`/admin/financial/asset/${assetId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async getWorkAssetsForUser(userId) {
    return this.request(`/admin/financial/work-assets/${userId}?userId=${userId}`);
  }

  async createWorkAssetForUser(workAssetData, userId) {
    return this.request(`/admin/financial/work-asset?userId=${userId}`, {
      method: 'POST',
      body: workAssetData,
    });
  }

  async updateWorkAssetForUser(assetId, workAssetData, userId) {
    return this.request(`/admin/financial/work-asset/${assetId}?userId=${userId}`, {
      method: 'PUT',
      body: workAssetData,
    });
  }

  async deleteWorkAssetForUser(assetId, userId) {
    return this.request(`/admin/financial/work-asset/${assetId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  async getFinancialInsuranceForUser(userId) {
    return this.request(`/admin/financial/insurance/${userId}?userId=${userId}`);
  }

  async createFinancialInsuranceForUser(insuranceData, userId) {
    return this.request(`/admin/financial/insurance?userId=${userId}`, {
      method: 'POST',
      body: insuranceData,
    });
  }

  async updateFinancialInsuranceForUser(insuranceId, insuranceData, userId) {
    return this.request(`/admin/financial/insurance/${insuranceId}?userId=${userId}`, {
      method: 'PUT',
      body: insuranceData,
    });
  }

  async deleteFinancialInsuranceForUser(insuranceId, userId) {
    return this.request(`/admin/financial/insurance/${insuranceId}?userId=${userId}`, {
      method: 'DELETE',
    });
  }

  // Admin - Asset Columns and User Tags
  async getAssetColumnsForUser(userId) {
    return this.request(`/admin/financial/asset-columns/${userId}?userId=${userId}`);
  }

  async getUserTagsForUser(userId) {
    return this.request(`/admin/financial/user-tags/${userId}?userId=${userId}`);
  }

  // Admin - Source Preferences
  async getSourcePreferencesForUser(userId) {
    return this.request(`/admin/financial/source-preferences?userId=${userId}`);
  }

  async updateSourcePreferenceForUser(component, source, userId) {
    return this.request(`/admin/financial/source-preferences?userId=${userId}`, {
      method: 'POST',
      body: { component, source },
    });
  }
}

export default new ApiService();

