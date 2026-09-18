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

  OSRM_URL: "https://router.project-osrm.org/route/v1/driving",

  // Бесплатный ключ на developer.tomtom.com — нужен только для слоя пробок
  TOMTOM_API_KEY: "bCBwNBFLEb8BnlowlbVkpO8YwS2hn222",

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
    setTimeout(() => navInstances[name].map.invalidateSize(), 50);
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

function createNavController(viewKey, mapElId, els) {
  const map = L.map(mapElId, { zoomControl: false, attributionControl: true }).setView(CONFIG.START_CENTER, CONFIG.START_ZOOM);
  document.getElementById(mapElId).classList.add('dark-tiles');

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const carIcon = L.divIcon({
    className: '',
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#3ea6ff;border:3px solid white;box-shadow:0 0 0 4px rgba(62,166,255,0.25)"></div>',
    iconSize: [18,18], iconAnchor:[9,9]
  });

  const state = { carMarker: null, followMode: true, routeLine: null, trafficLayer: null, map };

  if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition(pos => {
      const { latitude, longitude } = pos.coords;
      if (!state.carMarker) state.carMarker = L.marker([latitude, longitude], { icon: carIcon }).addTo(map);
      else state.carMarker.setLatLng([latitude, longitude]);
      if (state.followMode) map.panTo([latitude, longitude], { animate: true });
    }, err => console.warn('geolocation error', err), { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
  }

  map.on('dragstart', () => { state.followMode = false; });
  els.locateBtn.addEventListener('click', () => {
    state.followMode = true;
    if (state.carMarker) map.panTo(state.carMarker.getLatLng());
  });

  // трафик от TomTom (реальные пробки — обычные тайлы OSM их не показывают)
  els.trafficBtn.addEventListener('click', () => {
    if (!CONFIG.TOMTOM_API_KEY) { alert('Добавь TOMTOM_API_KEY в CONFIG для слоя пробок'); return; }
    if (state.trafficLayer) {
      map.removeLayer(state.trafficLayer);
      state.trafficLayer = null;
      els.trafficBtn.classList.remove('active');
    } else {
      state.trafficLayer = L.tileLayer(
        `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${CONFIG.TOMTOM_API_KEY}`,
        { maxZoom: 19, opacity: 0.85 }
      ).addTo(map);
      els.trafficBtn.classList.add('active');
    }
  });

  // поиск
  let searchTimer = null;
  els.searchbox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = els.searchbox.value.trim();
    if (q.length < 3) { els.results.style.display = 'none'; return; }
    searchTimer = setTimeout(() => doSearch(q), 400);
  });

  async function doSearch(query) {
    try {
      const center = state.carMarker ? state.carMarker.getLatLng() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
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

  async function routeTo(destLat, destLon) {
    const start = state.carMarker ? state.carMarker.getLatLng() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
    const url = `${CONFIG.OSRM_URL}/${start.lng},${start.lat};${destLon},${destLat}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes || !data.routes.length) return;
      const route = data.routes[0];

      if (state.routeLine) map.removeLayer(state.routeLine);
      const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
      state.routeLine = L.polyline(coords, { color: '#3ea6ff', weight: 6, opacity: 0.9 }).addTo(map);
      map.fitBounds(state.routeLine.getBounds(), { padding: [60, 60] });
      state.followMode = false;

      const mins = Math.round(route.duration / 60);
      const km = (route.distance / 1000).toFixed(1);
      els.routeEta.textContent = mins < 60 ? `${mins} мин` : `${Math.floor(mins/60)} ч ${mins%60} мин`;
      els.routeDist.textContent = `${km} км`;
      els.routebar.style.display = 'flex';
    } catch (e) { console.error('routing failed', e); }
  }

  els.routeCancel.addEventListener('click', () => {
    if (state.routeLine) { map.removeLayer(state.routeLine); state.routeLine = null; }
    els.routebar.style.display = 'none';
  });

  return { map, state, routeTo, doSearch };
}

navInstances.nav = createNavController('nav', 'map', {
  locateBtn: document.getElementById('locate-btn-nav'),
  trafficBtn: document.getElementById('traffic-btn-nav'),
  searchbox: document.getElementById('searchbox-nav'),
  results: document.getElementById('results-nav'),
  routebar: document.getElementById('routebar-nav'),
  routeEta: document.getElementById('route-eta-nav'),
  routeDist: document.getElementById('route-dist-nav'),
  routeCancel: document.getElementById('route-cancel-nav'),
});

navInstances.both = createNavController('both', 'map2', {
  locateBtn: document.getElementById('locate-btn-both'),
  trafficBtn: document.getElementById('traffic-btn-both'),
  searchbox: document.getElementById('searchbox-both'),
  results: document.getElementById('results-both'),
  routebar: document.getElementById('routebar-both'),
  routeEta: document.getElementById('route-eta-both'),
  routeDist: document.getElementById('route-dist-both'),
  routeCancel: document.getElementById('route-cancel-both'),
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
      const center = target.state.carMarker ? target.state.carMarker.getLatLng() : { lat: CONFIG.START_CENTER[0], lng: CONFIG.START_CENTER[1] };
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
