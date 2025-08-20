(function () {
  var CONFIG = {
    EVENTS_URL: "https://kmchale1974.github.io/romeoville-events-portrait-display/events.json",
    EVENTS_PER_PAGE: 6,
    MAX_EVENTS: 24,
    PAGE_INTERVAL_MS: 12000,
    REFRESH_EVERY_MINUTES: 60,
    TIMEZONE: "America/Chicago"
  };

  function $(id){ return document.getElementById(id); }
  function containerEl(){
    return $("pages") || $("events-container") || document.body;
  }

  function showError(msg){
    var el = containerEl();
    el.innerHTML =
      '<div class="page"><div class="event"><div class="event-title" '+
      'style="font:700 28px Arial; color:#b00;">' + escapeHtml(msg) +
      '</div></div></div>';
  }

  function fmtDate(d){
    try {
      return new Intl.DateTimeFormat("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
        timeZone: CONFIG.TIMEZONE
      }).format(d);
    } catch (_e) {
      // Fallback
      return (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear();
    }
  }
  function fmtTime(d){
    try {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric", minute: "2-digit", timeZone: CONFIG.TIMEZONE
      }).format(d);
    } catch (_e) {
      var h = d.getHours(), m = d.getMinutes();
      var am = h < 12 ? "AM" : "PM";
      h = h % 12; if (h === 0) h = 12;
      if (m < 10) m = "0" + m;
      return h + ":" + m + " " + am;
    }
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
    var at = a.start ? a.start.getTime() : 9007199254740991;
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
    s = s.replace(/&/g, "&amp;");
    s = s.replace(/</g, "&lt;");
    s = s.replace(/>/g, "&gt;");
    s = s.replace(/"/g, "&quot;");
    s = s.replace(/'/g, "&#39;");
    return s;
  }

  function cacheBust(url){
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return url + sep + "_=" + Date.now();
  }

  function renderPages(events){
    var el = containerEl();
    var groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    var pages = groups.map(function(group){
      var html = group.map(function(e){
        var dateStr = e.start ? fmtDate(e.start) : "TBA";
        var timeStr = e.start ? (e.end ? (fmtTime(e.start) + " – " + fmtTime(e.end)) : fmtTime(e.start)) : "TBA";
        var locLine = e.location ? '<div class="event-detail">Location: ' + escapeHtml(e.location) + '</div>' : '';
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

    var i = 0;
    el.innerHTML = pages[0] || '<div class="page"><div class="event"><div class="event-title">No events.</div></div></div>';

    if (window.__rotationTimer) clearInterval(window.__rotationTimer);
    if (pages.length > 1){
      window.__rotationTimer = setInterval(function(){
        i = (i + 1) % pages.length;
        el.innerHTML = pages[i];
      }, CONFIG.PAGE_INTERVAL_MS);
    }
  }

  function loadAndRender(){
    var url = cacheBust(CONFIG.EVENTS_URL);
    return fetch(url, { cache: "no-store" })
      .then(function(res){
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function(json){
        if (!json || !json.length) {
          showError("No events available.");
          return;
        }
        var norm = json.map(normalize);
        var upcoming = filterUpcoming(norm).sort(byStart).slice(0, CONFIG.MAX_EVENTS);
        renderPages(upcoming);
      })
      .catch(function(err){
        console.error("Load failed:", err);
        showError("Failed to load events.");
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
