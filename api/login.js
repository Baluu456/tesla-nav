const { CLIENT_ID } = require('../lib/spotify');

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

module.exports = (req, res) => {
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI; // например https://tesla-nav.vercel.app/api/callback
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri
  });
  res.writeHead(302, { Location: 'https://accounts.spotify.com/authorize?' + params.toString() });
  res.end();
};
