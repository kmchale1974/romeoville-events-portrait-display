(() => {
  // ======= CONFIG =======
  const CONFIG = {
    EVENTS_URL: 'events.json',     // Same-origin JSON
    EVENTS_PER_PAGE: 12,           // Good density for 1080×960
    MAX_EVENTS: 32,                // hard cap
    PAGE_DURATION_MS: 20_000,      // 20 seconds per page
    REFRESH_EVERY_MINUTES: 60,     // reload data hourly
    HARD_RELOAD_AT_MIDNIGHT: true, // full reload right after midnight
    TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  };

  let pages = [];
  let currentPage = 0;
  let rotateTimer = null;

  const $pages = () => document.getElementById('pages');
  const $status = () => document.getElementById('status');

  // Small helper: cache-busting query param
  const withCacheBust = (url) => {
    const u = new URL(url, location.href);
    u.searchParams.set('_', String(Date.now()));
    return u.toString();
  };

  // Parse dates robustly:
  function parseDateSafe(val) {
    if (!val) return null;
    // Accept ISO strings or RFC strings
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // Normalize one event record. Supports either:
  // 1) { title, start, end, location } with ISO strings
  // 2) { title, date, time, location } legacy format (falls back to 'date' only)
  function normalizeEvent(e) {
    let start = parseDateSafe(e.start);
    let end = parseDateSafe(e.end);

    if (!start && e.date) {
      // Try to build a start date from "date" and optional "time"
      // e.g., date: "August 19, 2025", time: "6:00 PM - 8:00 PM"
      // We'll parse the first time range start if present:
      let startTimeStr = null;
      if (e.time && typeof e.time === 'string') {
        const m = e.time.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) startTimeStr = m[1];
      }
      const base = startTimeStr ? `${e.date} ${startTimeStr}` : e.date;
      start = parseDateSafe(base);
    }

    if (!end) {
      // If end is missing, assume same as start or +2 hours as a safe default
      if (start) {
        end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      }
    }

    return {
      title: e.title || 'Untitled Event',
      location: e.location || 'TBA',
      // keep legacy display strings if present
      displayDate: e.date || null,
      displayTime: e.time || null,
      start,
      end,
    };
  }

  // Show "Date:" and "Time:" with fallbacks
  function formatEventDate(e) {
    if (e.displayDate) return e.displayDate;

    if (e.start) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: CONFIG.TIMEZONE
      });
      return fmt.format(e.start);
    }
    return 'TBA';
  }

  function formatEventTime(e) {
    if (e.displayTime) return e.displayTime;

    if (e.start) {
      const fmt = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: CONFIG.TIMEZONE
      });
      const startStr = fmt.format(e.start);
      if (e.end) {
        const endStr = fmt.format(e.end);
        return `${startStr} – ${endStr}`;
      }
      return startStr;
    }
    return 'TBA';
  }

  function filterUpcoming(list) {
    const now = new Date();
    // Consider events that have not fully ended today (keep all today & future)
    return list.filter(e => {
      if (e.end) return e.end.getTime() >= startOfDay(now).getTime();
      if (e.start) return e.start.getTime() >= startOfDay(now).getTime();
      // if no date info, keep (or drop). We'll keep to be safe.
      return true;
    });
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function sortByStart(a, b) {
    const at = a.start ? a.start.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.start ? b.start.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  function setStatus(msg) {
    const el = $status();
    if (el) el.textContent = msg || '';
  }

  function renderPages(events) {
    const pagesHtml = events.map(e => {
      const dateStr = formatEventDate(e);
      const timeStr = formatEventTime(e);
      const locStr = e.location || 'TBA';

      return `
        <div class="event">
          <div class="event-title">${escapeHtml(e.title)}</div>
          <div class="event-row">
            <div class="badge">Date: ${escapeHtml(dateStr)}</div>
            <div class="badge">Time: ${escapeHtml(timeStr)}</div>
            <div class="badge">Location: ${escapeHtml(locStr)}</div>
          </div>
        </div>
      `;
    });

    $pages().innerHTML = pagesHtml.join('');
  }

  function renderPaged(events) {
    const groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    pages = groups.map(group => {
      const items = group.map(e => {
        const dateStr = formatEventDate(e);
        const timeStr = formatEventTime(e);
        const locStr = e.location || 'TBA';
        return `
          <div class="event">
            <div class="event-title">${escapeHtml(e.title)}</div>
            <div class="event-row">
              <div class="badge">Date: ${escapeHtml(dateStr)}</div>
              <div class="badge">Time: ${escapeHtml(timeStr)}</div>
              <div class="badge">Location: ${escapeHtml(locStr)}</div>
            </div>
          </div>
        `;
      }).join('');

      return `<div class="page">${items}</div>`;
    });

    $pages().innerHTML = pages.join('');
    // Activate first page
    currentPage = 0;
    updateActivePage();
  }

  function updateActivePage() {
    const pageEls = Array.from(document.querySelectorAll('.page'));
    pageEls.forEach((el, i) => el.classList.toggle('active', i === currentPage));
  }

  function startRotation() {
    stopRotation();
    if (pages.length <= 1) return;
    rotateTimer = setInterval(() => {
      currentPage = (currentPage + 1) % pages.length;
      updateActivePage();
    }, CONFIG.PAGE_DURATION_MS);
  }

  function stopRotation() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  async function loadAndRender() {
    setStatus('Loading…');
    try {
      const res = await fetch(withCacheBust(CONFIG.EVENTS_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();

      // Normalize events
      const norm = (Array.isArray(raw) ? raw : []).map(normalizeEvent);

      // Filter upcoming and sort
      const upcoming = filterUpcoming(norm).sort(sortByStart).slice(0, CONFIG.MAX_EVENTS);

      // Render as pages + start rotation
      renderPaged(upcoming);
      startRotation();

      const count = upcoming.length;
      setStatus(`${count} upcoming event${count === 1 ? '' : 's'} • updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error('Load error:', err);
      setStatus('Failed to load events.');
      // still clear / show empty
      $pages().innerHTML = `<div class="page active"><div class="event"><div class="event-title">No upcoming events found.</div></div></div>`;
    }
  }

  // Hourly soft refresh (fetch new data, re-render)
  function scheduleHourlyRefresh() {
    const ms = CONFI
