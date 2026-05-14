const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

const productImagesDir = path.join(__dirname, "..", "uploads", "products");
fs.mkdirSync(productImagesDir, { recursive: true });

const PUBLIC_PRODUCT_IMAGE_PREFIX = "/uploads/products/";

function localProductImageAbsolutePath(storedUrl) {
  if (typeof storedUrl !== "string" || !storedUrl.startsWith(PUBLIC_PRODUCT_IMAGE_PREFIX)) {
    return null;
  }
  const base = path.basename(storedUrl);
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    return null;
  }
  return path.join(productImagesDir, base);
}

function tryUnlinkLocalProductImage(storedUrl) {
  const abs = localProductImageAbsolutePath(storedUrl);
  if (!abs) return;
  fs.unlink(abs, () => {});
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, productImagesDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
      const extFinal = allowed.includes(ext) ? ext : ".jpg";
      cb(null, `${req.params.id}-${Date.now()}${extFinal}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image uploads are allowed"));
    }
  },
});

function runProductImageUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Image must be 5MB or smaller" });
      }
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    return res.status(400).json({ error: err.message || "Upload failed" });
  });
}

const listSql = `
  SELECT p.id, p.code, p.name, p.description, p.barcode, p.unit_of_measure,
         p.category_id, c.name AS category_name,
         p.unit_cost, p.unit_price, p.vat_id, v.name AS vat_name, v.percentage AS vat_percentage, p.is_active,
         p.reorder_level, p.image_url, p.created_at
  FROM product p
  LEFT JOIN category c ON c.id = p.category_id
  LEFT JOIN vat v ON v.id = p.vat_id
`;

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`${listSql} ORDER BY p.name NULLS LAST, p.code`);
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * Locations where this product has inventory and/or outgoing promises.
 * promised_quantity is the total promised from each location (inventory_promise.from_location_id).
 * reserved_quantity is the total reserved from each location (inventory_promise.from_location_id).
 */
router.get("/:id/inventory-locations", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const exists = await pool.query("SELECT 1 FROM product WHERE id = $1", [id]);
    if (!exists.rowCount) {
      return res.status(404).json({ error: "Product not found" });
    }
    const { rows } = await pool.query(
      `SELECT l.id AS location_id,
              l.code AS location_code,
              l.name AS location_name,
              COALESCE(i.quantity, 0)::numeric AS total_quantity,
              COALESCE(pr.sum_promised, 0)::numeric AS promised_quantity,
              COALESCE(pr.sum_reserved, 0)::numeric AS reserved_quantity
       FROM location l
       LEFT JOIN inventory i ON i.location_id = l.id AND i.product_id = $1
       LEFT JOIN (
         SELECT from_location_id,
                SUM(promised_quantity)::numeric AS sum_promised,
                SUM(reserved_quantity)::numeric AS sum_reserved
         FROM inventory_promise
         WHERE product_id = $1
         GROUP BY from_location_id
       ) pr ON pr.from_location_id = l.id
       WHERE i.id IS NOT NULL
          OR COALESCE(pr.sum_promised, 0) <> 0
          OR COALESCE(pr.sum_reserved, 0) <> 0
       ORDER BY l.name NULLS LAST, l.code NULLS LAST, l.id`,
      [id]
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
    const { rows } = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/:id/image", runProductImageUpload, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Missing image file (field name: image)" });
    }
    const exists = await pool.query("SELECT image_url FROM product WHERE id = $1", [id]);
    if (!exists.rowCount) {
      fs.unlink(path.join(productImagesDir, req.file.filename), () => {});
      return res.status(404).json({ error: "Product not found" });
    }
    const prevUrl = exists.rows[0].image_url;
    const publicPath = `${PUBLIC_PRODUCT_IMAGE_PREFIX}${req.file.filename}`;
    await pool.query("UPDATE product SET image_url = $1 WHERE id = $2", [publicPath, id]);
    tryUnlinkLocalProductImage(prevUrl);
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
    res.json(detail.rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.delete("/:id/image", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const prev = await pool.query("SELECT image_url FROM product WHERE id = $1", [id]);
    if (!prev.rowCount) return res.status(404).json({ error: "Product not found" });
    const prevUrl = prev.rows[0].image_url;
    await pool.query("UPDATE product SET image_url = NULL WHERE id = $1", [id]);
    tryUnlinkLocalProductImage(prevUrl);
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
    res.json(detail.rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

function parseOptionalNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? n : null;
}

function normalizeImageUrlInput(raw) {
  if (raw === undefined || raw === null) return null;
  const t = String(raw).trim();
  return t === "" ? null : t;
}

router.post("/", async (req, res) => {
  try {
    const code = req.body?.code;
    const name = req.body?.name;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description);
    const barcode =
      req.body?.barcode === undefined || req.body?.barcode === null
        ? null
        : String(req.body.barcode);
    const unitOfMeasure =
      req.body?.unit_of_measure === undefined || req.body?.unit_of_measure === null
        ? null
        : String(req.body.unit_of_measure);
    const categoryId = parseOptionalInt(req.body?.category_id);
    const unitCost = parseOptionalNumber(req.body?.unit_cost);
    const unitPrice = parseOptionalNumber(req.body?.unit_price);
    let vatId = parseOptionalInt(req.body?.vat_id);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    const reorderLevel = parseOptionalInt(req.body?.reorder_level);
    const imageUrl = normalizeImageUrlInput(req.body?.image_url);

    if (categoryId !== null) {
      const chk = await pool.query("SELECT 1 FROM category WHERE id = $1", [
        categoryId,
      ]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid category_id" });
      }
    }
    if (vatId === null) {
      const defaultVat = await pool.query(
        "SELECT id FROM vat WHERE is_default = true ORDER BY id LIMIT 1"
      );
      vatId = defaultVat.rowCount ? defaultVat.rows[0].id : null;
    }
    if (vatId !== null) {
      const chk = await pool.query("SELECT 1 FROM vat WHERE id = $1", [vatId]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid vat_id" });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO product (
        code, name, description, barcode, unit_of_measure, category_id,
        unit_cost, unit_price, vat_id, is_active, reorder_level, image_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id`,
      [
        String(code).trim(),
        String(name).trim(),
        description,
        barcode,
        unitOfMeasure,
        categoryId,
        unitCost,
        unitPrice,
        vatId,
        isActive,
        reorderLevel,
        imageUrl,
      ]
    );
    const newId = rows[0].id;
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [newId]);
    res.status(201).json(detail.rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const code = req.body?.code;
    const name = req.body?.name;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description);
    const barcode =
      req.body?.barcode === undefined || req.body?.barcode === null
        ? null
        : String(req.body.barcode);
    const unitOfMeasure =
      req.body?.unit_of_measure === undefined || req.body?.unit_of_measure === null
        ? null
        : String(req.body.unit_of_measure);
    const categoryId = parseOptionalInt(req.body?.category_id);
    const unitCost = parseOptionalNumber(req.body?.unit_cost);
    const unitPrice = parseOptionalNumber(req.body?.unit_price);
    const vatId = parseOptionalInt(req.body?.vat_id);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    const reorderLevel = parseOptionalInt(req.body?.reorder_level);

    const prevImg = await pool.query("SELECT image_url FROM product WHERE id = $1", [id]);
    if (!prevImg.rowCount) {
      return res.status(404).json({ error: "Product not found" });
    }
    const prevUrl = prevImg.rows[0].image_url;
    const imageUrl = Object.prototype.hasOwnProperty.call(req.body, "image_url")
      ? normalizeImageUrlInput(req.body.image_url)
      : prevUrl;

    if (categoryId !== null) {
      const chk = await pool.query("SELECT 1 FROM category WHERE id = $1", [
        categoryId,
      ]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid category_id" });
      }
    }
    if (vatId !== null) {
      const chk = await pool.query("SELECT 1 FROM vat WHERE id = $1", [vatId]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid vat_id" });
      }
    }

    const { rows } = await pool.query(
      `UPDATE product SET
        code = $1, name = $2, description = $3, barcode = $4, unit_of_measure = $5,
        category_id = $6, unit_cost = $7, unit_price = $8, vat_id = $9,
        is_active = $10, reorder_level = $11, image_url = $12
      WHERE id = $13
      RETURNING id`,
      [
        String(code).trim(),
        String(name).trim(),
        description,
        barcode,
        unitOfMeasure,
        categoryId,
        unitCost,
        unitPrice,
        vatId,
        isActive,
        reorderLevel,
        imageUrl,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    if (imageUrl !== prevUrl) {
      tryUnlinkLocalProductImage(prevUrl);
    }
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
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
    const prev = await pool.query("SELECT image_url FROM product WHERE id = $1", [id]);
    if (!prev.rowCount) return res.status(404).json({ error: "Product not found" });
    const prevUrl = prev.rows[0].image_url;
    const { rowCount } = await pool.query("DELETE FROM product WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Product not found" });
    tryUnlinkLocalProductImage(prevUrl);
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
