const fs = require("fs");
const Parser = require("rss-parser");
const parser = new Parser();

const FEED_URL =
  "https://www.romeoville.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml"; // All calendars
const MAX_EVENTS = 32;

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

(async () => {
  try {
    const feed = await parser.parseURL(FEED_URL);

    const now = new Date();
    const events = [];

    for (const item of feed.items) {
      const title = item.title || "Untitled Event";
      const link = item.link || "";
      const summary = item.contentSnippet || item.content || "";

      const dateMatch = summary.match(/Event date[s]?:\s*([^\n<]+)/i);
      const timeMatch = summary.match(/Event time[s]?:\s*([^\n<]+)/i);
      const locMatch = summary.match(/Location:\s*([^\n<]+)/i);

      const dateStr = dateMatch ? dateMatch[1].trim() : null;
      const time = timeMatch ? timeMatch[1].trim() : null;
      const location = locMatch ? locMatch[1].trim() : "TBA";

      // Build a rough start date from dateStr
      let start = parseDate(dateStr);
      if (!start && dateStr) {
        // try without commas
        start = parseDate(dateStr.replace(",", ""));
      }

      // Skip past events
      if (start && start < now.setHours(0,0,0,0)) continue;

      events.push({ title, date: dateStr, time, location, link });
    }

    // Limit to max
    const upcoming = events.slice(0, MAX_EVENTS);

    fs.writeFileSync("events.json", JSON.stringify(upcoming, null, 2));
    console.log(`✅ Wrote ${upcoming.length} upcoming events to events.json`);
  } catch (err) {
    console.error("❌ Failed to fetch events:", err);
    process.exit(1);
  }
})();
