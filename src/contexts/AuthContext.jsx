import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import ApiService from '../services/api';
import { useDebounce } from '../utils/debounce';

const AuthContext = createContext();

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

  const clearAuthStorage = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('adminToken');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('adminToken');
  };

  // Debounced auth check to prevent request flooding
  const debouncedCheckAuth = useDebounce(() => {
    const hasToken = Boolean(localStorage.getItem('authToken'));
    if (hasToken) checkAuthStatus();
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

  const checkAuthStatus = async () => {
    const epoch = authEpochRef.current;
    try {
      setLoading(true);
      const response = await ApiService.getProfile();
      if (epoch !== authEpochRef.current) return;
      setUser(response.user);
    } catch (error) {
      if (epoch !== authEpochRef.current) return;
      setUser(null);
      clearAuthStorage();
      if (error.message && !error.message.toLowerCase().includes('not authenticated') && !error.message.toLowerCase().includes('access token')) {
        setError(error.message);
      } else {
        setError(null);
      }
    } finally {
      if (epoch === authEpochRef.current) setLoading(false);
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

  const login = async (credentials) => {
    try {
      setError(null);
      setLoading(true);
      const identifier = credentials.identifier || credentials.email || credentials.username;
      const response = await ApiService.login({
        identifier,
        password: credentials.password,
      });
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
      return { ...response, role };
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (userData) => {
    try {
      setError(null);
      setLoading(true);
      const response = await ApiService.register(userData);
      if (response.token) {
        localStorage.setItem('authToken', response.token);
      }
      setUser(response.user);
      
      return response;
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    authEpochRef.current += 1;
    setError(null);
    setUser(null);
    setAdmin(null);
    clearAuthStorage();
    try {
      await ApiService.logout();
    } catch {
      /* token already cleared; server logout is best-effort */
    }
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
    setAdmin(null);
    setUser(null);
    clearAuthStorage();
  };

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
    register,
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

