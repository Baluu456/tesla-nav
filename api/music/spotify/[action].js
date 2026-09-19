const { spotifyFetch } = require('../../../lib/spotify');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action } = req.query;

  try {
    if (req.method === 'GET' && action === 'playlists') {
      const data = await spotifyFetch('/me/playlists?limit=50');
      return res.json({ items: (data.items || []).map(p => ({
        id: p.id, name: p.name, uri: p.uri,
        image: p.images && p.images[0] ? p.images[0].url : null,
        tracks_total: p.tracks ? p.tracks.total : 0
      })) });
    }

    // список треков конкретного плейлиста — для экрана "открыть плейлист"
    if (req.method === 'GET' && action === 'playlist-tracks') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'нужен id плейлиста' });
      const data = await spotifyFetch(
        `/playlists/${id}/tracks?limit=100&fields=total,items(track(name,uri,duration_ms,artists(name)))`
      );
      const items = (data.items || [])
        .filter(it => it.track) // выкидываем удалённые/недоступные треки
        .map(it => ({
          uri: it.track.uri,
          name: it.track.name,
          artist: (it.track.artists || []).map(a => a.name).join(', '),
        }));
      return res.json({ total: data.total, items });
    }

    if (req.method === 'GET' && action === 'devices') {
      return res.json(await spotifyFetch('/me/player/devices'));
    }

    if (req.method === 'GET' && action === 'now-playing') {
      const data = await spotifyFetch('/me/player/currently-playing');
      if (!data || !data.item) return res.json({ is_playing: false });
      return res.json({ is_playing: data.is_playing, track: data.item.name, artist: data.item.artists.map(a => a.name).join(', ') });
    }

    // { context_uri, device_id, track_uri? } — если передан track_uri, стартуем именно с него,
    // а не с начала плейлиста
    if (req.method === 'POST' && action === 'play') {
      const { context_uri, device_id, track_uri } = req.body;
      const body = {};
      if (context_uri) body.context_uri = context_uri;
      if (track_uri) body.offset = { uri: track_uri };
      await spotifyFetch(`/me/player/play${device_id ? '?device_id=' + device_id : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json({ ok: true });
    }

    // { state: true|false, device_id }
    if (req.method === 'POST' && action === 'shuffle') {
      const { state, device_id } = req.body;
      await spotifyFetch(`/me/player/shuffle?state=${!!state}${device_id ? '&device_id=' + device_id : ''}`, { method: 'PUT' });
      return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'toggle') {
      const current = await spotifyFetch('/me/player/currently-playing');
      const isPlaying = current && current.is_playing;
      await spotifyFetch(`/me/player/${isPlaying ? 'pause' : 'play'}`, { method: 'PUT' });
      return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'next') {
      await spotifyFetch('/me/player/next', { method: 'POST' });
      return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'prev') {
      await spotifyFetch('/me/player/previous', { method: 'POST' });
      return res.json({ ok: true });
    }

    res.status(404).json({ error: 'unknown action' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
