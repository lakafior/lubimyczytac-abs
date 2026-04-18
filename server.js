const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const stringSimilarity = require("string-similarity");
const NodeCache = require("node-cache");

const app = express();
const port = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 600 }); // Cache for 10 minutes

app.use(cors());

// Middleware to check for AUTHORIZATION header
app.use((req, res, next) => {
  const apiKey = req.headers["authorization"];
  if (!apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// A workaround for error 429 (throttling)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    if (response?.status === 429) {
      config._retryCount = (config._retryCount || 0) + 1;

      if (config._retryCount <= 5) {
        const delayMs = 10000 + Math.floor(Math.random() * 10000);
        console.log(
          `[429] Retry ${config._retryCount}/5 after ${Math.round(delayMs / 1000)}s`,
        );
        await sleep(delayMs);
        return axios.request(config);
      }

      console.error(`[429] Max retries exceeded for ${config.url}`);
    }

    throw error;
  },
);
// The 429 worakround ends here

class LubimyCzytacProvider {
  constructor() {
    this.id = "lubimyczytac";
    this.name = "Lubimy Czytać";
    this.baseUrl = "https://lubimyczytac.pl";
    this.textDecoder = new TextDecoder("utf-8");
  }

  decodeText(text) {
    return this.textDecoder.decode(new TextEncoder().encode(text));
  }

  async searchBooks(query, author = "") {
    const cacheKey = `${query}-${author}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const currentTime = new Date().toLocaleString("pl-PL", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      console.log(`Current time: ${currentTime}`);
      console.log(`Input details: "${query}" by "${author}"`);

      if (!author && query.includes("-")) {
        author = query.split("-")[0].replace(/\./g, " ").trim();
      } else {
        author = author.split("-")[0].replace(/\./g, " ").trim();
      }

      console.log("Extracted author: ", author);

      let cleanedTitle = query;
      if (!/^".*"$/.test(cleanedTitle)) {
        cleanedTitle = cleanedTitle
          .replace(/(\d+kbps)/g, "")
          .replace(/\bVBR\b.*$/gi, "")
          .replace(/^[\w\s.-]+-\s*/g, "")
          .replace(/czyt.*/gi, "")
          .replace(/.*-/, "")
          .replace(/.*?(T[\s.]?\d{1,3}).*?(.*)$/i, "$2")
          .replace(/.*?(Tom[\s.]?\d{1,3}).*?(.*)$/i, "$2")
          .replace(/.*?\(\d{1,3}\)\s*/g, "")
          .replace(/\(.*?\)/g, "")
          .replace(/\[.*?\]/g, "")
          .replace(/\(/g, " ")
          .replace(/[^\p{L}\d]/gu, " ")
          .replace(/\./g, " ")
          .replace(/\s+/g, " ")
          .replace(/superprodukcja/i, "")
          .trim();
      } else {
        cleanedTitle = cleanedTitle.replace(/^"(.*)"$/, "$1");
      }

      console.log("Extracted title: ", cleanedTitle);

      let booksSearchUrl = `${this.baseUrl}/szukaj/ksiazki?phrase=${encodeURIComponent(cleanedTitle)}`;
      let audiobooksSearchUrl = `${this.baseUrl}/szukaj/audiobooki?phrase=${encodeURIComponent(cleanedTitle)}`;
      if (author) {
        booksSearchUrl += `&author=${encodeURIComponent(author)}`;
        audiobooksSearchUrl += `&author=${encodeURIComponent(author)}`;
      }

      console.log("Books Search URL:", booksSearchUrl);
      console.log("Audiobooks Search URL:", audiobooksSearchUrl);

      const booksResponse = await axios.get(booksSearchUrl, {
        responseType: "arraybuffer",
      });
      const audiobooksResponse = await axios.get(audiobooksSearchUrl, {
        responseType: "arraybuffer",
      });

      const booksMatches = this.parseSearchResults(booksResponse.data, "book");
      const audiobooksMatches = this.parseSearchResults(
        audiobooksResponse.data,
        "audiobook",
      );

      let allMatches = [...booksMatches, ...audiobooksMatches];

      // Calculate similarity scores and sort the matches
      allMatches = allMatches
        .map((match) => {
          const titleSimilarity = stringSimilarity.compareTwoStrings(
            match.title.toLowerCase(),
            cleanedTitle.toLowerCase(),
          );

          let combinedSimilarity;
          if (author) {
            const authorSimilarity = Math.max(
              ...match.authors.map((a) =>
                stringSimilarity.compareTwoStrings(
                  a.toLowerCase(),
                  author.toLowerCase(),
                ),
              ),
            );
            // Combine title and author similarity scores if author is provided
            combinedSimilarity = titleSimilarity * 0.6 + authorSimilarity * 0.4;
          } else {
            // Use only title similarity if no author is provided
            combinedSimilarity = titleSimilarity;
          }

          return { ...match, similarity: combinedSimilarity };
        })
        .sort((a, b) => {
          // Primary sort: by similarity (descending)
          if (b.similarity !== a.similarity) {
            return b.similarity - a.similarity;
          }

          // Secondary sort: prioritize audiobooks if similarity is equal
          const typeValueA = a.type === "audiobook" ? 1 : 0;
          const typeValueB = b.type === "audiobook" ? 1 : 0;
          return typeValueB - typeValueA;
        })
        .slice(0, 20); // Max 20 matches

      const fullMetadata = await Promise.all(
        allMatches.map((match) => this.getFullMetadata(match)),
      );

      const adjustedMetadata = fullMetadata
        .map((match) => {
          let adjustedSimilarity = match.similarity;

          // Penalty for missing ISBN
          if (!match.identifiers?.isbn || match.identifiers.isbn === "") {
            const originalSimilarity = adjustedSimilarity;
            adjustedSimilarity *= 0.99;
          }

          return { ...match, similarity: adjustedSimilarity };
        })
        .sort((a, b) => {
          // Primary sort: by similarity (descending)
          if (b.similarity !== a.similarity) {
            return b.similarity - a.similarity;
          }
          // Secondary sort: prioritize audiobooks if similarity is equal
          const typeValueA = a.type === "audiobook" ? 1 : 0;
          const typeValueB = b.type === "audiobook" ? 1 : 0;
          return typeValueB - typeValueA;
        });

      const result = { matches: adjustedMetadata };
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Error searching books:", error.message, error.stack);
      return { matches: [] };
    }
  }

  // ADDED THIS FUNCTION BACK:
  parseSearchResults(responseData, type) {
    const decodedData = this.decodeText(responseData);
    const $ = cheerio.load(decodedData);
    const matches = [];

    $(".authorAllBooks__single").each((index, element) => {
      const $book = $(element);
      const $bookInfo = $book.find(".authorAllBooks__singleText");

      const title = $bookInfo
        .find(".authorAllBooks__singleTextTitle")
        .text()
        .trim();
      const bookUrl = $bookInfo
        .find(".authorAllBooks__singleTextTitle")
        .attr("href");
      const authors = $bookInfo
        .find('a[href*="/autor/"]')
        .map((i, el) => $(el).text().trim())
        .get();

      if (title && bookUrl) {
        matches.push({
          id: bookUrl.split("/").pop(),
          title: this.decodeUnicode(title),
          authors: authors.map((author) => this.decodeUnicode(author)),
          url: `${this.baseUrl}${bookUrl}`,
          type: type,
          source: {
            id: this.id,
            description: this.name,
            link: this.baseUrl,
          },
        });
      }
    });

    return matches;
  }

  async getFullMetadata(match) {
    try {
      const response = await axios.get(match.url, {
        responseType: "arraybuffer",
      });
      const decodedData = this.decodeText(response.data);
      const $ = cheerio.load(decodedData);

      const cover =
        $(".book-cover a").attr("data-cover") ||
        $(".book-cover source").attr("srcset") ||
        $(".book-cover img").attr("src") ||
        $('meta[property="og:image"]').attr("content") ||
        "";
      const publisher =
        $('dt:contains("Wydawnictwo:")').next("dd").find("a").text().trim() ||
        "";
      const languages =
        $('dt:contains("Język:")').next("dd").text().trim().split(", ") || [];
      const description =
        $("#book-description").html() ||
        $('meta[property="og:description"]').attr("content") ||
        "";
      const seriesElement = $('span.d-none.d-sm-block.mt-1:contains("Cykl:")')
        .find("a")
        .text()
        .trim();
      const series = this.extractSeriesName(seriesElement);
      const seriesIndex = this.extractSeriesIndex(seriesElement);
      const genres = this.extractGenres($);
      const tags = this.extractTags($);
      const rating =
        parseFloat($('meta[property="books:rating:value"]').attr("content")) /
          2 || null;
      const isbn = $('meta[property="books:isbn"]').attr("content") || "";

      let publishedDate, pages;
      try {
        publishedDate = this.extractPublishedDate($);
        pages = this.extractPages($);
      } catch (error) {
        console.error(
          "Error extracting published date or pages:",
          error.message,
        );
      }

      const translator = this.extractTranslator($);

      const fullMetadata = {
        ...match,
        cover,
        description: this.enrichDescription(
          description,
          pages,
          publishedDate,
          translator,
        ),
        languages: languages.map((lang) => this.getLanguageName(lang)),
        publisher,
        publishedDate,
        rating,
        series,
        seriesIndex,
        genres,
        tags,
        identifiers: {
          isbn,
          lubimyczytac: match.id,
        },
      };

      return fullMetadata;
    } catch (error) {
      console.error(
        `Error fetching full metadata for ${match.title}:`,
        error.message,
        error.stack,
      );
      return match;
    }
  }

  extractSeriesName(seriesElement) {
    if (!seriesElement) return null;
    return seriesElement.replace(/\s*\(tom \d+.*?\)\s*$/, "").trim();
  }

  extractSeriesIndex(seriesElement) {
    if (!seriesElement) return null;
    const match = seriesElement.match(/\(tom (\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  extractPublishedDate($) {
    const dateText = $('dt[title*="Data pierwszego wydania"]')
      .next("dd")
      .text()
      .trim();
    return dateText ? new Date(dateText) : null;
  }

  extractPages($) {
    try {
      // There might be multiple script tags with application/ld+json
      const scripts = $('script[type="application/ld+json"]');

      for (let i = 0; i < scripts.length; i++) {
        const scriptText = $(scripts[i]).html() || "";
        if (!scriptText.trim()) continue;

        try {
          // Try to extract just the JSON part if there's extra content
          let jsonText = scriptText.trim();

          // Find the first { or [ and try to parse from there
          const jsonStart = Math.min(
            jsonText.indexOf("{") >= 0 ? jsonText.indexOf("{") : Infinity,
            jsonText.indexOf("[") >= 0 ? jsonText.indexOf("[") : Infinity,
          );

          if (jsonStart !== Infinity && jsonStart > 0) {
            jsonText = jsonText.substring(jsonStart);
          }

          // Try to find where valid JSON ends by parsing progressively
          let data = null;
          let lastValidJson = jsonText;

          // First, try parsing the whole thing
          try {
            data = JSON.parse(jsonText);
          } catch (e) {
            // If that fails, try to find the end of valid JSON
            // by removing characters from the end until it parses
            for (let len = jsonText.length - 1; len > 0; len--) {
              try {
                const substring = jsonText.substring(0, len);
                // Check if we have balanced braces/brackets
                const openBraces = (substring.match(/{/g) || []).length;
                const closeBraces = (substring.match(/}/g) || []).length;
                const openBrackets = (substring.match(/\[/g) || []).length;
                const closeBrackets = (substring.match(/\]/g) || []).length;

                if (
                  openBraces === closeBraces &&
                  openBrackets === closeBrackets
                ) {
                  data = JSON.parse(substring.trim());
                  break;
                }
              } catch (innerError) {
                // Continue trying shorter strings
                continue;
              }
            }
          }

          if (data && data.numberOfPages) {
            return data.numberOfPages;
          }
        } catch (innerError) {
          // Try next script tag
          continue;
        }
      }
    } catch (error) {
      console.error("Error parsing JSON for pages:", error.message);
    }
    return null;
  }

  extractTranslator($) {
    return (
      $('dt:contains("Tłumacz:")').next("dd").find("a").text().trim() || null
    );
  }

  extractGenres($) {
    const genreText = $(".book__category.d-sm-block.d-none").text().trim();
    return genreText ? genreText.split(",").map((genre) => genre.trim()) : [];
  }

  extractTags($) {
    return (
      $('a[href*="/ksiazki/t/"]')
        .map((i, el) => $(el).text().trim())
        .get() || []
    );
  }

  stripHtmlTags(html) {
    // Remove HTML tags
    let text = html.replace(/<[^>]*>/g, "");
    // Fix missing spaces after periods followed by capital letters
    text = text.replace(/\.([A-ZĄĆĘŁŃÓŚŹŻ])/g, ". $1");
    return text;
  }

  enrichDescription(description, pages, publishedDate, translator) {
    let enrichedDescription = this.stripHtmlTags(description);

    if (enrichedDescription === "Ta książka nie posiada jeszcze opisu.") {
      enrichedDescription = "Brak opisu.";
    } else {
      if (pages) {
        enrichedDescription += `\n\nKsiążka ma ${pages} stron.`;
      }

      if (publishedDate) {
        enrichedDescription += `\n\nData pierwszego wydania: ${publishedDate.toLocaleDateString()}`;
      }

      if (translator) {
        enrichedDescription += `\n\nTłumacz: ${translator}`;
      }
    }

    return enrichedDescription;
  }

  getLanguageName(language) {
    const languageMap = {
      polski: "pol",
      angielski: "eng",
    };
    return languageMap[language.toLowerCase()] || language;
  }

  decodeUnicode(str) {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
  }
}

const provider = new LubimyCzytacProvider();

app.get("/search", async (req, res) => {
  try {
    console.log(
      `------------------------------------------------------------------------------------------------`,
    );
    console.log("Received search request:", req.query);
    const query = req.query.query;
    const author = req.query.author;

    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    const results = await provider.searchBooks(query, author);

    const formattedResults = {
      matches: results.matches.map((book) => {
        const year = book.publishedDate
          ? new Date(book.publishedDate).getFullYear()
          : null;
        const publishedYear = year ? year.toString() : undefined;

        return {
          title: book.title,
          subtitle: book.subtitle || undefined,
          author: book.authors.join(", "),
          narrator: book.narrator || undefined,
          publisher: book.publisher || undefined,
          publishedYear: publishedYear,
          description: book.description || undefined,
          cover: book.cover || undefined,
          isbn:
            book.identifiers?.isbn ||
            (book.similarity >= 0.95 ? "0" : undefined), // '0' indicates missing ISBN with high similarity
          asin: book.identifiers?.asin || undefined,
          genres: book.genres || undefined,
          tags: book.tags || undefined,
          series: book.series
            ? [
                {
                  series: book.series,
                  sequence: book.seriesIndex
                    ? book.seriesIndex.toString()
                    : undefined,
                },
              ]
            : undefined,
          language:
            book.languages && book.languages.length > 0
              ? book.languages[0]
              : undefined,
          duration: book.duration || undefined,
          type: book.type,
          similarity: book.similarity,
        };
      }),
    };

    console.log("Sending response:", JSON.stringify(formattedResults, null, 2));
    res.json(formattedResults);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`LubimyCzytac provider listening on port ${port}`);
});
