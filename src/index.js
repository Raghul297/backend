const express = require("express");
const cors = require("cors");
const { setupNewsScraping } = require("./services/scraper");
const newsRoutes = require("./routes/news");

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
app.use(cors()); // Allow all origins in production

app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to the News Aggregator API",
    endpoints: {
      health: "/health",
      allNews: "/api/news",
      newsByTopic: "/api/news/topic/:topic",
      newsBySource: "/api/news/source/:source",
    },
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// Routes
app.use("/api/news", newsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
  });
});

// Initialize news scraping
setupNewsScraping();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
