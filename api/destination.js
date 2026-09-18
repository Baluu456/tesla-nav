const { kvGet, kvSet, kvDel } = require('../lib/kv');

const KEY = 'destination:pending';
const TTL_SECONDS = 300; // если за 5 минут никто не забрал — считаем неактуальным

// Пытаемся вытащить координаты из ссылки/текста разных картографических сервисов.
// Если не получилось — вернём null, и Tesla сама геокодирует текст через Nominatim.
function parseCoords(text) {
  // Яндекс.Карты: ll=41.123456%2C41.654321  (порядок: долгота,широта)
  let m = text.match(/[?&]ll=(-?\d+\.\d+)[,%](?:2C)?(-?\d+\.\d+)/i);
  if (m) return { lat: parseFloat(m[2]), lon: parseFloat(m[1]) };

  // Waze: ll=41.123456,41.654321  (порядок: широта,долгота)
  if (/waze\.com/i.test(text)) {
    const w = text.match(/ll=(-?\d+\.\d+)[,%](?:2C)?(-?\d+\.\d+)/i);
    if (w) return { lat: parseFloat(w[1]), lon: parseFloat(w[2]) };
  }

  // Google Maps: .../@41.123456,41.654321,...z
  const g = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (g) return { lat: parseFloat(g[1]), lon: parseFloat(g[2]) };

  // Google Maps: ?q=41.123456,41.654321
  const q = text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (q) return { lat: parseFloat(q[1]), lon: parseFloat(q[2]) };

  // просто пара чисел "widget,долгота" в тексте
  const bare = text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (bare) return { lat: parseFloat(bare[1]), lon: parseFloat(bare[2]) };

  return null;
}

// Google Maps часто шлёт короткую ссылку (maps.app.goo.gl/...) — координат в ней
// нет, их видно только после редиректа. Разворачиваем её на сервере.
async function resolveShortLink(text) {
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!urlMatch) return text;
  try {
    const res = await fetch(urlMatch[0], { redirect: 'follow' });
    return res.url || text;
  } catch (e) {
    return text;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST') {
    let raw = (req.body && (req.body.text || req.body.url || req.body.title)) || '';
    if (/goo\.gl|maps\.app/i.test(raw)) raw = await resolveShortLink(raw);

    const coords = parseCoords(raw);
    const payload = coords
      ? { lat: coords.lat, lon: coords.lon, label: null, ts: Date.now() }
      : { query: raw.replace(/https?:\/\/\S+/g, '').trim() || raw, ts: Date.now() };

    await kvSet(KEY, payload, TTL_SECONDS);
    return res.json({ ok: true, parsed: payload });
  }

  if (req.method === 'GET') {
    const dest = await kvGet(KEY);
    if (dest) await kvDel(KEY); // отдаём один раз — Tesla уже проложит маршрут
    return res.json({ destination: dest || null });
  }

  res.status(405).end();
};
