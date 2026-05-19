const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  getUserLocationId,
  sendLocationForbidden,
} = require("../utils/userLocationScope");
const { requireTableAccess } = require("../middleware/requireTableAccess");

const router = express.Router();
router.use(requireTableAccess("terminal"));

const listSql = `
  SELECT t.id, t.location_id, l.code AS location_code, l.name AS location_name,
         t.code, t.name, t.starting_number, t.next_number, t.is_active, t.created_at
  FROM terminal t
  JOIN location l ON l.id = t.location_id
`;

function formatSeq(n) {
  return String(n).padStart(2, "0");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getNextTerminalCode(client, locationId, locationCode) {
  const prefix = String(locationCode || "").trim().toUpperCase();
  if (!prefix) return null;
  const { rows } = await client.query(
    "SELECT code FROM terminal WHERE location_id = $1 FOR UPDATE",
    [locationId]
  );
  const suffixRe = new RegExp(`^${escapeRegex(prefix)}(\\d{2})$`, "i");
  const used = new Set();
  for (const r of rows) {
    const code = String(r.code ?? "").trim();
    const m = code.match(suffixRe);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isInteger(n)) used.add(n);
    }
  }
  const maxUsed = used.size ? Math.max(...used) : 0;
  const next = maxUsed + 1;
  if (next > 99) return null;
  return `${prefix}${formatSeq(next)}`;
}

function parseRequiredInt(val) {
  const n = Number.parseInt(val, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseRequiredBigInt(val) {
  if (val === undefined || val === null || String(val).trim() === "") return null;
  try {
    const n = BigInt(String(val).trim());
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

router.get("/", async (req, res) => {
  try {
    const userLoc = getUserLocationId(req.user);
    const params = [];
    const where = userLoc != null ? "WHERE t.location_id = $1" : "";
    if (userLoc != null) params.push(userLoc);
    const { rows } = await pool.query(
      `${listSql} ${where} ORDER BY l.name NULLS LAST, l.code, t.name NULLS LAST, t.code`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rows } = await pool.query(`${listSql} WHERE t.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Terminal not found" });
    const userLoc = getUserLocationId(req.user);
    if (userLoc != null && Number(rows[0].location_id) !== userLoc) {
      return sendLocationForbidden(res);
    }
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const locationId = parseRequiredInt(req.body?.location_id);
    const startingNumber = parseRequiredBigInt(req.body?.starting_number);
    const nextNumber = parseRequiredBigInt(req.body?.next_number);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    if (locationId === null) {
      return res.status(400).json({ error: "Valid location_id is required" });
    }
    if (startingNumber === null) {
      return res.status(400).json({ error: "Valid starting_number is required" });
    }
    if (nextNumber === null) {
      return res.status(400).json({ error: "Valid next_number is required" });
    }

    await client.query("BEGIN");

    const locResult = await client.query(
      "SELECT code FROM location WHERE id = $1 FOR UPDATE",
      [locationId]
    );
    if (!locResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid location_id" });
    }
    const locationCode = String(locResult.rows[0].code || "").trim().toUpperCase();
    if (!locationCode) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Location is missing a code" });
    }

    const code = await getNextTerminalCode(client, locationId, locationCode);
    if (code === null) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: `Terminal sequence limit reached for ${locationCode} (01-99)` });
    }
    const name = code;

    const { rows } = await client.query(
      `INSERT INTO terminal (location_id, code, name, starting_number, next_number, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        locationId,
        code,
        name,
        startingNumber.toString(),
        nextNumber.toString(),
        isActive,
      ]
    );

    await client.query("COMMIT");
    const detail = await pool.query(`${listSql} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json(detail.rows[0]);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // no-op
    }
    sendPgError(res, err);
  } finally {
    client.release();
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const startingNumber = parseRequiredBigInt(req.body?.starting_number);
    const nextNumber = parseRequiredBigInt(req.body?.next_number);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    if (startingNumber === null) {
      return res.status(400).json({ error: "Valid starting_number is required" });
    }
    if (nextNumber === null) {
      return res.status(400).json({ error: "Valid next_number is required" });
    }

    const { rows } = await pool.query(
      `UPDATE terminal
       SET starting_number = $1, next_number = $2, is_active = $3
       WHERE id = $4
       RETURNING id`,
      [startingNumber.toString(), nextNumber.toString(), isActive, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Terminal not found" });

    const detail = await pool.query(`${listSql} WHERE t.id = $1`, [id]);
    res.json(detail.rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rowCount } = await pool.query("DELETE FROM terminal WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Terminal not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
