const https = require('https');

const TOKEN_KEY    = 'bd07583225f23e47137ef98f15851eca';
const TOKEN_SECRET = 'd98e90b24cbd19e5bfb94b4dc8bb3b8ff2249c57';

require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.url === '/myip') {
    https.get('https://api4.ipify.org?format=json', r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { res.writeHead(200,{'Content-Type':'application/json'}); res.end(d); });
    });
    return;
  }

  if (req.method !== 'POST') { res.writeHead(405); return res.end('Method not allowed'); }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch(e) { res.writeHead(400); return res.end('Bad JSON'); }

    const payload = JSON.stringify({
      methodName: parsed.methodName,
      params: { token_key: TOKEN_KEY, token_secret: TOKEN_SECRET, ...(parsed.params || {}) }
    });

    const options = {
      hostname: 'web.streamlinevrs.com',
      path: '/api/json',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const preq = https.request(options, pr => {
      let data = '';
      pr.on('data', c => data += c);
      pr.on('end', () => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(data); });
    });
    preq.on('error', e => { res.writeHead(500); res.end(JSON.stringify({error: e.message})); });
    preq.write(payload);
    preq.end();
  });
}).listen(process.env.PORT || 3000, () => console.log('Proxy running'));
