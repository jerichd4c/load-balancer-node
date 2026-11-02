const http = require('http');

// Makes a GET request and parses the JSON response.
// Rejects on network errors, timeouts or non-2xx status codes.
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('la respuesta no es JSON válido'));
        }
      });
      res.on('error', reject);
    });

    req.setTimeout(timeoutMs, () => {
      const err = new Error(`sin respuesta en ${timeoutMs} ms`);
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });

    req.on('error', reject);
  });
}

module.exports = { getJson };
