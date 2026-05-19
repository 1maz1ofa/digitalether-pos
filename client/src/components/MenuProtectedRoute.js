import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { canAccessPath, firstAllowedPath } from "../utils/menuAccess";

/** Blocks routes the user's role has no MENU/SUBMENU read right for (Super User / Admin bypass). */
export function MenuProtectedRoute({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const menuAccess = user?.menu_access;

  if (canAccessPath(location.pathname, menuAccess)) {
    return children;
  }

  const fallback = firstAllowedPath(menuAccess);
  if (fallback && fallback !== location.pathname) {
    return <Navigate to={fallback} replace />;
  }

  return (
    <div className="page">
      <div className="card">
        <h1>Access denied</h1>
        <p className="muted">
          Your role does not have permission to open this page. Ask an administrator
          to assign menu access under Roles.
        </p>
      </div>
    </div>
  );
}
