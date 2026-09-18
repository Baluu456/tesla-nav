const { CLIENT_ID, CLIENT_SECRET, saveTokens } = require('../lib/spotify');

module.exports = async (req, res) => {
  const code = req.query.code;
  if (!code) { res.status(400).send('Нет кода авторизации'); return; }

  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  });
  const data = await tokenRes.json();
  if (!data.access_token) { res.status(400).send('Ошибка обмена токена: ' + JSON.stringify(data)); return; }

  await saveTokens(data);
  res.send('Spotify подключен! Можно закрыть вкладку.');
};
