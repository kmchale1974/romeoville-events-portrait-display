// .github/scripts/fetch-events-from-ics.js
const ical = require("node-ical");
const fs = require("fs");
const fetch = require("node-fetch");

const ICS_URLS = [
  "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=61&feed=calendar", // Important Village Dates
  "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=58&feed=calendar", // Special Events Calendar
  "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=34&feed=calendar", // Village Board of Trustees
  "https://www.romeoville.org/common/modules/iCalendar/iCalendar.aspx?catID=45&feed=calendar"  // Village Office Closings
];

async function fetchICS(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const text = await res.text();
  return ical.sync.parseICS(text);
}

(async () => {
  let allEvents = [];

  for (const url of ICS_URLS) {
    try {
      const data = await fetchICS(url);
      const events = Object.values(data).filter(
        (ev) => ev.type === "VEVENT"
      );

      events.forEach((ev) => {
        let location = ev.location ? ev.location.trim() : "";

        // Strip trailing city/state/zip if present
        location = location.replace(/Romeoville,? IL.*$/i, "").trim();
        location = location.replace(/- Romeoville IL.*$/i, "").trim();
        location = location.replace(/Romeoville IL.*$/i, "").trim();

        // Remove leading dashes/extra spaces
        location = location.replace(/^[-–]\s*/, "");

        // If "TBA", clear it entirely
        if (/^TBA$/i.test(location)) {
          location = "";
        }

        allEvents.push({
          title: ev.summary || "Untitled Event",
          start: ev.start,
          end: ev.end,
          location: location
        });
      });
    } catch (err) {
      console.error(`Error processing ${url}:`, err);
    }
  }

  // Filter out past events
  const now = new Date();
  allEvents = allEvents.filter((e) => new Date(e.end) >= now);

  // Sort by start time
  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Limit total events
  allEvents = allEvents.slice(0, 32);

  fs.writeFileSync("events.json", JSON.stringify(allEvents, null, 2));
  console.log(`Saved ${allEvents.length} events to events.json`);
})();
