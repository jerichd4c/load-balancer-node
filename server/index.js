const http = require('http');
const { getStaticMetrics, getDynamicMetrics } = require('./metrics');

const PORT = Number(process.env.PORT) || 3001;
const ID = process.env.SERVER_ID || `srv-${PORT}`;
const MAX_WORK_MS = 10000;

// Requests this server is handling right now
let activeRequests = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Burns CPU for `ms` milliseconds, in 10 ms chunks.
// Between chunks it yields the event loop, so the server can
// keep answering /health and /metrics while it works
function burnCpu(ms) {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    function chunk() {
      const sliceEnd = Math.min(Date.now() + 10, end);
      while (Date.now() < sliceEnd) {
        // busy wait: this is exactly what burns CPU
      }
      if (Date.now() < end) setImmediate(chunk);
      else resolve();
    }
    chunk();
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método no permitido' });
  }

  switch (url.pathname) {
    case '/':
      return sendJson(res, 200, {
        server: ID,
        port: PORT,
        pid: process.pid,
        time: new Date().toISOString(),
      });

    case '/work': {
      const requested = Number(url.searchParams.get('ms')) || 100;
      const ms = Math.min(Math.max(requested, 0), MAX_WORK_MS);
      const start = Date.now();
      await burnCpu(ms);
      return sendJson(res, 200, {
        server: ID,
        workedMs: Date.now() - start,
      });
    }

    case '/health':
      return sendJson(res, 200, { server: ID, status: 'UP' });

    case '/metrics': {
      const [statics, dynamics] = await Promise.all([
        getStaticMetrics(),
        getDynamicMetrics(),
      ]);
      return sendJson(res, 200, {
        server: ID,
        ...statics,
        ...dynamics,
        activeRequests,
      });
    }

    default:
      return sendJson(res, 404, { error: 'Ruta no encontrada' });
  }
}

const server = http.createServer(async (req, res) => {
  activeRequests++;
  res.on('close', () => activeRequests--);

  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error(`[${ID}] Error:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error interno' });
  }
});

server.listen(PORT, () => {
  console.log(`[${ID}] escuchando en http://localhost:${PORT}`);
});
