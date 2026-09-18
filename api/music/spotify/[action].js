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

    if (req.method === 'GET' && action === 'devices') {
      return res.json(await spotifyFetch('/me/player/devices'));
    }

    if (req.method === 'GET' && action === 'now-playing') {
      const data = await spotifyFetch('/me/player/currently-playing');
      if (!data || !data.item) return res.json({ is_playing: false });
      return res.json({ is_playing: data.is_playing, track: data.item.name, artist: data.item.artists.map(a => a.name).join(', ') });
    }

    if (req.method === 'POST' && action === 'play') {
      const { context_uri, device_id } = req.body;
      await spotifyFetch(`/me/player/play${device_id ? '?device_id=' + device_id : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context_uri ? { context_uri } : {})
      });
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
