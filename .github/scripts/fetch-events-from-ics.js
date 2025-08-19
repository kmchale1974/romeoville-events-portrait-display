/**
 * Merge events from one or more ICS (iCalendar) feeds into events.json
 * Filters out past events, sorts ascending, caps total (20 by default).
 * Output schema matches your frontend's preferred format:
 *   { title, start, end, location }
 *
 * Usage:
 *   node fetch-events-from-ics.js <ICS_URL_1> <ICS_URL_2> ...
 */

const fs = require("fs");
const ical = require("node-ical");

const MAX_EVENTS = 20; // keep in sync with your frontend MAX_EVENTS if you like
const OUTPUT_FILE = "events.json";

// Simple helper: beginning of today
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function parseIcs(url) {
  const data = await ical.async.fromURL(url);
  const events = [];

  for (const key of Object.keys(data)) {
    const item = data[key];
    if (!item || item.type !== "VEVENT") continue;

    const title = item.summary || "Untitled Event";
    const start = item.start instanceof Date ? item.start : null;
    const end = item.end instanceof Date ? item.end : null;
    const location = item.location || "TBA";

    // Skip invalid / undated events
    if (!start) continue;

    events.push({ title, start, end, location });
  }

  return events;
}

(async () => {
  try {
    const urls = process.argv.slice(2);
    if (urls.length === 0) {
      console.error("Provide at least one ICS URL as an argument.");
      process.exit(1);
    }

    // Fetch & merge all feeds
    const results = await Promise.all(urls.map(parseIcs));
    let merged = results.flat();

    // Filter: keep anything that hasn't fully ended yet (>= start of today)
    const today = startOfToday().getTime();
    merged = merged.filter(e => {
      const end = e.end ? e.end.getTime() : (e.start.getTime() + 2*60*60*1000);
      return end >= today;
    });

    // Sort ascending by start
    merged.sort((a, b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));

    // Cap total
    merged = merged.slice(0, MAX_EVENTS);

    // Serialize with ISO strings (frontend formats these nicely)
    const out = merged.map(e => ({
      title: e.title,
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null,
      location: e.location || "TBA"
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
    console.log(`✅ Wrote ${out.length} events to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Failed to build events.json:", err);
    process.exit(1);
  }
})();
