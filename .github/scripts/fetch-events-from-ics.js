/**
 * Merge events from one or more ICS (iCalendar) feeds into events.json.
 * - Strips HTML tags (<p>, <br>, etc.) from text fields
 * - Filters out past events (anything that fully ended before start of today)
 * - Sorts ascending by start
 * - Caps total to MAX_EVENTS
 * - Outputs: [{ title, start, end, location }]
 *
 * Usage:
 *   node .github/scripts/fetch-events-from-ics.js <ICS_URL_1> <ICS_URL_2> ...
 *
 * Dependencies:
 *   npm install node-ical
 */

const fs = require("fs");
const ical = require("node-ical");

const MAX_EVENTS = 20;             // adjust if you want more/less in events.json
const OUTPUT_FILE = "events.json";

/* ---------- Helpers ---------- */

function stripTags(str) {
  if (!str) return "";
  return String(str).replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Convert a VEVENT into a normalized object we can use.
 * Ensures we always return {title, start, end, location}.
 */
function normalizeVEvent(item) {
  const title = stripTags(item.summary) || "Untitled Event";
  const start = item.start instanceof Date ? item.start : null;
  const end = item.end instanceof Date ? item.end : null;
  const location = stripTags(item.location) || "TBA";
  return { title, start, end, location };
}

async function parseIcs(url) {
  const data = await ical.async.fromURL(url);
  const events = [];
  for (const key of Object.keys(data)) {
    const item = data[key];
    if (!item || item.type !== "VEVENT") continue;
    const ev = normalizeVEvent(item);
    if (!ev.start) continue; // skip undated items
    events.push(ev);
  }
  return events;
}

/* ---------- Main ---------- */

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

    // Optional: de-duplicate by (title + start ISO)
    const seen = new Set();
    merged = merged.filter(e => {
      const key = `${e.title}|${e.start?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter: keep anything that hasn't fully ended yet (>= start of today)
    const todayMs = startOfToday().getTime();
    merged = merged.filter(e => {
      const endMs = e.end ? e.end.getTime() : (e.start.getTime() + 2 * 60 * 60 * 1000);
      return endMs >= todayMs;
    });

    // Sort ascending by start
    merged.sort((a, b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));

    // Cap total
    merged = merged.slice(0, MAX_EVENTS);

    // Serialize with ISO strings (frontend formats these nicely)
    const out = merged.map(e => ({
      title: stripTags(e.title),
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null,
      location: stripTags(e.location)
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
    console.log(`✅ Wrote ${out.length} events to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Failed to build events.json:", err);
    process.exit(1);
  }
})();
