(function () {
  // ======= CONFIG =======
  var CONFIG = {
    EVENTS_URL: 'events.json',
    EVENTS_PER_PAGE: 4,
    MAX_EVENTS: 24,
    PAGE_DURATION_MS: 12000,        // 12 seconds per page
    REFRESH_EVERY_MINUTES: 60,      // reload data hourly
    HARD_RELOAD_AT_MIDNIGHT: true,  // full reload after midnight
    TIMEZONE: (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null) || 'America/Chicago'
  };

  var pages = [];
  var currentPage = 0;
  var rotateTimer = null;

  function $pages(){ return document.getElementById('pages'); }
  function $status(){ return document.getElementById('status'); }

  function withCacheBust(url){
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + '_=' + Date.now();
  }

  function parseDateSafe(val){
    if (!val) return null;
    var d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalizeEvent(e){
    var start = parseDateSafe(e.start);
    var end = parseDateSafe(e.end);

    // Build start from legacy date/time if needed
    if (!start && e.date) {
      var startTimeStr = null;
      if (e.time && typeof e.time === 'string') {
        var m = e.time.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) startTimeStr = m[1];
      }
      var base = startTimeStr ? (e.date + ' ' + startTimeStr) : e.date;
      start = parseDateSafe(base);
    }

    // Default end to +2 hours if missing
    if (!end && start) {
      end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    }

    return {
      title: e.title || 'Untitled Event',
      location: e.location, // may be undefined
      displayDate: e.date || null,
      displayTime: e.time || null,
      start: start,
      end: end
    };
  }

  function formatEventDate(e){
    if (e.displayDate) return e.displayDate;
    if (e.start) {
      try {
        var fmt = new Intl.DateTimeFormat('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
          timeZone: CONFIG.TIMEZONE
        });
        return fmt.format(e.start);
      } catch (_e) {}
    }
    return 'TBA';
  }

  function formatEventTime(e){
    if (e.displayTime) return e.displayTime;
    if (e.start) {
      try {
        var fmt = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric', minute: '2-digit', timeZone: CONFIG.TIMEZONE
        });
        var startStr = fmt.format(e.start);
        if (e.end) {
          var endStr = fmt.format(e.end);
          return startStr + ' \u2013 ' + endStr;
        }
        return startStr;
      } catch (_e) {
        // Very old engines fallback
        var s = e.start, h = s.getHours(), m = s.getMinutes();
        var am = h < 12 ? 'AM' : 'PM'; h = h % 12; if (h === 0) h = 12;
        if (m < 10) m = '0' + m;
        var t = h + ':' + m + ' ' + am;
        if (e.end) {
          var ee = e.end, hh = ee.getHours(), mm = ee.getMinutes();
          var aam = hh < 12 ? 'AM' : 'PM'; hh = hh % 12; if (hh === 0) hh = 12;
          if (mm < 10) mm = '0' + mm;
          t += ' \u2013 ' + (hh + ':' + mm + ' ' + aam);
        }
        return t;
      }
    }
    return 'TBA';
  }

  function filterUpcoming(list){
    var now = new Date();
    var sod = startOfDay(now).getTime();
    return list.filter(function(e){
      if (e.end) return e.end.getTime() >= sod;
      if (e.start) return e.start.getTime() >= sod;
      return true; // keep undated items
    });
  }

  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function sortByStart(a, b){
    var at = a.start ? a.start.getTime() : 9007199254740991; // MAX_SAFE_INTEGER-ish
    var bt = b.start ? b.start.getTime() : 9007199254740991;
    return at - bt;
  }

  function chunk(arr, size){
    var out = [], i = 0;
    for (; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function setStatus(msg){
    var el = $status();
    if (el) el.textContent = msg || '';
  }

  function renderPaged(events){
    var groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    pages = groups.map(function(group){
      var itemsHtml = group.map(function(e){
        var dateStr = formatEventDate(e);
        var timeStr = formatEventTime(e);
        var locLine = e.location ? '<div class="event-detail">Location: ' + escapeHtml(e.location) + '</div>' : '';
        return ''
          + '<div class="event">'
          +   '<div class="event-title">' + escapeHtml(e.title) + '</div>'
          +   '<div class="event-detail">Date: ' + escapeHtml(dateStr) + '</div>'
          +   '<div class="event-detail">Time: ' + escapeHtml(timeStr) + '</div>'
          +   locLine
          + '</div>';
      }).join('');
      return '<div class="page">' + itemsHtml + '</div>';
    });

    $pages().innerHTML = pages.join('');
    currentPage = 0;
    updateActivePage();
  }

  function updateActivePage(){
    var pageEls = Array.prototype.slice.call(document.querySelectorAll('.page'));
    pageEls.forEach(function(el, i){
      if (i === currentPage) el.classList.add('active');
      else el.classList.remove('active');
    });
    fitActivePage();
  }

  function startRotation(){
    stopRotation();
    if (pages.length <= 1) return;
    rotateTimer = setInterval(function(){
      currentPage = (currentPage + 1) % pages.length;
      updateActivePage();
    }, CONFIG.PAGE_DURATION_MS);
  }

  function stopRotation(){
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  // Auto-fit: step down sizes; if still too tall, scale the page without widening
  function fitActivePage(){
    var active = document.querySelector('.page.active');
    if (!active) return;

    active.classList.remove('tight', 'tighter', 'scaled');
    active.style.transform = '';

    function fits(){ return active.scrollHeight <= active.clientHeight; }

    if (fits()) return;

    active.classList.add('tight');
    if (fits()) return;

    active.classList.add('tighter');
    if (fits()) return;

    var h = active.scrollHeight;
    var H = active.clientHeight;
    if (h > 0 && H > 0) {
      var scale = Math.min(1, Math.max(0.7, H / h)); // don’t shrink below 70%
      active.classList.add('scaled');
      active.style.transform = 'scale(' + scale + ')';
    }
  }

  // --------- Networking (fetch with XHR fallback) ----------
  function getJson(url){
    url = withCacheBust(url);
    if (typeof fetch === 'function') {
      return fetch(url, { cache: 'no-store' }).then(function(res){
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
    }
    // XHR fallback
    return new Promise(function(resolve, reject){
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'json';
        xhr.onreadystatechange = function(){
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (xhr.response && typeof xhr.response === 'object') {
                resolve(xhr.response);
              } else {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (e){ reject(e); }
              }
            } else {
              reject(new Error('HTTP ' + xhr.status));
            }
          }
        };
        xhr.send();
      } catch (e) { reject(e); }
    });
  }

  async function loadAndRender(){
    setStatus('Loading…');
    try {
      var raw = await getJson(CONFIG.EVENTS_URL);
      var norm = (Array.isArray(raw) ? raw : []).map(normalizeEvent);
      var upcoming = filterUpcoming(norm).sort(sortByStart).slice(0, CONFIG.MAX_EVENTS);

      renderPaged(upcoming);
      startRotation();

      var count = upcoming.length;
      setStatus(count + ' upcoming event' + (count === 1 ? '' : 's') + ' • updated ' + new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Load error:', err);
      setStatus('Failed to load events.');
      $pages().innerHTML =
        '<div class="page active"><div class="event"><div class="event-title">No upcoming events found.</div></div></div>';
    } finally {
      fitActivePage();
    }
  }

  function scheduleHourlyRefresh(){
    var ms = CONFIG.REFRESH_EVERY_MINUTES * 60 * 1000;
    setInterval(function(){
      loadAndRender().then(fitActivePage);
    }, ms);
  }

  function scheduleMidnightReload(){
    if (!CONFIG.HARD_RELOAD_AT_MIDNIGHT) return;
    var now = new Date();
    var next = new Date(now.getTime());
    next.setHours(24, 0, 2, 0); // ~2s after midnight
    var delay = next.getTime() - now.getTime();
    setTimeout(function(){ location.reload(); }, delay);
  }

  function escapeHtml(s){
    s = String(s);
    s = s.replace(/&/g, '&amp;');
    s = s.replace(/</g, '&lt;');
    s = s.replace(/>/g, '&gt;');
    s = s.replace(/"/g, '&quot;');
    s = s.replace(/'/g, '&#39;');
    return s;
  }

  window.addEventListener('load', function(){
    loadAndRender();
    scheduleHourlyRefresh();
    scheduleMidnightReload();
    window.addEventListener('resize', fitActivePage);
  });
})();
