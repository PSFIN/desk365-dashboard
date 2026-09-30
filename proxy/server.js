const https = require('https');
const dns   = require('dns');

// Force IPv4 so Streamline whitelist works (IPv6 is blocked)
dns.setDefaultResultOrder('ipv4first');

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
    }).on('error', e => { res.writeHead(500); res.end(JSON.stringify({error:e.message})); });
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

    // Resolve to IPv4 explicitly before connecting
    dns.resolve4('web.streamlinevrs.com', (err, addresses) => {
      if (err || !addresses || !addresses.length) {
        res.writeHead(502);
        return res.end(JSON.stringify({error: 'DNS resolution failed: ' + (err ? err.message : 'no addresses')}));
      }

      const options = {
        host: addresses[0],           // IPv4 address directly
        hostname: 'web.streamlinevrs.com',
        path: '/api/json',
        method: 'POST',
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Host': 'web.streamlinevrs.com'
        }
      };

      const preq = https.request(options, pr => {
        let data = '';
        pr.on('data', c => data += c);
        pr.on('end', () => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(data); });
      });
      preq.on('timeout', () => {
        preq.destroy();
        res.writeHead(504);
        res.end(JSON.stringify({error:'Streamline API timed out'}));
      });
      preq.on('error', e => {
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({error: e.message})); }
      });
      preq.write(payload);
      preq.end();
    });
  });
}).listen(process.env.PORT || 3000, () => console.log('Proxy running'));
