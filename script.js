// Remote-only (set EVENTS_URL for site) OR keep as-is for HTML App
(function () {
  var CONFIG = {
    EVENTS_URL: "https://kmchale1974.github.io/romeoville-events-portrait-display/events.json",
    EVENTS_PER_PAGE: 6,
    MAX_EVENTS: 24,
    PAGE_INTERVAL_MS: 12000,      // no numeric separators
    REFRESH_EVERY_MINUTES: 60,
    TIMEZONE: "America/Chicago"
  };

  function $(id){ return document.getElementById(id); }

  // --- Date/format helpers (no optional chaining) ---
  function fmtDate(d){
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
      timeZone: CONFIG.TIMEZONE
    }).format(d);
  }
  function fmtTime(d){
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: CONFIG.TIMEZONE
    }).format(d);
  }
  function parseDateSafe(v){
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalize(ev){
    var start = parseDateSafe(ev.start);
    var end = parseDateSafe(ev.end);
    if (!end && start) end = new Date(start.getTime() + 2*60*60*1000);
    return {
      title: ev.title || "Untitled Event",
      location: ev.location,
      start: start,
      end: end
    };
  }

  function filterUpcoming(list){
    var now = new Date();
    var sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return list.filter(function(e){
      if (e.end) return e.end.getTime() >= sod;
      if (e.start) return e.start.getTime() >= sod;
      return true;
    });
  }

  function byStart(a,b){
    var at = a.start ? a.start.getTime() : 9007199254740991; // Number.MAX_SAFE_INTEGER
    var bt = b.start ? b.start.getTime() : 9007199254740991;
    return at - bt;
  }

  function chunk(arr, n){
    var out = [], i = 0;
    for (; i < arr.length; i += n) out.push(arr.slice(i, i+n));
    return out;
  }

  function escapeHtml(s){
    s = String(s);
    // avoid replaceAll; use regex global
    s = s.replace(/&/g, "&amp;");
    s = s.replace(/</g, "&lt;");
    s = s.replace(/>/g, "&gt;");
    s = s.replace(/"/g, "&quot;");
    s = s.replace(/'/g, "&#39;");
    return s;
  }

  function withCacheBust(url){
    try {
      var u = new URL(url, location.href);
      u.searchParams.set("_", String(Date.now()));
      return u.toString();
    } catch (_e) {
      // very old engines: manual fallback
      var sep = url.indexOf("?") === -1 ? "?" : "&";
      return url + sep + "_=" + Date.now();
    }
  }

  function renderPages(events){
    var container = $("events-container") || $("pages") || document.body; // support both app/site
    var groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    var pages = groups.map(function(group){
      var html = group.map(function(e){
        var dateStr = e.start ? fmtDate(e.start) : "TBA";
        var timeStr = e.start ? (e.end ? (fmtTime(e.start) + " – " + fmtTime(e.end)) : fmtTime(e.start)) : "TBA";
        var locLine = e.location ? '<div class="event-detail event-location">Location: '+ escapeHtml(e.location) +'</div>' : '';
        return '' +
          '<div class="event">' +
            '<div class="event-title">' + escapeHtml(e.title) + '</div>' +
            '<div class="event-detail">Date: ' + escapeHtml(dateStr) + '</div>' +
            '<div class="event-detail">Time: ' + escapeHtml(timeStr) + '</div>' +
            locLine +
          '</div>';
      }).join("");
      return '<div class="page">' + html + '</div>';
    });

    // simple pager
    var i = 0;
    container.innerHTML = pages[0] || "";
    if (window.__rotationTimer) clearInterval(window.__rotationTimer);
    if (pages.length > 1){
      window.__rotationTimer = setInterval(function(){
        i = (i + 1) % pages.length;
        container.innerHTML = pages[i];
      }, CONFIG.PAGE_INTERVAL_MS);
    }
  }

  function loadAndRender(){
    var url = withCacheBust(CONFIG.EVENTS_URL);
    return fetch(url, { cache: "no-store" })
      .then(function(res){
        if (!res.ok) throw new Error("HTTP "+res.status);
        return res.json();
      })
      .then(function(json){
        if (!Array.isArray(json)) throw new Error("Invalid events JSON");
        var norm = json.map(normalize);
        var upcoming = filterUpcoming(norm).sort(byStart).slice(0, CONFIG.MAX_EVENTS);
        renderPages(upcoming);
      })
      .catch(function(err){
        console.error("Load failed:", err);
        var container = $("events-container") || $("pages") || document.body;
        container.innerHTML =
          '<div class="page"><div class="event"><div class="event-title">No events available (offline).</div></div></div>';
      });
  }

  function scheduleHourlyRefresh(){
    setInterval(loadAndRender, CONFIG.REFRESH_EVERY_MINUTES * 60 * 1000);
  }

  function scheduleMidnightReload(){
    try{
      var now = new Date();
      var next = new Date(now.getTime());
      next.setHours(24,0,5,0); // 5s after midnight
      var delay = next.getTime() - now.getTime();
      setTimeout(function(){ location.reload(); }, Math.max(5000, delay));
    }catch(_e){}
  }

  window.addEventListener("load", function(){
    loadAndRender().then(function(){
      scheduleHourlyRefresh();
      scheduleMidnightReload();
    });
  });
})();
