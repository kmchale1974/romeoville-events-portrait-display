/**
 * Merge events from ICS feeds into events.json.
 * - Strips HTML and ICS escapes
 * - Cleans location to venue-only (before dash/comma; removes City/State/ZIP)
 * - Omits "location" field entirely if it would be "TBA"
 * - Filters out past events (ended before start of today)
 * - Sorts ascending, caps to MAX_EVENTS
 *
 * Ways to provide feeds (priority order):
 *   1) CLI args: node fetch-events-from-ics.js <url1> <url2> ...
 *   2) Env var:  ICS_URLS="url1,url2,..." node fetch-events-from-ics.js
 *   3) Hard-coded ICS_URLS array below
 *
 * Dependencies:
 *   npm install node-ical
 */

const fs = require("fs");
const ical = require("node-ical");

const MAX_EVENTS = 24;           // <= your new cap
const OUTPUT_FILE = "events.json";

/* ---------------- Supply your feeds here (used if no args/env) ----------------
 * Replace the URLs below with the exact "Subscribe to iCalendar" links for:
 *  - Important Village Dates
 *  - Special Events Calendar
 *  - Village Board of Trustees
 *  - Village Office Closings
 */
const ICS_URLS_FALLBACK = [
  // "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=XX&feed=calendar", // Important Village Dates
  // "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=YY&feed=calendar", // Special Events Calendar
  // "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=ZZ&feed=calendar", // Village Board of Trustees
  // "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=WW&feed=calendar", // Village Office Closings
];

/* --------------------------------- Helpers --------------------------------- */

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
 * Clean location aggressively:
 * 1) Strip HTML + unescape
 * 2) If contains " - " / en/em dash, keep only text BEFORE the dash (venue)
 * 3) Else if contains a comma, keep only text BEFORE first comma
 * 4) Remove trailing "City, ST ZIP" / "City ST ZIP" / ", Romeoville, IL 60446" patterns
 * 5) Normalize empties/leading dashes to "TBA"
 */
function cleanLocation(loc) {
  if (!loc) return "TBA";
  let s = unescapeICS(stripTags(loc)).trim();

  if (!s || /^-+\s*$/.test(s)) return "TBA";

  // Prefer dash split first: "Venue - 1050 W ..." => "Venue"
  const dashSplit = s.split(/\s[-–—]\s/, 2); // hyphen, en dash, em dash
  if (dashSplit.length > 1) {
    s = dashSplit[0].trim();
  } else {
    // Fallback: keep text before first comma
    const i = s.indexOf(",");
    if (i > -1) s = s.slice(0, i).trim();
  }

  // Specific Romeoville tail cleanup (if any remains)
  s = s.replace(/\s*,?\s*Romeoville\s*,?\s*IL(?:\s*\d{5}(?:-\d{4})?)?$/i, "").trim();

  // Generic trailing "City, ST 12345" or "City ST 12345"
  s = s.replace(/\s*,?\s*[A-Za-z .'\-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i, "").trim();
  s = s.replace(/\s*,?\s*[A-Za-z .'\-]+\s+[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i, "").trim();

  if (!s || /^-+\s*$/.test(s)) return "TBA";
  return s;
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

/* ----------------------------------- Main ---------------------------------- */

(async () => {
  try {
    // 1) CLI args
    let urls = process.argv.slice(2);

    // 2) Env var ICS_URLS (comma-separated)
    if (!urls.length && process.env.ICS_URLS) {
      urls = process.env.ICS_URLS.split(",").map(s => s.trim()).filter(Boolean);
    }

    // 3) Fallback in-file array
    if (!urls.length) {
      urls = ICS_URLS_FALLBACK.slice();
    }

    if (!urls.length) {
      console.error("❌ No ICS URLs provided. Supply via CLI args, ICS_URLS env, or ICS_URLS_FALLBACK.");
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

    // Sort ascending, cap to MAX_EVENTS
    merged.sort((a, b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));
    merged = merged.slice(0, MAX_EVENTS);

    // Serialize with ISO strings; drop location if it would be "TBA"
    const out = merged.map(e => {
      const loc = cleanLocation(e.location);
      const ev = {
        title: stripTags(e.title),
        start: e.start ? e.start.toISOString() : null,
        end: e.end ? e.end.toISOString() : null
      };
      if (loc !== "TBA") ev.location = loc;
      return ev;
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
    console.log(`✅ Wrote ${out.length} events to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Failed to build events.json:", err);
    process.exit(1);
  }
})();
