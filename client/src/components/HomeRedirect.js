import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { firstAllowedPath } from "../utils/menuAccess";

export function HomeRedirect() {
  const { user } = useAuth();
  const target = firstAllowedPath(user?.menu_access) || "/pos";
  return <Navigate to={target} replace />;
}
