const { kvGet, kvSet } = require('./kv');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const TOKENS_KEY = 'spotify:tokens';

async function getAccessToken() {
  const tokens = await kvGet(TOKENS_KEY);
  if (!tokens) throw new Error('Не авторизован — открой /api/login один раз');
  if (Date.now() < tokens.expires_at - 30000) return tokens.access_token;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Не удалось обновить токен: ' + JSON.stringify(data));

  const updated = { access_token: data.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
  await kvSet(TOKENS_KEY, updated);
  return updated.access_token;
}

async function saveTokens(data) {
  await kvSet(TOKENS_KEY, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000
  });
}

async function spotifyFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch('https://api.spotify.com/v1' + path, {
    ...options,
    headers: { ...(options.headers || {}), 'Authorization': 'Bearer ' + token }
  });
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = { getAccessToken, saveTokens, spotifyFetch, CLIENT_ID, CLIENT_SECRET };
