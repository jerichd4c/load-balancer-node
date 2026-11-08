const http = require('http');

// Forwards the client's request to the `target` server and copies the
// response back to the client. Returns a promise that resolves when the
// response finishes, or rejects if the server fails.
// `body` is the request body, already read, so it can be sent again on a retry
function forward(req, res, target, timeoutMs, body) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const proxyReq = http.request(
      {
        hostname: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          host: `${target.host}:${target.port}`,
          'x-forwarded-for': req.socket.remoteAddress || '',
        },
      },
      (proxyRes) => {
        // Add a header so the client can see which server responded
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          'x-served-by': target.id,
        });
        proxyRes.pipe(res);
        proxyRes.on('end', () => {
          resolve({ statusCode: proxyRes.statusCode, durationMs: Date.now() - start });
        });
        proxyRes.on('error', reject);
      }
    );

    // If the server doesn't respond within `timeoutMs`, cut the connection
    proxyReq.setTimeout(timeoutMs, () => {
      const err = new Error(`sin respuesta en ${timeoutMs} ms`);
      err.code = 'ETIMEDOUT';
      proxyReq.destroy(err);
    });

    proxyReq.on('error', reject);

    proxyReq.end(body);
  });
}

module.exports = { forward };
