/* =========================================================
   НАСТРОЙКИ
   ========================================================= */
const CONFIG = {
  // Всё на одном Vercel-проекте — относительные пути, без CORS-возни
  BATTERY_ENDPOINT: '/api/battery',
  MUSIC_ENDPOINT: '/api/music',
  MUSIC_POLL_MS: 5000,
  BATTERY_POLL_MS: 45000,
  DESTINATION_POLL_MS: 5000,
  SPOTIFY_PHONE_NAME: null, // например "David's iPhone"

  OSRM_URL: "https://router.project-osrm.org/route/v1/driving", // используется как запасная оценка для сравнения с TomTom

  // TomTom — используется и для слоя пробок, и для расчёта маршрута с учётом живого трафика
  TOMTOM_API_KEY: "bCBwNBFLEb8BnlowlbVkpO8YwS2hn222",

  // Карта — MapLibre + бесплатные векторные тайлы OpenFreeMap (без ключа, без лимитов)
  MAP_STYLE_LIGHT: "https://tiles.openfreemap.org/styles/liberty",
  MAP_STYLE_DARK: "https://tiles.openfreemap.org/styles/dark",
  DAY_START_HOUR: 7,   // с этого часа — светлая тема (при режиме "Авто")
  NIGHT_START_HOUR: 19, // с этого часа — тёмная тема

  // Ссылка на портал ND Games
  NDGAMES_URL: "https://ndgames.ge",

  START_CENTER: [41.6367, 41.6367], // Батуми
  START_ZOOM: 14,
};

/* =========================================================
   ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ
   ========================================================= */
function showView(name) {
  document.body.dataset.view = name;
  if (name === 'spotify') loadPlaylists(document.getElementById('sp-grid-full'), document.getElementById('sp-device-full'));
  if (name === 'ndgames') {
    const frame = document.getElementById('ndgames-frame');
    if (frame.src === 'about:blank' || !frame.src) frame.src = CONFIG.NDGAMES_URL;
  }
  if ((name === 'nav' || name === 'both') && navInstances[name]) {
    setTimeout(() => navInstances[name].map.resize(), 50);
  }
}
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.goto));
});
document.getElementById('nd-open-tab').addEventListener('click', () => window.open(CONFIG.NDGAMES_URL, '_blank'));

/* =========================================================
   ЧАСЫ (везде)
   ========================================================= */
function tickClock() {
  const d = new Date();
  const s = d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  ['home-clock','clock-nav','clock-sp','clock-both'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = s;
  });
}
tickClock();
setInterval(tickClock, 10000);

/* =========================================================
   ЗАРЯД (везде)
   ========================================================= */
async function pollBattery() {
  let pct = null;
  try {
    const res = await fetch(CONFIG.BATTERY_ENDPOINT);
    if (res.ok) { const data = await res.json(); pct = Math.round(data.battery); }
  } catch (e) {}

  const text = pct === null ? 'н/д' : pct + ' %';
  document.querySelectorAll('.battery-text-nav, .battery-text-both').forEach(el => el.textContent = text);
  document.getElementById('home-battery').textContent = 'Заряд: ' + text;
  document.querySelectorAll('#battery-chip-nav, #battery-chip-both').forEach(chip => {
    chip.classList.toggle('low', pct !== null && pct <= 30 && pct > 15);
    chip.classList.toggle('critical', pct !== null && pct <= 15);
  });
}
pollBattery();
setInterval(pollBattery, CONFIG.BATTERY_POLL_MS);

/* =========================================================
   НАВИГАЦИЯ — фабрика (используется и для nav-view, и для both-view)
   ========================================================= */
const navInstances = {};

/* =========================================================
   ТЕМА КАРТЫ — день/ночь по времени (режим "Авто") или вручную,
   выбор сохраняется в браузере
   ========================================================= */
const THEME_KEY = 'teslaNavThemeMode'; // 'auto' | 'light' | 'dark'
function getThemeMode() { return localStorage.getItem(THEME_KEY) || 'auto'; }
function setThemeMode(mode) { localStorage.setItem(THEME_KEY, mode); applyThemeToAllMaps(); updateThemeButtons(); }
function isDaytimeNow() {
  const h = new Date().getHours();
  return h >= CONFIG.DAY_START_HOUR && h < CONFIG.NIGHT_START_HOUR;
}
function effectiveStyleUrl() {
  const mode = getThemeMode();
  const light = mode === 'light' || (mode === 'auto' && isDaytimeNow());
  return light ? CONFIG.MAP_STYLE_LIGHT : CONFIG.MAP_STYLE_DARK;
}
function applyThemeToAllMaps() {
  const url = effectiveStyleUrl();
  Object.values(navInstances).forEach(inst => inst && inst.setTheme && inst.setTheme(url));
}
function updateThemeButtons() {
  const mode = getThemeMode();
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
}
// раз в 5 минут перепроверяем — вдруг наступило 7:00 или 19:00, пока страница открыта
setInterval(() => { if (getThemeMode() === 'auto') applyThemeToAllMaps(); }, 5 * 60 * 1000);

function createNavController(viewKey, mapElId, els) {
  const map = new maplibregl.Map({
    container: mapElId,
    style: effectiveStyleUrl(),
    center: [CONFIG.START_CENTER[1], CONFIG.START_CENTER[0]], // MapLibre: [lng, lat]
    zoom: CONFIG.START_ZOOM,
    pitch: 0,
    bearing: 0,
    maxPitch: 70,
    attributionControl: { compact: true }
  });

  const state = { carMarker: null, followMode: true, hasRoute: false, trafficOn: false, map, heading: 0, lastFix: null, lastRouteGeojson: null };

  // выполнить fn сразу, если стиль карты уже загружен, иначе — как только загрузится
  function whenReady(fn) { if (map.loaded()) fn(); else map.once('load', fn); }

  // стрелка машины — фиксированной ориентации на экране (когда следуем за собой,
  // разворачивается САМА КАРТА через bearing, поэтому стрелка всегда "смотрит вперёд")
  const carEl = document.createElement('div');
  carEl.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30">' +
    '<path d="M12 2L19 21L12 17L5 21Z" fill="#3ea6ff" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function bearingCalc(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(pos => {
      const { latitude, longitude, heading, speed } = pos.coords;
      const now = Date.now();

      if (!state.carMarker) {
        state.carMarker = new maplibregl.Marker({ element: carEl }).setLngLat([longitude, latitude]).addTo(map);
        state.lastFix = { lat: latitude, lng: longitude, t: now };
        whenReady(() => { if (state.followMode) map.jumpTo({ center: [longitude, latitude], zoom: 17.5, pitch: 60 }); });
        return;
      }

      let targetHeading = state.heading;
      const movedMeters = state.lastFix ? distanceMeters(state.lastFix.lat, state.lastFix.lng, latitude, longitude) : 0;
      if (typeof heading === 'number' && !isNaN(heading) && (speed || 0) > 0.5) {
        targetHeading = heading;
      } else if (movedMeters > 3 && state.lastFix) {
        targetHeading = bearingCalc(state.lastFix.lat, state.lastFix.lng, latitude, longitude);
      }

      state.carMarker.setLngLat([longitude, latitude]);
      state.heading = targetHeading;

      const dt = state.lastFix ? Math.min(Math.max(now - state.lastFix.t, 400), 2000) : 800;
      if (state.followMode) {
        // easeTo сам плавно анимирует центр/поворот/наклон/зум — ручной requestAnimationFrame не нужен
        map.easeTo({ center: [longitude, latitude], bearing: targetHeading, pitch: 60, zoom: Math.max(map.getZoom(), 17), duration: dt, easing: t => t });
      }
      state.lastFix = { lat: latitude, lng: longitude, t: now };
    }, err => console.warn('geolocation error', err), { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
  }

  map.on('dragstart', () => { state.followMode = false; });
  els.locateBtn.addEventListener('click', () => {
    state.followMode = true;
    if (state.carMarker) {
      map.easeTo({ center: state.carMarker.getLngLat(), zoom: Math.max(map.getZoom(), 17), pitch: 60, bearing: state.heading, duration: 600 });
    }
  });

  // трафик от TomTom — отдельный растровый слой поверх векторной карты
  els.trafficBtn.addEventListener('click', () => {
    if (!CONFIG.TOMTOM_API_KEY) { alert('Добавь TOMTOM_API_KEY в CONFIG для слоя пробок'); return; }
    whenReady(() => {
      if (state.trafficOn) {
        if (map.getLayer('traffic-layer')) map.removeLayer('traffic-layer');
        if (map.getSource('traffic-src')) map.removeSource('traffic-src');
        state.trafficOn = false;
        els.trafficBtn.classList.remove('active');
      } else {
        map.addSource('traffic-src', {
          type: 'raster',
          // absolute — красит ВСЕ дороги постоянно по текущей скорости (как Google/Яндекс),
          // а не только явные заторы (так было у relative0 — там пусто, если нет отклонений)
          tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=${CONFIG.TOMTOM_API_KEY}`],
          tileSize: 256
        });
        map.addLayer({ id: 'traffic-layer', type: 'raster', source: 'traffic-src', paint: { 'raster-opacity': 0.9 } });
        state.trafficOn = true;
        els.trafficBtn.classList.add('active');
      }
    });
  });

  // поиск (Nominatim — геокодинг, тот же, что и раньше)
  let searchTimer = null;
  els.searchbox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.searchbox.value.trim();
    if (q.length < 3) { els.results.style.display = 'none'; return; }
    searchTimer = setTimeout(() => doSearch(q), 400);
  });

  async function doSearch(query) {
    try {
      const center = state.carMarker ? state.carMarker.getLngLat() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}` +
        `&limit=6&viewbox=${center.lng-1},${center.lat+1},${center.lng+1},${center.lat-1}&bounded=0`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } });
      renderResults(await res.json());
    } catch (e) { console.error('search failed', e); }
  }

  function renderResults(items) {
    if (!items.length) { els.results.style.display = 'none'; return; }
    els.results.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `<div>${item.display_name.split(',')[0]}</div><div class="result-sub">${item.display_name}</div>`;
      div.addEventListener('click', () => {
        els.results.style.display = 'none';
        els.searchbox.value = item.display_name.split(',')[0];
        routeTo(parseFloat(item.lat), parseFloat(item.lon));
      });
      els.results.appendChild(div);
    });
    els.results.style.display = 'block';
  }

  // маршрут — TomTom Routing API с traffic=true: время в пути считается по живым пробкам,
  // а не по формальным ограничениям скорости, как было у OSRM
  async function routeTo(destLat, destLon) {
    if (!CONFIG.TOMTOM_API_KEY) { alert('Нужен TOMTOM_API_KEY для построения маршрута'); return; }
    const start = state.carMarker ? state.carMarker.getLngLat() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${start.lat},${start.lng}:${destLat},${destLon}/json` +
      `?key=${CONFIG.TOMTOM_API_KEY}&traffic=true&travelMode=car`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes || !data.routes.length) return;
      const route = data.routes[0];
      const coords = route.legs.flatMap(leg => leg.points.map(p => [p.longitude, p.latitude]));

      const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      state.lastRouteGeojson = geojson;
      whenReady(() => {
        if (map.getSource('route-src')) {
          map.getSource('route-src').setData(geojson);
        } else {
          map.addSource('route-src', { type: 'geojson', data: geojson });
          map.addLayer({
            id: 'route-layer', type: 'line', source: 'route-src',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#3ea6ff', 'line-width': 6, 'line-opacity': 0.9 }
          });
        }
        state.hasRoute = true;

        const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
        state.followMode = false;
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, pitch: 0, bearing: 0, duration: 500 });
        els.routeStart.style.display = ''; // новый маршрут выбран — кнопка "Поехали" снова доступна
      });

      const summary = route.summary;
      const mins = Math.round(summary.travelTimeInSeconds / 60);
      const km = (summary.lengthInMeters / 1000).toFixed(1);
      const delayMin = summary.trafficDelayInSeconds ? Math.round(summary.trafficDelayInSeconds / 60) : 0;
      els.routeEta.textContent = mins < 60 ? `${mins} мин` : `${Math.floor(mins/60)} ч ${mins%60} мин`;
      els.routeDist.textContent = delayMin > 0 ? `${km} км · +${delayMin} мин в пробках` : `${km} км`;
      els.routebar.style.display = 'flex';

      // для сравнения — параллельно спрашиваем OSRM (другой источник данных, без TomTom),
      // чтобы наглядно видеть, насколько расходятся оценки на реальных дорогах Грузии
      if (els.routeCompare) {
        els.routeCompare.textContent = 'OSRM: …';
        fetch(`${CONFIG.OSRM_URL}/${start.lng},${start.lat};${destLon},${destLat}?overview=false`)
          .then(r => r.json())
          .then(d => {
            if (d.routes && d.routes[0]) {
              const osrmMin = Math.round(d.routes[0].duration / 60);
              els.routeCompare.textContent = `для сравнения — OSRM: ${osrmMin} мин`;
            } else {
              els.routeCompare.textContent = '';
            }
          })
          .catch(() => { els.routeCompare.textContent = ''; });
      }
    } catch (e) {
      console.error('routing failed', e);
      alert('Не удалось построить маршрут — проверь ключ TomTom и соединение');
    }
  }

  els.routeCancel.addEventListener('click', () => {
    if (map.getLayer && map.getLayer('route-layer')) map.removeLayer('route-layer');
    if (map.getSource && map.getSource('route-src')) map.removeSource('route-src');
    state.hasRoute = false;
    state.lastRouteGeojson = null;
    els.routebar.style.display = 'none';
    if (els.routeCompare) els.routeCompare.textContent = '';
  });

  // "Поехали" — переходим из общего обзора маршрута обратно в наклонённый режим слежения за собой
  els.routeStart.addEventListener('click', () => {
    state.followMode = true;
    els.routeStart.style.display = 'none'; // навигация уже началась — повторно жать нечего
    if (state.carMarker) {
      map.easeTo({ center: state.carMarker.getLngLat(), zoom: 17.5, pitch: 60, bearing: state.heading, duration: 800 });
    }
  });

  // смена темы (день/ночь) — MapLibre при setStyle стирает все наши источники/слои,
  // поэтому после загрузки новой темы переигрываем трафик и маршрут заново
  state.currentStyleUrl = effectiveStyleUrl();
  function setTheme(url) {
    if (url === state.currentStyleUrl) return;
    state.currentStyleUrl = url;
    const hadTraffic = state.trafficOn;
    const routeGeojson = state.lastRouteGeojson;
    map.setStyle(url);
    map.once('style.load', () => {
      if (hadTraffic) {
        map.addSource('traffic-src', {
          type: 'raster',
          tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=${CONFIG.TOMTOM_API_KEY}`],
          tileSize: 256
        });
        map.addLayer({ id: 'traffic-layer', type: 'raster', source: 'traffic-src', paint: { 'raster-opacity': 0.9 } });
      }
      if (routeGeojson) {
        map.addSource('route-src', { type: 'geojson', data: routeGeojson });
        map.addLayer({
          id: 'route-layer', type: 'line', source: 'route-src',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#3ea6ff', 'line-width': 6, 'line-opacity': 0.9 }
        });
      }
    });
  }

  return { map, state, routeTo, doSearch, setTheme };
}

navInstances.nav = createNavController('nav', 'map', {
  locateBtn: document.getElementById('locate-btn-nav'),
  trafficBtn: document.getElementById('traffic-btn-nav'),
  searchbox: document.getElementById('searchbox-nav'),
  results: document.getElementById('results-nav'),
  routebar: document.getElementById('routebar-nav'),
  routeEta: document.getElementById('route-eta-nav'),
  routeDist: document.getElementById('route-dist-nav'),
  routeCompare: document.getElementById('route-compare-nav'),
  routeCancel: document.getElementById('route-cancel-nav'),
  routeStart: document.getElementById('route-start-nav'),
});

navInstances.both = createNavController('both', 'map2', {
  locateBtn: document.getElementById('locate-btn-both'),
  trafficBtn: document.getElementById('traffic-btn-both'),
  searchbox: document.getElementById('searchbox-both'),
  results: document.getElementById('results-both'),
  routebar: document.getElementById('routebar-both'),
  routeEta: document.getElementById('route-eta-both'),
  routeDist: document.getElementById('route-dist-both'),
  routeCompare: document.getElementById('route-compare-both'),
  routeCancel: document.getElementById('route-cancel-both'),
  routeStart: document.getElementById('route-start-both'),
});

/* =========================================================
   НАСТРОЙКИ — переключатель темы карты (Авто/Светлая/Тёмная)
   ========================================================= */
updateThemeButtons();
document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => setThemeMode(btn.dataset.theme));
});
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.add('show');
});
document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.remove('show');
});

/* =========================================================
   SPOTIFY — общее состояние, рендерится в обе вьюхи (fullscreen + dock)
   ========================================================= */
let activeDeviceId = null;

function musicUrl(path) { return `${CONFIG.MUSIC_ENDPOINT}/spotify${path}`; }

function renderNowPlaying(data) {
  const track = data.track || 'Ничего не играет';
  const artist = data.artist || '—';
  const playIcon = data.is_playing ? '⏸' : '▶';
  [['sp-track-full','sp-artist-full','sp-play-full'], ['sp-track-dock','sp-artist-dock','sp-play-dock']].forEach(([t,a,p]) => {
    const tEl = document.getElementById(t), aEl = document.getElementById(a), pEl = document.getElementById(p);
    if (tEl) tEl.textContent = track;
    if (aEl) aEl.textContent = artist;
    if (pEl) pEl.textContent = playIcon;
  });
}

async function pollNowPlaying() {
  try {
    const res = await fetch(musicUrl('/now-playing'));
    const data = await res.json();
    if (!data || (!data.is_playing && !data.track)) return;
    renderNowPlaying(data);
  } catch (e) {}
}
pollNowPlaying();
setInterval(pollNowPlaying, CONFIG.MUSIC_POLL_MS);

['sp-play-full','sp-play-dock'].forEach(id => document.getElementById(id).addEventListener('click', () => musicCmd('toggle')));
['sp-next-full','sp-next-dock'].forEach(id => document.getElementById(id).addEventListener('click', () => musicCmd('next')));
['sp-prev-full','sp-prev-dock'].forEach(id => document.getElementById(id).addEventListener('click', () => musicCmd('prev')));

async function musicCmd(cmd) {
  try { await fetch(musicUrl('/' + cmd), { method: 'POST' }); } catch(e){}
}

async function pickDevice(deviceLabelEl) {
  try {
    const res = await fetch(musicUrl('/devices'));
    const data = await res.json();
    const devices = data.devices || [];
    let dev = devices.find(d => CONFIG.SPOTIFY_PHONE_NAME && d.name === CONFIG.SPOTIFY_PHONE_NAME)
      || devices.find(d => d.type === 'Smartphone')
      || devices.find(d => d.is_active)
      || devices[0];
    if (dev) { activeDeviceId = dev.id; deviceLabelEl.textContent = 'Устройство: ' + dev.name; }
    else deviceLabelEl.textContent = 'Устройство не найдено — открой Spotify на телефоне';
  } catch (e) { deviceLabelEl.textContent = 'Не удалось получить список устройств'; }
}

async function loadPlaylists(gridEl, deviceLabelEl) {
  gridEl.innerHTML = '<div style="color:var(--text-dim)">Загрузка…</div>';
  await pickDevice(deviceLabelEl);
  try {
    const res = await fetch(musicUrl('/playlists'));
    const data = await res.json();
    const items = data.items || [];
    gridEl.innerHTML = '';
    items.forEach(pl => {
      const card = document.createElement('button');
      card.className = gridEl.id === 'dock-pl-list' ? 'dock-card' : 'sp-card';
      card.innerHTML = `<img src="${pl.image || ''}" onerror="this.style.visibility='hidden'"/>
        <div class="name">${pl.name}</div>${gridEl.id === 'dock-pl-list' ? '' : `<div class="count">${pl.tracks_total} треков</div>`}`;
      card.addEventListener('click', () => playPlaylist(pl, card, gridEl));
      gridEl.appendChild(card);
    });
    if (!items.length) gridEl.innerHTML = '<div style="color:var(--text-dim)">Плейлистов не найдено</div>';
  } catch (e) {
    gridEl.innerHTML = '<div style="color:var(--text-dim)">Ошибка загрузки плейлистов</div>';
  }
}

async function playPlaylist(pl, cardEl, gridEl) {
  if (!activeDeviceId) return;
  gridEl.querySelectorAll('.playing').forEach(c => c.classList.remove('playing'));
  cardEl.classList.add('playing');
  try {
    await fetch(musicUrl('/play'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_uri: pl.uri, device_id: activeDeviceId })
    });
  } catch (e) { console.error('play failed', e); }
}

document.getElementById('dock-playlists-btn').addEventListener('click', () => {
  document.getElementById('dock-playlists').classList.add('show');
  loadPlaylists(document.getElementById('dock-pl-list'), document.getElementById('dock-pl-device'));
});
document.getElementById('dock-pl-close').addEventListener('click', () => {
  document.getElementById('dock-playlists').classList.remove('show');
});

/* =========================================================
   ПРИЁМ АДРЕСА С ТЕЛЕФОНА (Google Maps / Яндекс / Waze → "Поделиться")
   ========================================================= */
async function pollDestination() {
  try {
    const res = await fetch('/api/destination');
    const data = await res.json();
    if (!data.destination) return;
    const dest = data.destination;

    // на какую карту прокладывать — активную сейчас, иначе "both"
    const view = document.body.dataset.view;
    const target = (view === 'nav') ? navInstances.nav : navInstances.both;

    if (typeof dest.lat === 'number' && typeof dest.lon === 'number') {
      target.routeTo(dest.lat, dest.lon);
      if (view !== 'nav' && view !== 'both') showView('both');
    } else if (dest.query) {
      const center = target.state.carMarker ? target.state.carMarker.getLngLat() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(dest.query)}&limit=1`;
      const geo = await fetch(url, { headers: { 'Accept-Language': 'ru' } }).then(r => r.json());
      if (geo && geo[0]) {
        target.routeTo(parseFloat(geo[0].lat), parseFloat(geo[0].lon));
        if (view !== 'nav' && view !== 'both') showView('both');
      }
    }
  } catch (e) { /* молчим — нет расшаренного адреса, это нормально */ }
}
setInterval(pollDestination, CONFIG.DESTINATION_POLL_MS);

/* регистрируем service worker — нужен для PWA-шаринга (Android) */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
