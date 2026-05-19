import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { getTablePermissions } from "../utils/tableAccess";

export function useTableAccess(tableName) {
  const { user } = useAuth();
  return useMemo(
    () => getTablePermissions(user?.table_access, tableName),
    [user?.table_access, tableName]
  );
}
