const fs = require("fs");
const Parser = require("rss-parser");
const parser = new Parser();

const FEED_URL =
  "https://www.romeoville.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml"; // All calendars RSS
const MAX_EVENTS = 32;

(async () => {
  try {
    const feed = await parser.parseURL(FEED_URL);

    const events = [];

    for (const item of feed.items) {
      // Extract fields
      const title = item.title || "Untitled Event";
      const link = item.link || "";
      const summary = item.contentSnippet || item.content || "";

      // Parse out "Event date:", "Event time:", "Location:"
      let dateMatch = summary.match(/Event date[s]?:\s*([^\n<]+)/i);
      let timeMatch = summary.match(/Event time[s]?:\s*([^\n<]+)/i);
      let locMatch = summary.match(/Location:\s*([^\n<]+)/i);

      const date = dateMatch ? dateMatch[1].trim() : null;
      const time = timeMatch ? timeMatch[1].trim() : null;
      const location = locMatch ? locMatch[1].trim() : "TBA";

      events.push({
        title,
        date,
        time,
        location,
        link
      });
    }

    // Keep only MAX_EVENTS
    const upcoming = events.slice(0, MAX_EVENTS);

    // Write to events.json
    fs.writeFileSync("events.json", JSON.stringify(upcoming, null, 2));
    console.log(`✅ Wrote ${upcoming.length} events to events.json`);
  } catch (err) {
    console.error("❌ Failed to fetch events:", err);
    process.exit(1);
  }
})();
