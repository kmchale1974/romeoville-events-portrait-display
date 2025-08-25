(function () {
  // ======= CONFIG =======
  var CONFIG = {
    EVENTS_URL: 'events.json',      // same-folder JSON
    EVENTS_PER_PAGE: 4,             // show 4 per page
    MAX_EVENTS: 24,                 // total cap
    DISPLAY_MS: 12000,              // fully visible time per page
    FADE_MS: 900,                   // match --fade-ms in CSS
    REFRESH_EVERY_MINUTES: 60,      // reload data hourly
    HARD_RELOAD_AT_MIDNIGHT: true,  // full reload after midnight
    TIMEZONE: (Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : null) || 'America/Chicago'
  };

  var pagesHtml = [];
  var currentPage = 0;
  var cycleTimer = null;

  // Show JS errors on screen so it never looks "blank"
  window.onerror = function (msg) {
    try {
      var s = document.getElementById('status');
      if (s) s.textContent = 'Error: ' + msg;
    } catch (_e) {}
  };

  function $pages(){ return document.getElementById('pages'); }
  function $status(){ return document.getElementById('status'); }

  function withCacheBust(url){ var sep = url.indexOf('?') === -1 ? '?' : '&'; return url + sep + '_=' + Date.now(); }
  function parseDateSafe(val){ if (!val) return null; var d = new Date(val); return isNaN(d.getTime()) ? null : d; }

  function normalizeEvent(e){
    var start = parseDateSafe(e.start);
    var end = parseDateSafe(e.end);

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

    if (!end && start) end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

    return {
      title: e.title || 'Untitled Event',
      location: e.location,
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
        return new Intl.DateTimeFormat('en-US', {
          weekday:'short', month:'short', day:'numeric', year:'numeric',
          timeZone: CONFIG.TIMEZONE
        }).format(e.start);
      } catch (_e) {}
    }
    return 'TBA';
  }

  function formatEventTime(e){
    if (e.displayTime) return e.displayTime;
    if (e.start) {
      try {
        var fmt = new Intl.DateTimeFormat('en-US', { hour:'numeric', minute:'2-digit', timeZone: CONFIG.TIMEZONE });
        var s = fmt.format(e.start);
        if (e.end) return s + ' \u2013 ' + fmt.format(e.end);
        return s;
      } catch (_e) {
        var d = e.start, h=d.getHours(), m=d.getMinutes(), am=h<12?'AM':'PM'; h=h%12; if(h===0)h=12; if(m<10)m='0'+m;
        var out = h+':'+m+' '+am;
        if (e.end){ var de=e.end, hh=de.getHours(), mm=de.getMinutes(), aam=hh<12?'AM':'PM'; hh=hh%12; if(hh===0)hh=12; if(mm<10)mm='0'+mm; out += ' \u2013 '+hh+':'+mm+' '+aam; }
        return out;
      }
    }
    return 'TBA';
  }

  function filterUpcoming(list){
    var now = new Date();
    var sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return list.filter(function(e){ if (e.end) return e.end.getTime() >= sod; if (e.start) return e.start.getTime() >= sod; return true; });
  }

  function sortByStart(a,b){ var at=a.start?a.start.getTime():9007199254740991; var bt=b.start?b.start.getTime():9007199254740991; return at-bt; }
  function chunk(arr,n){ var out=[],i=0; for(;i<arr.length;i+=n) out.push(arr.slice(i,i+n)); return out; }

  function setStatus(msg){ var el=$status(); if(el) el.textContent=msg||''; }

  function escapeHtml(s){
    s = String(s);
    s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
         .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    return s;
  }

  // ---- Render ALL pages into the DOM (hidden by default) ----
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

    // Inject content
    $pages().innerHTML = pagesHtml.join('');
    currentPage = 0;

    // Show first page (fade in)
    showOnly(currentPage, true);
    fitActivePage();
  }

  // Show index; if doFadeIn, run fade-in; otherwise just show visible
  function showOnly(idx, doFadeIn){
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.page'));
    for (var i=0;i<nodes.length;i++){
      var n = nodes[i];
      n.classList.remove('fade-in','fade-out','show');
      if (i === idx) {
        n.classList.add('show'); // layout visible at opacity:0
        if (doFadeIn) {
          // Force a reflow so the next class change animates cleanly
          void n.offsetWidth;
          n.classList.add('fade-in');  // fade from 0 -> 1
        } else {
          n.classList.add('fade-in');  // immediately visible
        }
      }
    }
  }

  // Fade the current page out fully, then callback to switch
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

  // ---- Full timeline: fade in → display → fade out → switch → repeat ----
  function startCycle(){
    stopCycle();

    // ensure first page is visible and fully faded in
    showOnly(currentPage, true);

    // schedule first loop after initial display+fade-in
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

  // --------- Networking (fetch with XHR fallback) ----------
  function getJson(url){
    url = withCacheBust(url);
    if (typeof fetch === 'function'){
      return fetch(url, { cache:'no-store' }).then(function(res){ if(!res.ok) throw new Error('HTTP '+res.status); return res.json(); });
    }
    // XHR fallback
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
    setStatus('Loading…');
    try{
      var raw = await getJson(CONFIG.EVENTS_URL);
      var norm = (Array.isArray(raw)?raw:[]).map(normalizeEvent);
      var upcoming = filterUpcoming(norm).sort(sortByStart).slice(0, CONFIG.MAX_EVENTS);
      if (!upcoming.length){
        $pages().innerHTML =
          '<div class="page show fade-in"><div class="event"><div class="event-title">No upcoming events found.</div></div></div>';
        setStatus('No upcoming events.');
        return;
      }
      renderPaged(upcoming);
      startCycle();
      setStatus(upcoming.length + ' upcoming event' + (upcoming.length===1?'':'s') + ' • updated ' + new Date().toLocaleTimeString());
    }catch(err){
      console.error('Load error:', err);
      setStatus('Failed to load events.');
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

  // Auto-fit logic (unchanged)
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
      var scale=Math.min(1, Math.max(0.7, H/h)); /* don’t shrink below 70% */
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
