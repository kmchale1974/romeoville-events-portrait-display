(() => {
  // ======= CONFIG =======
  const CONFIG = {
    EVENTS_URL: 'events.json',
    EVENTS_PER_PAGE: 5,            // your current setting
    MAX_EVENTS: 20,                // total cap
    PAGE_DURATION_MS: 12_000,      // your current setting
    REFRESH_EVERY_MINUTES: 60,
    HARD_RELOAD_AT_MIDNIGHT: true,
    TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  };

  let pages = [];
  let currentPage = 0;
  let rotateTimer = null;

  const $pages = () => document.getElementById('pages');
  const $status = () => document.getElementById('status');

  const withCacheBust = (url) => {
    const u = new URL(url, location.href);
    u.searchParams.set('_', String(Date.now()));
    return u.toString();
  };

  function parseDateSafe(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalizeEvent(e) {
    let start = parseDateSafe(e.start);
    let end = parseDateSafe(e.end);

    if (!start && e.date) {
      let startTimeStr = null;
      if (e.time && typeof e.time === 'string') {
        const m = e.time.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) startTimeStr = m[1];
      }
      const base = startTimeStr ? `${e.date} ${startTimeStr}` : e.date;
      start = parseDateSafe(base);
    }

    if (!end && start) {
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    }

    return {
      title: e.title || 'Untitled Event',
      location: e.location || 'TBA',
      displayDate: e.date || null,
      displayTime: e.time || null,
      start,
      end,
    };
  }

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
    const sod = startOfDay(now).getTime();
    return list.filter(e => {
      if (e.end) return e.end.getTime() >= sod;
      if (e.start) return e.start.getTime() >= sod;
      return true; // keep undated items
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

  function renderPaged(events) {
    const groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    pages = groups.map(group => {
      const itemsHtml = group.map(e => {
        const dateStr = formatEventDate(e);
        const timeStr = formatEventTime(e);
        const locStr = e.location || 'TBA';
        return `
          <div class="event">
            <div class="event-title">${escapeHtml(e.title)}</div>
            <div class="event-detail">Date: ${escapeHtml(dateStr)}</div>
            <div class="event-detail">Time: ${escapeHtml(timeStr)}</div>
            <div class="event-detail">Location: ${escapeHtml(locStr)}</div>
          </div>
        `;
      }).join('');

      return `<div class="page">${itemsHtml}</div>`;
    });

    $pages().innerHTML = pages.join('');
    currentPage = 0;
    updateActivePage();
  }

  function updateActivePage() {
    const pageEls = Array.from(document.querySelectorAll('.page'));
    pageEls.forEach((el, i) => el.classList.toggle('active', i === currentPage));
    fitActivePage(); // ensure it fits
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

  // Auto-fit: step down sizes; if still too tall, scale the page without widening
  function fitActivePage() {
    const active = document.querySelector('.page.active');
    if (!active) return;

    // reset fit classes and any existing transform before measuring
    active.classList.remove('tight', 'tighter', 'scaled');
    active.style.transform = '';

    const fits = () => active.scrollHeight <= active.clientHeight;

    if (fits()) return;

    active.classList.add('tight');
    if (fits()) return;

    active.classList.add('tighter');
    if (fits()) return;

    // Last resort: scale down to fit — do NOT widen (prevents right-edge clipping)
    const h = active.scrollHeight;
    const H = active.clientHeight;
    if (h > 0 && H > 0) {
      const scale = Math.min(1, Math.max(0.7, H / h)); // don’t shrink below 70%
      active.classList.add('scaled');
      active.style.transform = `scale(${scale})`; // keep width at 100%
    }
  }

  async function loadAndRender() {
    setStatus('Loading…');
    try {
      const res = await fetch(withCacheBust(CONFIG.EVENTS_URL), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();

      const norm = (Array.isArray(raw) ? raw : []).map(normalizeEvent);
      const upcoming = filterUpcoming(norm).sort(sortByStart).slice(0, CONFIG.MAX_EVENTS);

      renderPaged(upcoming);
      startRotation();

      const count = upcoming.length;
      setStatus(`${count} upcoming event${count === 1 ? '' : 's'} • updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.error('Load error:', err);
      setStatus('Failed to load events.');
      $pages().innerHTML =
        `<div class="page active"><div class="event"><div class="event-title">No upcoming events found.</div></div></div>`;
    } finally {
      fitActivePage();
    }
  }

  function scheduleHourlyRefresh() {
    const ms = CONFIG.REFRESH_EVERY_MINUTES * 60 * 1000;
    setInterval(async () => {
      await loadAndRender();
      fitActivePage();
    }, ms);
  }

  function scheduleMidnightReload() {
    if (!CONFIG.HARD_RELOAD_AT_MIDNIGHT) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 2, 0); // ~2s after midnight
    const delay = next.getTime() - now.getTime();
    setTimeout(() => location.reload(), delay);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  window.addEventListener('load', async () => {
    await loadAndRender();
    scheduleHourlyRefresh();
    scheduleMidnightReload();
    window.addEventListener('resize', fitActivePage);
  });
})();
