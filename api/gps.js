/**
 * Приём и выдача координат с телефона — запасной источник GPS,
 * если у машины (navigator.geolocation в браузере Tesla) не завелось.
 * Телефон шлёт сюда координаты каждые пару секунд (см. gps.html),
 * Tesla их забирает, только если свой GPS не сработал.
 */
const { kvGet, kvSet } = require('../lib/kv');

const KEY = 'gps:phone';
const TTL_SECONDS = 15; // если телефон перестал слать больше 15 сек — считаем сигнал неактуальным

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'POST') {
    const { lat, lon, heading, speed } = req.body || {};
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'lat/lon обязательны' });
    }
    await kvSet(KEY, { lat, lon, heading: heading ?? null, speed: speed ?? null, ts: Date.now() }, TTL_SECONDS);
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    const data = await kvGet(KEY);
    return res.json({ position: data || null });
  }

  res.status(405).end();
};
