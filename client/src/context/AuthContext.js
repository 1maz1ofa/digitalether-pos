import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { clearStoredToken, getStoredToken, setStoredToken } from "../authStorage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback((token, nextUser) => {
    setStoredToken(token);
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const { user: me } = await api.auth.me();
      setUser(me);
      return me;
    } catch {
      clearSession();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email, password) => {
      const { token, user: loggedIn } = await api.auth.login({ email, password });
      applySession(token, loggedIn);
      return loggedIn;
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* session may already be invalid */
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      refreshSession,
      clearSession,
    }),
    [user, loading, login, logout, refreshSession, clearSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
