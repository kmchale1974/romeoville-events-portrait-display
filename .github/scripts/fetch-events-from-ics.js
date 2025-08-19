/**
 * Merge events from ICS feeds into events.json.
 * - Strips HTML and ICS escapes
 * - Location is reduced to the venue name (text before the first comma)
 * - Filters out past events (fully ended before start of today)
 * - Sorts ascending by start; caps to MAX_EVENTS
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

const MAX_EVENTS = 20;             // keep in sync with your frontend cap if desired
const OUTPUT_FILE = "events.json";

/* ---------- Helpers ---------- */

function stripTags(str) {
  if (!str) return "";
  return String(str).replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Unescape common ICS sequences like "\n", "\,", "\;"
function unescapeICS(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean location:
 * 1) Strip HTML + unescape ICS
 * 2) If there is a comma, keep everything BEFORE the first comma (venue name)
 * 3) Else, strip trailing "City, ST 12345" if present
 */
function cleanLocation(loc) {
  if (!loc) return "TBA";
  let s = unescapeICS(stripTags(loc));

  // If there's a comma, assume "Venue, Street, City, ST ZIP" and keep only the venue
  const firstComma = s.indexOf(",");
  if (firstComma > -1) {
    const venue = s.slice(0, firstComma).trim();
    return venue || "TBA";
  }

  // Fallback: remove trailing "City, ST 12345" (or "City, ST" if ZIP missing)
  s = s.replace(/\s*,?\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i, "").trim();

  return s || "TBA";
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function normalizeVEvent(item) {
  const title = stripTags(unescapeICS(item.summary)) || "Untitled Event";
  const start = item.start instanceof Date ? item.start : null;
  const end = item.end instanceof Date ? item.end : null;
  const location = cleanLocation(item.location);
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

    // De-duplicate by (title + start ISO)
    const seen = new Set();
    merged = merged.filter(e => {
      const key = `${e.title}|${e.start?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Keep items that haven't fully ended yet (>= start of today)
    const todayMs = startOfToday().getTime();
    merged = merged.filter(e => {
      const endMs = e.end ? e.end.getTime() : (e.start.getTime() + 2 * 60 * 60 * 1000);
      return endMs >= todayMs;
    });

    // Sort ascending, cap
    merged.sort((a, b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));
    merged = merged.slice(0, MAX_EVENTS);

    // Serialize with ISO strings
    const out = merged.map(e => ({
      title: stripTags(e.title),
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null,
      location: cleanLocation(e.location)
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
    console.log(`✅ Wrote ${out.length} events to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Failed to build events.json:", err);
    process.exit(1);
  }
})();
