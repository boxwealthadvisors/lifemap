import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import ApiService from '../services/api';
import { useDebounce } from '../utils/debounce';
import { toast } from 'sonner';

const AuthContext = createContext();

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;
const LAST_ACTIVITY_KEY = 'lifemapLastActivity';
const IDLE_NOTICE_KEY = 'lifemapIdleLogout';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [admin, setAdmin] = useState(null); // Admin or super admin
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const authEpochRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const lastPersistedRef = useRef(0);

  const clearAuthStorage = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('adminToken');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('adminToken');
    localStorage.removeItem(LAST_ACTIVITY_KEY);
  };

  // Records user activity; persisted (throttled) so other tabs and reloads share the idle clock
  const touchActivity = (force = false) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (force || now - lastPersistedRef.current > 5000) {
      lastPersistedRef.current = now;
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* storage unavailable */ }
    }
  };

  // Debounced auth check to prevent request flooding
  const debouncedCheckAuth = useDebounce(() => {
    const hasToken = Boolean(localStorage.getItem('authToken'));
    if (hasToken) checkAuthStatus({ silent: true });
  }, 400);

  // Check if user is already logged in on app start
  useEffect(() => {
    // Check for regular user token
    const hasToken = Boolean(localStorage.getItem('authToken'));
    // Check for admin token
    const hasAdminToken = Boolean(localStorage.getItem('adminToken'));
    
    if (hasToken) {
      checkAuthStatus();
    } else if (hasAdminToken) {
      // Admin token exists - fetch admin details from backend
      checkAdminStatus();
    } else {
      setLoading(false);
    }
  }, []);

  // Handle tab visibility changes with debouncing
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) {
        debouncedCheckAuth();
      }
    };
    
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [debouncedCheckAuth]);

  const checkAuthStatus = async ({ silent = false } = {}) => {
    const epoch = authEpochRef.current;
    try {
      if (!silent) setLoading(true);
      const response = await ApiService.getProfile();
      if (epoch !== authEpochRef.current) return;
      setUser(response.user);
    } catch (error) {
      if (epoch !== authEpochRef.current) return;
      const msg = String(error.message || '').toLowerCase();
      const unauth = msg.includes('not authenticated') || msg.includes('access token') || msg.includes('401');
      if (silent && !unauth) return;
      setUser(null);
      clearAuthStorage();
      if (error.message && !unauth) {
        setError(error.message);
      } else {
        setError(null);
      }
    } finally {
      if (!silent && epoch === authEpochRef.current) setLoading(false);
    }
  };

  const checkAdminStatus = async () => {
    try {
      setLoading(true);
      // Fetch admin profile from backend
      const response = await ApiService.getAdminProfile();
      if (response.admin) {
        setAdmin(response.admin);
        console.log('[AuthContext] Restored admin state from backend:', response.admin);
      }
    } catch (error) {
      console.error('[AuthContext] Failed to check admin status:', error);
      // If token is invalid, clear it
      localStorage.removeItem('adminToken');
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  };

  // Stores the session token and sets user/admin state according to role
  const applySession = (response) => {
    const role = response.role || 'client';
    if (role === 'admin' || role === 'super_admin') {
      setAdmin(response.user);
      setUser(null);
      if (response.token) {
        localStorage.setItem('adminToken', response.token);
        localStorage.removeItem('authToken');
      }
    } else {
      setUser(response.user);
      setAdmin(null);
      if (response.token) {
        localStorage.setItem('authToken', response.token);
        localStorage.removeItem('adminToken');
      }
    }
    touchActivity(true);
    return { ...response, role };
  };

  // Step 1: password. When the backend asks for an OTP we return the challenge untouched
  // ({ requiresOtp, pendingToken, challengeEmail, role }) and do not set any user.
  const login = async (credentials) => {
    try {
      setError(null);
      setLoading(true);
      const identifier = credentials.identifier || credentials.email || credentials.username;
      const response = await ApiService.login({
        identifier,
        password: credentials.password,
      });
      if (response.requiresOtp) return response;
      return applySession(response);
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Step 2: emailed 6-digit code
  const verifyLogin = async (pendingToken, otp) => {
    try {
      setError(null);
      setLoading(true);
      const response = await ApiService.verifyLogin({ pendingToken, otp });
      return applySession(response);
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const resendLoginOtp = async (pendingToken) => {
    try {
      setError(null);
      return await ApiService.resendLoginOtp(pendingToken);
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  const register = async (userData) => {
    try {
      setError(null);
      setLoading(true);
      // consentAccepted must be true for the backend to create the account
      const response = await ApiService.register({
        ...userData,
        consentAccepted: userData?.consentAccepted === true,
      });
      if (response.token) {
        localStorage.setItem('authToken', response.token);
        localStorage.removeItem('adminToken');
      }
      setUser(response.user);
      setAdmin(null);
      touchActivity(true);
      
      return response;
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const requestOtp = async (email, purpose = 'signup') => {
    try {
      setError(null);
      return await ApiService.requestOtp({ email, purpose });
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  // Fire the server-side revoke while the token is still stored, then clear local state.
  const serverLogout = () => ApiService.logout().catch(() => {
    /* server logout is best-effort */
  });

  const logout = async () => {
    authEpochRef.current += 1;
    setError(null);
    const pending = serverLogout();
    setUser(null);
    setAdmin(null);
    clearAuthStorage();
    await pending;
  };

  // Admin login methods
  const superAdminLogin = async (credentials) => {
    try {
      setError(null);
      setLoading(true);
      const response = await ApiService.superAdminLogin(credentials);
      setAdmin(response.user);
      
      // Store admin token in localStorage
      if (response.token) {
        localStorage.setItem('adminToken', response.token);
        localStorage.removeItem('authToken'); // Clear user token if exists
      }
      
      return response;
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const adminLogin = async (credentials) => {
    try {
      setError(null);
      setLoading(true);
      const response = await ApiService.adminLogin(credentials);
      setAdmin(response.user);
      
      // Store admin token in localStorage
      if (response.token) {
        localStorage.setItem('adminToken', response.token);
        localStorage.removeItem('authToken'); // Clear user token if exists
      }
      
      return response;
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const adminLogout = async () => {
    authEpochRef.current += 1;
    setError(null);
    const pending = serverLogout();
    setAdmin(null);
    setUser(null);
    clearAuthStorage();
    await pending;
  };

  // ---- Idle logout (60 minutes without activity) ----
  const logoutHandlersRef = useRef({});
  logoutHandlersRef.current = { logout, adminLogout };
  const signedIn = Boolean(user || admin);

  useEffect(() => {
    if (!signedIn) return undefined;

    // A reload after a long absence counts as idle too
    const stored = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (stored && Date.now() - stored > IDLE_TIMEOUT_MS) {
      lastActivityRef.current = stored;
    } else {
      touchActivity();
    }

    const idleOut = async () => {
      try { sessionStorage.setItem(IDLE_NOTICE_KEY, '1'); } catch { /* ignore */ }
      const { logout: doLogout, adminLogout: doAdminLogout } = logoutHandlersRef.current;
      await Promise.allSettled([doLogout(), doAdminLogout()]);
      window.location.assign('/');
    };

    const check = () => {
      // Another tab may have been active more recently
      const shared = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0;
      if (shared > lastActivityRef.current) lastActivityRef.current = shared;
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) idleOut();
    };

    const onActivity = () => touchActivity();
    const onVisibility = () => {
      if (document.hidden) return;
      check(); // returning to a tab that sat idle past the limit signs out immediately
      touchActivity();
    };

    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('click', onActivity);
    // The plan pages run inside an iframe whose events never reach this window;
    // the mockup bridge posts throttled "activity" (and save) messages instead.
    const onMessage = (event) => {
      if (event?.data?.source === 'lifemap-mockup') touchActivity();
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(check, IDLE_CHECK_INTERVAL_MS);
    check();

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [signedIn]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(IDLE_NOTICE_KEY)) {
        sessionStorage.removeItem(IDLE_NOTICE_KEY);
        toast.info('You were signed out after 60 minutes of inactivity.');
      }
    } catch { /* ignore */ }
  }, []);

  const updateProfile = async (profileData) => {
    try {
      setError(null);
      const response = await ApiService.updateProfile(profileData);
      setUser(response.user);
      return response;
    } catch (error) {
      setError(error.message);
      throw error;
    }
  };

  const clearError = () => {
    setError(null);
  };

  const value = {
    user,
    setUser,
    admin,
    setAdmin,
    loading,
    error,
    login,
    verifyLogin,
    resendLoginOtp,
    register,
    requestOtp,
    logout,
    updateProfile,
    clearError,
    isAuthenticated: !!user,
    isAdmin: !!admin,
    isSuperAdmin: admin?.role === 'super_admin',
    superAdminLogin,
    adminLogin,
    adminLogout,
    setError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

