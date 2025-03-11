const express = require("express");
const router = express.Router();
const { getNews } = require("../services/scraper");

// Get all news articles
router.get("/", (req, res) => {
  const news = getNews();
  res.json(news);
});

// Get news by topic
router.get("/topic/:topic", (req, res) => {
  const news = getNews();
  const filteredNews = news.filter(
    (article) => article.topic.toLowerCase() === req.params.topic.toLowerCase()
  );
  res.json(filteredNews);
});

// Get news by source
router.get("/source/:source", (req, res) => {
  const news = getNews();
  const filteredNews = news.filter((article) =>
    article.source.toLowerCase().includes(req.params.source.toLowerCase())
  );
  res.json(filteredNews);
});

module.exports = router;
