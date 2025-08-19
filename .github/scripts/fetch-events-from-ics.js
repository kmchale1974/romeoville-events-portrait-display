/**
 * Merge events from ICS feeds into events.json, stripping HTML and location suffixes.
 */

const fs = require("fs");
const ical = require("node-ical");
const MAX_EVENTS = 20;
const OUTPUT_FILE = "events.json";

function stripTags(str) {
  if (!str) return "";
  return String(str).replace(/<\/?[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Trim location by removing any trailing city/state/zip phrases
function cleanLocation(loc) {
  if (!loc) return "TBA";
  let s = stripTags(loc);
  // Remove trailing ", Romeoville, IL" or variations
  return s.replace(/,\s*Romeoville\s*,?\s*IL\s*(\d{5})?$/i, "").trim() || "TBA";
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function normalizeVEvent(item) {
  const title = stripTags(item.summary) || "Untitled Event";
  const start = item.start instanceof Date ? item.start : null;
  const end = item.end instanceof Date ? item.end : null;
  const location = cleanLocation(item.location);
  return { title, start, end, location };
}

async function parseIcs(url) {
  const data = await ical.async.fromURL(url);
  const events = [];
  for (const key in data) {
    const item = data[key];
    if (item?.type !== "VEVENT") continue;
    const ev = normalizeVEvent(item);
    if (!ev.start) continue;
    events.push(ev);
  }
  return events;
}

(async () => {
  try {
    const urls = process.argv.slice(2);
    if (!urls.length) throw new Error("Please provide at least one ICS URL.");

    const feeds = await Promise.all(urls.map(parseIcs));
    let merged = feeds.flat();

    const seen = new Set();
    merged = merged.filter(e => {
      const k = `${e.title}|${e.start?.toISOString()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const today = startOfToday().getTime();
    merged = merged.filter(e => {
      const endMs = e.end?.getTime() || (e.start.getTime() + 2 * 60 * 60 * 1000);
      return endMs >= today;
    });

    merged.sort((a, b) => (a.start?.getTime() || Infinity) - (b.start?.getTime() || Infinity));
    merged = merged.slice(0, MAX_EVENTS);

    const out = merged.map(e => ({
      title: stripTags(e.title),
      start: e.start.toISOString(),
      end: e.end ? e.end.toISOString() : null,
      location: cleanLocation(e.location),
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2));
    console.log(`✅ Wrote ${out.length} events to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ Error building events.json:", err);
    process.exit(1);
  }
})();
