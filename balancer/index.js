const http = require('http');
const { loadConfig } = require('./config');
const { createRegistry } = require('./registry');
const { createAlgorithm } = require('./algorithms');
const { forward } = require('./proxy');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const registry = createRegistry(config.servers);
const algorithm = createAlgorithm(config.balancer.algorithm);

let requestCount = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

// Balancer status. It lives under /lb/ so it doesn't
// clash with the servers' own routes
function handleStatus(res) {
  sendJson(res, 200, {
    algorithm: algorithm.name,
    totalRequests: requestCount,
    servers: registry.all().map((s) => ({
      id: s.id,
      url: s.url,
      status: s.status,
      ...s.stats,
    })),
  });
}

async function handleProxy(req, res) {
  const reqId = ++requestCount;
  const target = algorithm.pick(registry.available());

  if (!target) {
    console.log(`#${reqId} ${req.method} ${req.url} -> sin servidores disponibles`);
    return sendJson(res, 503, { error: 'No hay servidores disponibles' });
  }

  target.stats.requests++;
  target.stats.active++;

  try {
    const { statusCode, durationMs } = await forward(
      req,
      res,
      target,
      config.balancer.request_timeout_ms
    );
    console.log(`#${reqId} ${req.method} ${req.url} -> ${target.id} ${statusCode} (${durationMs} ms)`);
  } catch (err) {
    target.stats.errors++;
    console.log(`#${reqId} ${req.method} ${req.url} -> ${target.id} ERROR: ${err.code || err.message}`);

    if (!res.headersSent) {
      const status = err.code === 'ETIMEDOUT' ? 504 : 502;
      sendJson(res, status, { error: `Falló el servidor ${target.id}`, detail: err.code || err.message });
    } else {
      res.destroy();
    }
  } finally {
    target.stats.active--;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/lb/status') return handleStatus(res);
  return handleProxy(req, res);
});

server.listen(config.balancer.port, () => {
  console.log(`Balanceador escuchando en http://localhost:${config.balancer.port}`);
  console.log(`Algoritmo: ${algorithm.name}`);
  for (const s of registry.all()) console.log(`  - ${s.id} -> ${s.url}`);
});
