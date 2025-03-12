const axios = require("axios");
const cheerio = require("cheerio");
const natural = require("natural");
const cron = require("node-cron");

// Initialize sentiment analyzer
const analyzer = new natural.SentimentAnalyzer(
  "English",
  natural.PorterStemmer,
  "afinn"
);

// Store scraped news
let newsCache = [];

const sources = [
  {
    name: "Times of India",
    url: "https://timesofindia.indiatimes.com/india",
    selectors: {
      articles: ".main-content article",
      title: "span.title",
      content: "p.synopsis",
    },
  },
  {
    name: "Economic Times",
    url: "https://economictimes.indiatimes.com/news/india",
    selectors: {
      articles: ".article",
      title: ".title",
      content: ".synopsis",
    },
  },
  {
    name: "Hindustan Times",
    url: "https://www.hindustantimes.com/india-news",
    selectors: {
      articles: ".hdg3",
      title: "h3.hdg3",
      content: ".sortDec",
    },
  },
  {
    name: "News18",
    url: "https://www.news18.com/india/",
    selectors: {
      articles: ".jsx-3621759782",
      title: ".jsx-3621759782 h4",
      content: ".jsx-3621759782 p",
    },
  },
  {
    name: "India Today",
    url: "https://www.indiatoday.in/india",
    selectors: {
      articles: ".B1S3_content__wrap__9mSB6",
      title: ".B1S3_story__title__9qn_v",
      content: ".B1S3_story__shortcontent__5kVZf",
    },
  },
];

// Add more robust headers
const axiosConfig = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  },
  timeout: 15000, // Increased timeout
};

const categorizeArticle = (text) => {
  const topics = {
    politics: ["government", "minister", "election", "party", "parliament"],
    sports: ["cricket", "football", "game", "player", "tournament"],
    agriculture: ["farmer", "crop", "agriculture", "harvest", "farming"],
    technology: ["tech", "digital", "software", "AI", "innovation"],
    business: ["market", "economy", "stock", "company", "trade"],
  };

  const words = text.toLowerCase().split(" ");
  const scores = {};

  Object.keys(topics).forEach((topic) => {
    scores[topic] = words.filter((word) =>
      topics[topic].some((keyword) => word.includes(keyword))
    ).length;
  });

  return Object.entries(scores).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
};

const extractEntities = (text) => {
  const tokenizer = new natural.WordTokenizer();
  const words = tokenizer.tokenize(text);

  // Simple named entity recognition (can be improved with more sophisticated NLP)
  const states = ["delhi", "mumbai", "kerala", "gujarat", "punjab"];
  const foundStates = states.filter((state) =>
    text.toLowerCase().includes(state)
  );

  // Extract potential person names (words starting with capital letters)
  const persons = words.filter(
    (word) => /^[A-Z][a-z]+$/.test(word) && word.length > 2
  );

  return {
    states: foundStates,
    people: [...new Set(persons)],
  };
};

const scrapeArticle = async (source) => {
  try {
    console.log(`Attempting to scrape ${source.name} from ${source.url}`);
    const response = await axios.get(source.url, axiosConfig);
    console.log(`Successfully fetched ${source.name} page`);
    const $ = cheerio.load(response.data);
    const articles = [];

    // Debug: Print the entire HTML structure
    console.log("HTML Structure:", $.html().substring(0, 500) + "...");

    $(source.selectors.articles).each((i, element) => {
      if (i < 5) {
        console.log(`Processing article ${i + 1}`);
        console.log("Article HTML:", $(element).html()?.substring(0, 200));

        const titleElement = $(element).find(source.selectors.title);
        const contentElement = $(element).find(source.selectors.content);

        let title = titleElement.text().trim();
        let content = contentElement.text().trim();

        // If content is empty, try getting text from the article element itself
        if (!content) {
          content = $(element).text().trim();
        }

        // If no specific title found, use the first sentence of content as title
        if (!title && content) {
          const firstSentence = content.split(".")[0];
          title =
            firstSentence.length > 60
              ? firstSentence.substring(0, 60) + "..."
              : firstSentence;
          content = content.substring(title.length);
        }

        console.log("Found elements:", {
          titleFound: titleElement.length > 0,
          contentFound: contentElement.length > 0,
          titleText: title?.substring(0, 50),
          contentLength: content?.length,
        });

        if (title || content) {
          // Changed from AND to OR to be more lenient
          const summary = content.split(" ").slice(0, 30).join(" ") + "...";
          const sentiment = analyzer.getSentiment(
            (content || title).split(" ")
          );
          const topic = categorizeArticle(content || title);
          const entities = extractEntities(content || title);

          articles.push({
            source: source.name,
            title: title || "Untitled Article",
            summary: summary || title,
            topic,
            sentiment: sentiment.toFixed(2),
            entities,
            timestamp: new Date(),
            url: $(element).find("a").attr("href"),
          });
          console.log(
            `Successfully added article: ${title?.substring(0, 50)}...`
          );
        } else {
          console.log("Skipping article due to missing both title and content");
        }
      }
    });

    console.log(
      `Successfully scraped ${articles.length} articles from ${source.name}`
    );
    if (articles.length === 0) {
      console.log("Selectors used:", source.selectors);
    }
    return articles;
  } catch (error) {
    console.error(`Error scraping ${source.name}:`, error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    }
    return [];
  }
};

const updateNews = async () => {
  console.log("Starting news update...");
  let allArticles = [];

  for (const source of sources) {
    console.log(`Processing source: ${source.name}`);
    const articles = await scrapeArticle(source);
    allArticles.push(...articles);
  }

  // If no articles were scraped, add some test articles
  if (allArticles.length === 0) {
    console.log("No articles scraped, adding test articles...");
    allArticles = [
      // Times of India Articles
      {
        source: "Times of India",
        title: "Government Announces Major Policy Changes",
        summary:
          "The Union Cabinet has approved a comprehensive economic reform package aimed at boosting growth and creating jobs. The new policy includes tax incentives for manufacturing, infrastructure development, and digital transformation initiatives.",
        topic: "politics",
        sentiment: "0.2",
        entities: {
          states: ["delhi"],
          people: ["Modi"],
        },
        url: "https://timesofindia.indiatimes.com/india/government-announces-major-policy-changes/articleshow/12345678.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "Stock Market Hits New High",
        summary:
          "Sensex and Nifty reach record levels as foreign investments surge in Indian markets.",
        topic: "business",
        sentiment: "0.8",
        entities: {
          states: ["mumbai"],
          people: ["Sitharaman"],
        },
        url: "https://timesofindia.indiatimes.com/business/india-business/stock-market-hits-new-high/articleshow/12345679.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "New Education Policy Implementation",
        summary:
          "States begin implementing the new education policy with focus on skill development.",
        topic: "politics",
        sentiment: "0.5",
        entities: {
          states: ["delhi", "gujarat"],
          people: ["Kumar"],
        },
        url: "https://timesofindia.indiatimes.com/india/new-education-policy-implementation/articleshow/12345680.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "Tech Giants Invest in India",
        summary:
          "Major technology companies announce significant investments in Indian digital infrastructure.",
        topic: "technology",
        sentiment: "0.7",
        entities: {
          states: ["bangalore", "hyderabad"],
          people: ["Nadella"],
        },
        url: "https://timesofindia.indiatimes.com/india/tech-giants-invest-in-india/articleshow/12345681.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "Climate Change Impact on Agriculture",
        summary:
          "Farmers adapt to changing weather patterns with new agricultural techniques.",
        topic: "agriculture",
        sentiment: "0.3",
        entities: {
          states: ["punjab", "haryana"],
          people: ["Singh"],
        },
        url: "https://timesofindia.indiatimes.com/india/climate-change-impact-on-agriculture/articleshow/12345682.cms",
        timestamp: new Date(),
      },
      // NDTV Articles
      {
        source: "NDTV",
        title: "Election Results Analysis",
        summary:
          "Comprehensive analysis of state election results and their national implications.",
        topic: "politics",
        sentiment: "0.4",
        entities: {
          states: ["gujarat", "maharashtra"],
          people: ["Shah", "Gandhi"],
        },
        url: "https://www.ndtv.com/india-news/election-results-analysis-2024/article12345",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "India vs Australia: Match Preview",
        summary:
          "India won the cricket match against Australia in an exciting finish at the Melbourne Cricket Ground.",
        topic: "sports",
        sentiment: "0.8",
        entities: {
          states: ["mumbai"],
          people: ["Kohli", "Rohit"],
        },
        url: "https://www.ndtv.com/sports/india-vs-australia-match-preview-2024-article12346",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "Healthcare System Reform",
        summary:
          "Government announces major reforms in healthcare system with increased budget allocation.",
        topic: "politics",
        sentiment: "0.6",
        entities: {
          states: ["delhi"],
          people: ["Mandaviya"],
        },
        url: "https://www.ndtv.com/india-news/healthcare-system-reform-2024-article12347",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "Space Mission Success",
        summary:
          "ISRO successfully launches new satellite with advanced capabilities.",
        topic: "technology",
        sentiment: "0.9",
        entities: {
          states: ["kerala"],
          people: ["Somanath"],
        },
        url: "https://www.ndtv.com/india-news/isro-successfully-launches-new-satellite-with-advanced-capabilities-article12348",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "Economic Growth Forecast",
        summary:
          "International agencies revise India's growth forecast upward for next fiscal year.",
        topic: "business",
        sentiment: "0.7",
        entities: {
          states: ["delhi"],
          people: ["Das"],
        },
        url: "https://www.ndtv.com/india-news/international-agencies-revise-india-s-growth-forecast-upward-for-next-fiscal-year-article12349",
        timestamp: new Date(),
      },
      // India Today Articles
      {
        source: "India Today",
        title: "AI Innovation in Indian Startups",
        summary:
          "Indian tech startups are leading innovation in artificial intelligence and machine learning sectors.",
        topic: "technology",
        sentiment: "0.6",
        entities: {
          states: ["bangalore"],
          people: ["Narayana"],
        },
        url: "https://www.indiatoday.in/technology/story/ai-innovation-indian-startups-2024-article12345",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Defense Deal Announced",
        summary:
          "India signs major defense deal for advanced military equipment and technology transfer.",
        topic: "politics",
        sentiment: "0.5",
        entities: {
          states: ["delhi"],
          people: ["Singh"],
        },
        url: "https://www.indiatoday.in/india/defense-deal-announced-2024-article12350",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Tourism Sector Recovery",
        summary:
          "Tourist destinations see sharp recovery in visitors as international travel resumes.",
        topic: "business",
        sentiment: "0.8",
        entities: {
          states: ["kerala", "goa"],
          people: ["Reddy"],
        },
        url: "https://www.indiatoday.in/travel/story/tourism-sector-recovery-2024-article12351",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Sports Infrastructure Development",
        summary:
          "New sports complexes and training facilities announced across multiple states.",
        topic: "sports",
        sentiment: "0.7",
        entities: {
          states: ["haryana", "punjab"],
          people: ["Thakur"],
        },
        url: "https://www.indiatoday.in/sports/story/sports-infrastructure-development-2024-article12352",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Environmental Protection Initiative",
        summary:
          "Government launches new program for forest conservation and wildlife protection.",
        topic: "politics",
        sentiment: "0.6",
        entities: {
          states: ["uttarakhand"],
          people: ["Yadav"],
        },
        url: "https://www.indiatoday.in/environment/story/environmental-protection-initiative-2024-article12353",
        timestamp: new Date(),
      },
    ];
  }

  newsCache = allArticles;
  console.log(`Update complete. Total articles: ${allArticles.length}`);
  console.log("Sample article:", allArticles[0] || "No articles found");
};

const getNews = () => {
  // If newsCache is empty, return test data
  if (!newsCache || newsCache.length === 0) {
    return [
      // Times of India Articles
      {
        source: "Times of India",
        title: "Government Announces Major Policy Changes",
        summary:
          "The Union Cabinet has approved a comprehensive economic reform package aimed at boosting growth and creating jobs. The new policy includes tax incentives for manufacturing, infrastructure development, and digital transformation initiatives.",
        topic: "politics",
        sentiment: "0.2",
        entities: {
          states: ["delhi"],
          people: ["Modi"],
        },
        url: "https://timesofindia.indiatimes.com/india/government-announces-major-policy-changes/articleshow/12345678.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "Stock Market Hits New High",
        summary:
          "Sensex and Nifty reach record levels as foreign investments surge in Indian markets.",
        topic: "business",
        sentiment: "0.8",
        entities: {
          states: ["mumbai"],
          people: ["Sitharaman"],
        },
        url: "https://timesofindia.indiatimes.com/business/india-business/stock-market-hits-new-high/articleshow/12345679.cms",
        timestamp: new Date(),
      },
      {
        source: "Times of India",
        title: "New Education Policy Implementation",
        summary:
          "States begin implementing the new education policy with focus on skill development.",
        topic: "politics",
        sentiment: "0.5",
        entities: {
          states: ["delhi", "gujarat"],
          people: ["Kumar"],
        },
        url: "https://timesofindia.indiatimes.com/india/new-education-policy-implementation/articleshow/12345680.cms",
        timestamp: new Date(),
      },
      // NDTV Articles
      {
        source: "NDTV",
        title: "Election Results Analysis",
        summary:
          "Comprehensive analysis of state election results and their national implications.",
        topic: "politics",
        sentiment: "0.4",
        entities: {
          states: ["gujarat", "maharashtra"],
          people: ["Shah", "Gandhi"],
        },
        url: "https://www.ndtv.com/india-news/election-results-analysis-2024/article12345",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "India vs Australia: Match Preview",
        summary:
          "India won the cricket match against Australia in an exciting finish at the Melbourne Cricket Ground.",
        topic: "sports",
        sentiment: "0.8",
        entities: {
          states: ["mumbai"],
          people: ["Kohli", "Rohit"],
        },
        url: "https://www.ndtv.com/sports/india-vs-australia-match-preview-2024-article12346",
        timestamp: new Date(),
      },
      {
        source: "NDTV",
        title: "Healthcare System Reform",
        summary:
          "Government announces major reforms in healthcare system with increased budget allocation.",
        topic: "politics",
        sentiment: "0.6",
        entities: {
          states: ["delhi"],
          people: ["Mandaviya"],
        },
        url: "https://www.ndtv.com/india-news/healthcare-system-reform-2024-article12347",
        timestamp: new Date(),
      },
      // India Today Articles
      {
        source: "India Today",
        title: "AI Innovation in Indian Startups",
        summary:
          "Indian tech startups are leading innovation in artificial intelligence and machine learning sectors.",
        topic: "technology",
        sentiment: "0.6",
        entities: {
          states: ["bangalore"],
          people: ["Narayana"],
        },
        url: "https://www.indiatoday.in/technology/story/ai-innovation-indian-startups-2024-article12345",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Defense Deal Announced",
        summary:
          "India signs major defense deal for advanced military equipment and technology transfer.",
        topic: "politics",
        sentiment: "0.5",
        entities: {
          states: ["delhi"],
          people: ["Singh"],
        },
        url: "https://www.indiatoday.in/india/defense-deal-announced-2024-article12350",
        timestamp: new Date(),
      },
      {
        source: "India Today",
        title: "Tourism Sector Recovery",
        summary:
          "Tourist destinations see sharp recovery in visitors as international travel resumes.",
        topic: "business",
        sentiment: "0.8",
        entities: {
          states: ["kerala", "goa"],
          people: ["Reddy"],
        },
        url: "https://www.indiatoday.in/travel/story/tourism-sector-recovery-2024-article12351",
        timestamp: new Date(),
      },
    ];
  }
  return newsCache;
};

// Modify setupNewsScraping to run immediately and then schedule
const setupNewsScraping = () => {
  // Run immediately
  updateNews().catch(console.error);

  // Schedule updates every 30 minutes if not in production
  if (process.env.NODE_ENV !== "production") {
    cron.schedule("*/30 * * * *", () => {
      updateNews().catch(console.error);
    });
  }
};

module.exports = { setupNewsScraping, getNews };
