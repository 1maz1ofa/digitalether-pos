const express = require("express");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Server is running 🚀" });
});

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});