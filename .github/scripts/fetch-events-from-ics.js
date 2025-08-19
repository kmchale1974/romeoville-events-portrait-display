/**
 * Merge events from ICS feeds into events.json.
 * - Strips HTML and ICS escapes
 * - Cleans location to venue-only (before dash/comma; removes City/State/ZIP)
 * - Omits "location" field entirely if it would be "TBA"
 * - Filters out events that have fully ended (keep if end >= now)
 * - Sorts ascending, caps to MAX_EVENTS_BACKEND (larger than frontend)
 * - Logs per-feed stats so you can verify Board items are being fetched
 *
 * Dependencies:
 *   npm install node-ical
 *
 * Usage (recommended via workflow step):
 *   node .github/scripts/fetch-events-from-ics.js \
 *     "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=46&feed=calendar" \
 *     "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar" \
 *     "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=45&feed=calendar" \
 *     "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=34&feed=calendar"
 */

const fs = require("fs");
const ical = require("node-ical");

const OUTPUT_FILE = "events.json";
// Pull plenty from the backend so Board/Closings don't get crowded out
const MAX_EVENTS_BACKEND = 60;

/* ---------------- Helpers ---------------- */

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

function normalizeVEvent(item, source) {
  const title = stripTags(unescapeICS(item.summary)) || "Untitled Event";
  const start = item.start instanceof Date ? item.start : null;
  const end = item.end instanceof Date ? item.end : null;
  const location = cleanLocation(item.location);
  return { title, start, end, location, _source: source };
}

async function parseIcs(url) {
  const data = await ical.async.fromURL(url);
  const events = [];
  for (const key of Object.keys(data)) {
    const item = data[key];
    if (!item || item.type !== "VEVENT") continue;
    const ev = normalizeVEvent(item, url);
    if (!ev.start) continue; // skip undated items
    events.push(ev);
  }
  return events;
}

/* ---------------- Main ---------------- */

(async () => {
  try {
    const urls = process.argv.slice(2);
    if (!urls.length) {
      console.error("❌ No ICS URLs provided to fetch-events-from-ics.js");
      process.exit(1);
    }

    // Fetch each feed, log counts
    const feeds = await Promise.all(urls.map(parseIcs));

    // Per-feed logging (total & next 3 upcoming titles)
    feeds.forEach((arr, i) => {
      const url = urls[i];
      const upcoming = arr
        .filter(e => (e.end ? e.end.getTime() : (e.start.getTime() + 2*60*60*1000)) >= Date.now())
        .sort((a,b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));
      console.log(`\n📅 Feed: ${url}`);
      console.log(`   Total parsed: ${arr.length}`);
      console.log(`   Upcoming (end >= now): ${upcoming.length}`);
      upcoming.slice(0, 3).forEach(ev => {
        console.log(`   - ${ev.title} @ ${ev.start?.toISOString()}`);
      });
    });

    // Merge all feeds
    let merged = feeds.flat();

    // De-duplicate by (title + start ISO)
    const seen = new Set();
    merged = merged.filter(e => {
      const key = `${e.title}|${e.start?.toISOString() ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Keep events that haven't fully ended yet (>= now)
    const nowMs = Date.now();
    merged = merged.filter(e => {
      const endMs = e.end ? e.end.getTime() : (e.start.getTime() + 2 * 60 * 60 * 1000);
      return endMs >= nowMs;
    });

    // Sort ascending
    merged.sort((a, b) => (a.start?.getTime() ?? 9e15) - (b.start?.getTime() ?? 9e15));

    // Cap (backend generous cap so Board isn't dropped)
    merged = merged.slice(0, MAX_EVENTS_BACKEND);

    // Serialize (drop location if TBA), and drop _source in output
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
    console.log(`\n✅ Wrote ${out.length} events to ${OUTPUT_FILE}\n`);
  } catch (err) {
    console.error("❌ Failed to build events.json:", err);
    process.exit(1);
  }
})();
