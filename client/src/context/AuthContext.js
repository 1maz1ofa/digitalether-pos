import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { clearStoredToken, getStoredToken, setStoredToken } from "../authStorage";
import { setMenuCatalog } from "../utils/menuAccess";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [menuCatalogReady, setMenuCatalogReady] = useState(false);

  const loadMenuCatalog = useCallback(async () => {
    try {
      const menus = await api.rights.schemaMenus();
      setMenuCatalog(Array.isArray(menus) ? menus : []);
    } catch {
      setMenuCatalog([]);
    } finally {
      setMenuCatalogReady(true);
    }
  }, []);

  const applySession = useCallback((token, nextUser) => {
    setStoredToken(token);
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    clearStoredToken();
    setUser(null);
    setMenuCatalog([]);
    setMenuCatalogReady(false);
  }, []);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setMenuCatalogReady(true);
      setLoading(false);
      return null;
    }
    try {
      const [meRes] = await Promise.all([api.auth.me(), loadMenuCatalog()]);
      setUser(meRes.user);
      return meRes.user;
    } catch {
      clearSession();
      return null;
    } finally {
      setLoading(false);
    }
  }, [clearSession, loadMenuCatalog]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email, password) => {
      const { token, user: loggedIn } = await api.auth.login({ email, password });
      applySession(token, loggedIn);
      setMenuCatalogReady(false);
      await loadMenuCatalog();
      return loggedIn;
    },
    [applySession, loadMenuCatalog]
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
      loading: loading || (Boolean(user) && !menuCatalogReady),
      isAuthenticated: Boolean(user),
      login,
      logout,
      refreshSession,
      clearSession,
    }),
    [user, loading, menuCatalogReady, login, logout, refreshSession, clearSession]
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
