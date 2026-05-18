const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const pool = require("./db");

const serveClient =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.WEBSITE_SITE_NAME);
const clientBuild = path.join(__dirname, "..", "client", "build");

// Routes
const categoriesRouter = require("./routes/categories");
const locationsRouter = require("./routes/locations");
const productsRouter = require("./routes/products");
const customersRouter = require("./routes/customers");
const usersRouter = require("./routes/users");
const rolesRouter = require("./routes/roles");
const rightsRouter = require("./routes/rights");
const userRolesRouter = require("./routes/userRoles");
const posRouter = require("./routes/pos");
const d365Router = require("./routes/d365");
const currenciesRouter = require("./routes/currencies");
const vatRouter = require("./routes/vat");
const terminalsRouter = require("./routes/terminals");
const invoicesRouter = require("./routes/invoices");
const inventoryRouter = require("./routes/inventory");
const inventoryPromisesRouter = require("./routes/inventoryPromises");
const reserveIssueRouter = require("./routes/reserveIssue");
const stocktakeRouter = require("./routes/stocktake");
const authRouter = require("./routes/auth");
const { requireAuth, isPublicApiRequest } = require("./middleware/requireAuth");

const app = express();

const uploadsRoot = path.join(__dirname, "uploads");
fs.mkdirSync(path.join(uploadsRoot, "products"), { recursive: true });

const corsOrigins = ["http://localhost:3000", process.env.FRONTEND_URL].filter(
  Boolean
);
if (process.env.WEBSITE_HOSTNAME) {
  corsOrigins.push(`https://${process.env.WEBSITE_HOSTNAME}`);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  })
);

app.use(express.json());
app.use("/uploads", express.static(uploadsRoot));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

if (!serveClient) {
  app.get("/", (req, res) => {
    res.json({ message: "Server is running 🚀" });
  });
}

app.use("/api/auth", authRouter);

app.use("/api", (req, res, next) => {
  if (isPublicApiRequest(req)) return next();
  requireAuth(req, res, next);
});

// ✅ API routes
app.use("/api/categories", categoriesRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/products", productsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/rights", rightsRouter);
app.use("/api/user-roles", userRolesRouter);
app.use("/api/pos", posRouter);
app.use("/api/d365", d365Router);
app.use("/api/currencies", currenciesRouter);
app.use("/api/vat", vatRouter);
app.use("/api/terminals", terminalsRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/inventory/promises", inventoryPromisesRouter);
app.use("/api/inventory/reserve-issues", reserveIssueRouter);
app.use("/api/stocktakes", stocktakeRouter);
app.use("/api/inventory", inventoryRouter);

// ✅ Database test route
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      message: "Database connected ✅",
      time: result.rows[0]
    });
  } catch (error) {
    console.error("DB Error:", error);
    res.status(500).json({
      message: "Database connection failed ❌",
      error: error.message
    });
  }
});

if (serveClient && fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path === "/test-db") return next();
    res.sendFile(path.join(clientBuild, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

// ✅ IMPORTANT: Azure uses dynamic port
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});