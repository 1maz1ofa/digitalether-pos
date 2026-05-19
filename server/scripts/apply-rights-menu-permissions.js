/**
 * Applies rights-menu-permissions.sql. Safe to run multiple times.
 * Usage: node scripts/apply-rights-menu-permissions.js
 */
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const sqlPath = path.join(__dirname, "rights-menu-permissions.sql");

(async () => {
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Applied rights-menu-permissions.sql");

  const { rows } = await pool.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'rights'::regclass
       AND conname IN ('rights_object_type_chk', 'rights_object_name_check')`
  );
  console.log(JSON.stringify(rows, null, 2));

  const role = await pool.query("SELECT id FROM roles ORDER BY id LIMIT 1");
  if (role.rows[0]) {
    const test = await pool.query(
      `INSERT INTO rights (role_id, object_name, object_type, can_read, can_create, can_edit, can_delete)
       VALUES ($1, 'pos', 'MENU', true, false, false, false)
       RETURNING id`,
      [role.rows[0].id]
    );
    await pool.query("DELETE FROM rights WHERE id = $1", [test.rows[0].id]);
    console.log("Verified MENU insert for object_name=pos");
  }

  await pool.end();
})().catch((err) => {
  console.error(err.message || err);
  pool.end().finally(() => process.exit(1));
});
