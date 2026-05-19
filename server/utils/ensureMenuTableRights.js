const { menuIdFromRight, tableRightsForMenu } = require("../config/menuTableRights");

function mergeFlags(existing, spec) {
  return {
    can_read: Boolean(existing?.can_read || spec.can_read),
    can_create: Boolean(existing?.can_create || spec.can_create),
    can_edit: Boolean(existing?.can_edit || spec.can_edit),
    can_delete: Boolean(existing?.can_delete || spec.can_delete),
  };
}

function flagsEqual(a, b) {
  return (
    Boolean(a.can_read) === Boolean(b.can_read) &&
    Boolean(a.can_create) === Boolean(b.can_create) &&
    Boolean(a.can_edit) === Boolean(b.can_edit) &&
    Boolean(a.can_delete) === Boolean(b.can_delete)
  );
}

/**
 * Upserts TABLE rights required for the given menu permission.
 * Existing table rights are merged upward (never reduced).
 */
async function ensureMenuTableRights(db, roleId, objectName, objectType) {
  const menuId = menuIdFromRight(objectName, objectType);
  if (!menuId) return { ensured: 0, menuId: null };

  const specs = tableRightsForMenu(menuId);
  if (!specs?.length) return { ensured: 0, menuId };

  let ensured = 0;
  for (const spec of specs) {
    const table = String(spec.table || "").trim();
    if (!table) continue;

    const target = {
      can_read: Boolean(spec.can_read),
      can_create: Boolean(spec.can_create),
      can_edit: Boolean(spec.can_edit),
      can_delete: Boolean(spec.can_delete),
    };

    const { rows } = await db.query(
      `SELECT id, can_read, can_create, can_edit, can_delete
       FROM rights
       WHERE role_id = $1
         AND object_type = 'TABLE'
         AND object_name = $2`,
      [roleId, table]
    );

    if (!rows.length) {
      await db.query(
        `INSERT INTO rights (
           role_id, object_name, object_type, can_read, can_create, can_edit, can_delete
         )
         VALUES ($1, $2, 'TABLE', $3, $4, $5, $6)`,
        [
          roleId,
          table,
          target.can_read,
          target.can_create,
          target.can_edit,
          target.can_delete,
        ]
      );
      ensured += 1;
      continue;
    }

    const merged = mergeFlags(rows[0], target);
    if (!flagsEqual(rows[0], merged)) {
      await db.query(
        `UPDATE rights
         SET can_read = $1,
             can_create = $2,
             can_edit = $3,
             can_delete = $4
         WHERE id = $5`,
        [
          merged.can_read,
          merged.can_create,
          merged.can_edit,
          merged.can_delete,
          rows[0].id,
        ]
      );
      ensured += 1;
    }
  }

  return { ensured, menuId };
}

function shouldEnsureMenuTableRights(objectType, canRead) {
  if (!canRead) return false;
  return objectType === "MENU" || objectType === "SUBMENU";
}

module.exports = {
  ensureMenuTableRights,
  shouldEnsureMenuTableRights,
};
