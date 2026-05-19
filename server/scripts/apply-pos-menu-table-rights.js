/**
 * Backfill TABLE rights for roles that already have POS menu read access.
 * Usage: node scripts/apply-pos-menu-table-rights.js
 */
const pool = require("../db");
const { ensureMenuTableRights } = require("../utils/ensureMenuTableRights");

(async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT role_id, object_name, object_type
     FROM rights
     WHERE object_type IN ('MENU', 'SUBMENU')
       AND can_read = true
       AND (
         (object_type = 'MENU' AND object_name = 'pos')
         OR (object_type = 'SUBMENU' AND object_name LIKE 'pos.%')
       )`
  );

  if (!rows.length) {
    console.log("No roles with POS menu read access found.");
    await pool.end();
    return;
  }

  let totalEnsured = 0;
  for (const row of rows) {
    const result = await ensureMenuTableRights(
      pool,
      row.role_id,
      row.object_name,
      row.object_type
    );
    totalEnsured += result.ensured;
    console.log(
      `role_id=${row.role_id} menu=${row.object_name}: ensured ${result.ensured} table right(s)`
    );
  }

  console.log(`Done. ${totalEnsured} table right row(s) inserted or updated.`);
  await pool.end();
})().catch((err) => {
  console.error(err.message || err);
  pool.end().finally(() => process.exit(1));
});
