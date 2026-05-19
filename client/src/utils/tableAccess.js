export function getTablePermissions(tableAccess, tableName) {
  const name = String(tableName || "").trim();
  if (!tableAccess) {
    return {
      canRead: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    };
  }
  if (tableAccess.bypass) {
    return {
      canRead: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
    };
  }
  const entry = tableAccess.tables?.[name];
  return {
    canRead: Boolean(entry?.can_read),
    canCreate: Boolean(entry?.can_create),
    canEdit: Boolean(entry?.can_edit),
    canDelete: Boolean(entry?.can_delete),
  };
}
