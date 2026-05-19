/**
 * Applies rights-can-create.sql. Safe to run multiple times.
 * Usage: node scripts/apply-rights-can-create.js
 */
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const sqlPath = path.join(__dirname, "rights-can-create.sql");

async function main() {
  const sql = fs.readFileSync(sqlPath, "utf8");
  await pool.query(sql);
  console.log("Applied rights-can-create.sql");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
