// scripts/google-oauth-setup.js
// One-time helper to obtain a Google OAuth2 refresh token for Drive access.
// Usage:
//   node scripts/google-oauth-setup.js
// Then open the printed URL, authorize, and paste the code back.

require('dotenv').config();
const http = require('http');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3001/oauth2callback';
const SCOPES = ['https://www.googleapis.com/auth/drive'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('Open this URL in your browser and authorize the app:');
console.log(authUrl);
console.log('');
console.log('Waiting for callback on', REDIRECT_URI);

const url = new URL(REDIRECT_URI);
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith(url.pathname)) {
    res.end('Not found');
    return;
  }
  const code = new URL(req.url, REDIRECT_URI).searchParams.get('code');
  if (!code) {
    res.end('Missing code');
    return;
  }
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\nRefresh token (store in .env as GOOGLE_OAUTH_REFRESH_TOKEN):');
    console.log(tokens.refresh_token || tokens.access_token);
    res.end('Authorization complete. You can close this window.');
  } catch (err) {
    console.error('Token exchange failed:', err.message);
    res.end('Token exchange failed.');
  } finally {
    server.close();
  }
});

server.listen(parseInt(url.port || '3001', 10), () => {
  console.log('Callback server listening...');
});