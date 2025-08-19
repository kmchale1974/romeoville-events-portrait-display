/**
 * Merge events from ICS feeds into events.json.
 * - Strips HTML and ICS escapes
 * - Location: keep venue only (before dash/comma), drop City/State/ZIP
 * - Filters out past events (ended before start of today)
 * - Sorts ascending, caps MAX_EVENTS
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

const MAX_EVENTS = 20;
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
 * Clean location aggressively:
 * 1) Strip HTML + unescape
 * 2) If contains " - " (or an em/en dash), keep only text BEFORE the dash (venue)
 * 3) Else if contains a comma, keep only text BEFORE first comma
 * 4) Remove trailing "City, ST ZIP" or "City ST ZIP" patterns if any remain
 * 5) Normalize empties/leading dashes to "TBA"
 */
function cleanLocation(loc) {
  if (!loc) return "TBA";
  let s = unescapeICS(stripTags(loc)).trim();

  // If it starts with just a dash or is empty after trim, call it TBA
  if (!s || /^-+\s*$/.test(s)) return "TBA";

  // Split by dash variants first (most feeds use " - ")
  const dashMatch = s.split(/\s[-–—]\s/, 2); // hyphen, en dash, em dash
  if (dashMatch.length > 1) {
    s = dashMatch[0].trim();
  } else {
    // Otherwise split by first comma
    const idx = s.indexOf(",");
    if (idx > -1) s = s.slice(0, idx).trim();
  }

  // Remove any trailing ", Romeoville, IL 60446" / ", Romeoville IL 60446" / "Romeoville, IL" / etc.
  s = s.replace(/\s*,?\s*Romeoville\s*,?\s*IL(?:\s*\d{5}(?:-\d{4})?)?$/i, "").trim();

  // Generic trailing "City, ST 12345" or "City ST 12345" (if venue strings are odd)
  s = s.replace(/\s*,?\s*[A-Za-z .'\-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i, "").trim();
  s = s.replace(/\s*,?\s*[A-Za-z .'\-]+\s+[A-Z]{2}\s*\d{5}(?:-\d{4})?$/i, "").trim();

  // If still empty or just a dash, fallback
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
