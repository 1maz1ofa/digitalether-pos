const express = require("express");
const cors = require("cors");
const pool = require("./db"); // ✅ import DB connection

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Base route
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

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