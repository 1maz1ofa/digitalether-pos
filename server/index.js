const express = require("express");
const cors = require("cors");
const pool = require("./db");
const categoriesRouter = require("./routes/categories");
const locationsRouter = require("./routes/locations");
const productsRouter = require("./routes/products");
const customersRouter = require("./routes/customers");
const posRouter = require("./routes/pos");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

app.use("/api/categories", categoriesRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/products", productsRouter);
app.use("/api/customers", customersRouter);
app.use("/api/pos", posRouter);

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

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});