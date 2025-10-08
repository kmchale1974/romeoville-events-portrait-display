(function () {
  // ======= CONFIG =======
  var CONFIG = {
    EVENTS_URL: 'events.json',
    EVENTS_PER_PAGE: 4,
    MAX_EVENTS: 24,
    DISPLAY_MS: 12000,
    FADE_MS: 900,
    REFRESH_EVERY_MINUTES: 60,
    HARD_RELOAD_AT_MIDNIGHT: true,
    TIMEZONE: (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null) || 'America/Chicago'
  };

  var pagesHtml = [];
  var currentPage = 0;
  var cycleTimer = null;

  function $pages(){ return document.getElementById('pages'); }

  function withCacheBust(url){ var sep = url.indexOf('?') === -1 ? '?' : '&'; return url + sep + '_=' + Date.now(); }
  function parseDateSafe(val){ if (!val) return null; var d = new Date(val); return isNaN(d.getTime()) ? null : d; }

  // Local midnight from YYYY-MM-DD
  function localDateFromYMD(ymd){
    var y = parseInt(ymd.slice(0,4),10);
    var m = parseInt(ymd.slice(5,7),10) - 1;
    var d = parseInt(ymd.slice(8,10),10);
    return new Date(y, m, d, 0, 0, 0, 0);
  }

  function fmtDateLocal(d){
    try {
      return new Intl.DateTimeFormat('en-US', {
        weekday:'short', month:'short', day:'numeric', year:'numeric',
        timeZone: CONFIG.TIMEZONE
      }).format(d);
    } catch (_e) {
      return (d.getMonth()+1) + "/" + d.getDate() + "/" + d.getFullYear();
    }
  }

  function fmtTimeLocal(d){
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour:'numeric', minute:'2-digit', timeZone: CONFIG.TIMEZONE
      }).format(d);
    } catch (_e) {
      var h=d.getHours(), m=d.getMinutes(), am=h<12?'AM':'PM'; h=h%12; if(h===0)h=12; if(m<10)m='0'+m;
      return h+':'+m+' '+am;
    }
  }

  // --- Helpers for all-day + synthetic 11:59 PM ends ---
  function isUTCISO(s){ return typeof s === 'string' && /T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/i.test(s); }
  function isMidnightUTC(s){ return typeof s === 'string' && /T00:00:00(\.\d+)?Z$/i.test(s); }

  // Treat as all-day only if BOTH start & end are UTC midnight and duration ~24h+
  function detectAllDay(startRaw, endRaw){
    if (!isUTCISO(startRaw) || !isMidnightUTC(startRaw)) return null;
    if (!isUTCISO(endRaw)   || !isMidnightUTC(endRaw))   return null;
    var s = new Date(startRaw), e = new Date(endRaw);
    if (isNaN(s) || isNaN(e)) return null;
    if ((e - s) >= (24*60*60*1000 - 1000)) return String(startRaw).slice(0,10);
    return null;
  }

  // Returns true if the local-time formatted end is exactly 11:59 PM (common placeholder)
  function isSyntheticEndLocal(endDate){
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        hour:'numeric', minute:'2-digit', hour12:true, timeZone: CONFIG.TIMEZONE
      }).formatToParts(endDate);
      var hour = null, minute = null, period = null;
      for (var i=0;i<parts.length;i++){
        var p = parts[i];
        if (p.type === 'hour') hour = parseInt(p.value, 10);
        if (p.type === 'minute') minute = p.value;
        if (p.type === 'dayPeriod') period = p.value; // "AM"/"PM"
      }
      return hour === 11 && minute === '59' && String(period).toUpperCase() === 'PM';
    } catch (_e) {
      // fallback: string compare
      return fmtTimeLocal(endDate) === '11:59 PM';
    }
  }

  function normalizeEvent(e){
    var startRaw = e.start;
    var endRaw   = e.end;

    var start = parseDateSafe(startRaw);
    var end   = parseDateSafe(endRaw);

    // Legacy support (date/time fields)
    if (!start && e.date) {
      var startTimeStr = null;
      if (e.time && typeof e.time === 'string') {
        var m = e.time.match(/(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (m) startTimeStr = m[1];
      }
      var base = startTimeStr ? (e.date + ' ' + startTimeStr) : e.date;
      start = parseDateSafe(base);
    }

    // Do NOT invent an end time if missing. Leave 'end' as-is.

    var allDayYMD = detectAllDay(startRaw, endRaw);
    var isAllDay = !!allDayYMD;

    return {
      title: e.title || 'Untitled Event',
      location: e.location,
      displayDate: e.date || null,
      displayTime: e.time || null,
      start: start,
      end: end,
      isAllDay: isAllDay,
      allDayYMD: allDayYMD
    };
  }

  function formatEventDate(ev){
    if (ev.displayDate) return ev.displayDate;
    if (ev.isAllDay && ev.allDayYMD){
      var ld = localDateFromYMD(ev.allDayYMD);
      return fmtDateLocal(ld);
    }
    if (ev.start) return fmtDateLocal(ev.start);
    return 'TBA';
  }

  function formatEventTime(ev){
    if (ev.displayTime) return ev.displayTime;
    if (ev.isAllDay) return 'All day';

    if (ev.start) {
      var s = fmtTimeLocal(ev.start);
      // If end exists but is a synthetic 11:59 PM placeholder, suppress it
      if (ev.end && !isSyntheticEndLocal(ev.end)) {
        return s + ' \u2013 ' + fmtTimeLocal(ev.end);
      }
      return s; // only start time
    }
    return 'TBA';
  }

  function filterUpcoming(list){
    var now = new Date();
    var sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return list.filter(function(e){
      if (e.isAllDay && e.allDayYMD){
        var ld = localDateFromYMD(e.allDayYMD).getTime();
        return ld >= sod;
      }
      if (e.end) return e.end.getTime() >= sod;
      if (e.start) return e.start.getTime() >= sod;
      return true;
    });
  }

  function sortByStart(a,b){
    var at = a.isAllDay && a.allDayYMD ? localDateFromYMD(a.allDayYMD).getTime()
             : (a.start ? a.start.getTime() : 9007199254740991);
    var bt = b.isAllDay && b.allDayYMD ? localDateFromYMD(b.allDayYMD).getTime()
             : (b.start ? b.start.getTime() : 9007199254740991);
    return at - bt;
  }

  function chunk(arr,n){ var out=[],i=0; for(;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

  function escapeHtml(s){
    s = String(s);
    s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
         .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return s;
  }

  function renderPaged(events){
    var groups = chunk(events, CONFIG.EVENTS_PER_PAGE);
    pagesHtml = groups.map(function(group){
      var items = group.map(function(e){
        var dateStr = formatEventDate(e);
        var timeStr = formatEventTime(e);
        var locLine = e.location ? '<div class="event-detail">Location: '+escapeHtml(e.location)+'</div>' : '';
        return ''+
          '<div class="event">'+
            '<div class="event-title">'+escapeHtml(e.title)+'</div>'+
            '<div class="event-detail">Date: '+escapeHtml(dateStr)+'</div>'+
            '<div class="event-detail">Time: '+escapeHtml(timeStr)+'</div>'+
            locLine+
          '</div>';
      }).join('');
      return '<div class="page">'+items+'</div>';
    });

    $pages().innerHTML = pagesHtml.join('');
    currentPage = 0;
    showOnly(currentPage, true);
    fitActivePage();
  }

  function showOnly(idx, doFadeIn){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.page'));
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i];
      n.classList.remove('fade-in','fade-out','show');
      if (i === idx) {
        n.classList.add('show');
        if (doFadeIn) { void n.offsetWidth; n.classList.add('fade-in'); }
        else { n.classList.add('fade-in'); }
      }
    }
  }

  function fadeOutCurrent(callback){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.page'));
    var cur = nodes[currentPage];
    if (!cur) { if (callback) callback(); return; }
    cur.classList.remove('fade-in');
    cur.classList.add('fade-out');
    setTimeout(function(){
      cur.classList.remove('fade-out','show');
      if (callback) callback();
    }, CONFIG.FADE_MS);
  }

  function startCycle(){
    stopCycle();
    showOnly(currentPage, true);
    cycleTimer = setTimeout(loop, CONFIG.DISPLAY_MS + CONFIG.FADE_MS);
    function loop(){
      fadeOutCurrent(function(){
        currentPage = (currentPage + 1) % pagesHtml.length;
        showOnly(currentPage, true);
        fitActivePage();
        cycleTimer = setTimeout(loop, CONFIG.DISPLAY_MS + CONFIG.FADE_MS);
      });
    }
  }

  function stopCycle(){ if (cycleTimer){ clearTimeout(cycleTimer); cycleTimer=null; } }

  function getJson(url){
    url = withCacheBust(url);
    if (typeof fetch === 'function'){
      return fetch(url, { cache:'no-store' }).then(function(res){ if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); });
    }
    return new Promise(function(resolve,reject){
      try{
        var xhr=new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType='json';
        xhr.onreadystatechange=function(){
          if (xhr.readyState===4){
            if (xhr.status>=200 && xhr.status<300){
              if (xhr.response && typeof xhr.response==='object'){ resolve(xhr.response); }
              else { try{ resolve(JSON.parse(xhr.responseText)); }catch(e){ reject(e);} }
            } else reject(new Error('HTTP '+xhr.status));
          }
        };
        xhr.send();
      }catch(e){ reject(e); }
    });
  }

  async function loadAndRender(){
    try{
      var raw = await getJson(CONFIG.EVENTS_URL);
      var norm = (Array.isArray(raw)?raw:[]).map(normalizeEvent);
      var upcoming = filterUpcoming(norm).sort(sortByStart).slice(0, CONFIG.MAX_EVENTS);
      if (!upcoming.length){
        $pages().innerHTML =
          '<div class="page show fade-in"><div class="event"><div class="event-title">No upcoming events found.</div></div></div>';
        return;
      }
      renderPaged(upcoming);
      startCycle();
    }catch(err){
      console.error('Load error:', err);
      $pages().innerHTML =
        '<div class="page show fade-in"><div class="event"><div class="event-title">Failed to load events.</div></div></div>';
    } finally {
      fitActivePage();
    }
  }

  function scheduleHourlyRefresh(){
    var ms = CONFIG.REFRESH_EVERY_MINUTES * 60 * 1000;
    setInterval(function(){ loadAndRender(); }, ms);
  }

  function scheduleMidnightReload(){
    if (!CONFIG.HARD_RELOAD_AT_MIDNIGHT) return;
    var now = new Date();
    var next = new Date(now.getTime());
    next.setHours(24,0,2,0);
    var delay = next.getTime() - now.getTime();
    setTimeout(function(){ location.reload(); }, delay);
  }

  function fitActivePage(){
    var active = document.querySelector('.page.show');
    if (!active) return;

    active.classList.remove('tight','tighter','scaled');
    active.style.transform='';

    function fits(){ return active.scrollHeight <= active.clientHeight; }
    if (fits()) return;

    active.classList.add('tight');
    if (fits()) return;

    active.classList.add('tighter');
    if (fits()) return;

    var h=active.scrollHeight, H=active.clientHeight;
    if (h>0 && H>0){
      var scale=Math.min(1, Math.max(0.7, H/h));
      active.classList.add('scaled');
      active.style.transform='scale('+scale+')';
    }
  }

  window.addEventListener('load', function(){
    loadAndRender();
    scheduleHourlyRefresh();
    scheduleMidnightReload();
    window.addEventListener('resize', fitActivePage);
  });
})();
