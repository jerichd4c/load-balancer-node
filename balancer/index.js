const http = require('http');
const { loadConfig } = require('./config');
const { createRegistry } = require('./registry');
const { createAlgorithm } = require('./algorithms');
const { forward } = require('./proxy');
const { startHealthChecks } = require('./health');
const { startMetricsPolling } = require('./metrics');
const { computeScores } = require('./score');

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const registry = createRegistry(config.servers, config.balancer.failures_to_down);
const algorithm = createAlgorithm(config.balancer.algorithm, {
  weights: config.weights,
  criteriaOf: registry.criteria,
});

let requestCount = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

// Rounds to 3 decimals, so /lb/status is easier to read
const round = (n) => Number(n.toFixed(3));

// Score of each available server and the share of traffic it should get
// with weighted_round_robin. DOWN servers have no score
function scoreSummary() {
  const scored = computeScores(registry.available(), config.weights, registry.criteria);
  const total = scored.reduce((sum, s) => sum + s.score, 0);
  const summary = new Map();

  for (const { server, score, parts } of scored) {
    summary.set(server.id, {
      score: round(score),
      expectedShare: `${Math.round((score / total) * 100)}%`,
      parts: Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, round(value)])),
    });
  }
  return summary;
}

// Balancer status. It lives under /lb/ so it doesn't
// clash with the servers' own routes
function handleStatus(res) {
  const scores = scoreSummary();

  sendJson(res, 200, {
    algorithm: algorithm.name,
    totalRequests: requestCount,
    servers: registry.all().map((s) => ({
      id: s.id,
      url: s.url,
      status: s.status,
      failures: s.failures,
      lastError: s.lastError,
      ...s.stats,
      criteria: registry.criteria(s),
      efficiency: registry.efficiency(s),
      metricsUpdatedAt: s.metrics ? s.metrics.updatedAt : null,
      metricsError: s.metricsError,
      scoring: scores.get(s.id) || null,
    })),
  });
}

// Reads the whole request body. It has to be kept in memory because
// a stream can only be read once, and a retry needs to send it again
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Sends the request to one server and updates its stats.
// Returns null if it worked, or the error if it failed
async function tryServer(req, res, target, body, label) {
  target.stats.requests++;
  target.stats.active++;
  const start = Date.now();

  try {
    const { statusCode, durationMs } = await forward(
      req,
      res,
      target,
      config.balancer.request_timeout_ms,
      body
    );
    // A 5xx answer means the server failed, even though it responded
    registry.recordResult(target, durationMs, statusCode < 500);
    console.log(`${label} -> ${target.id} ${statusCode} (${durationMs} ms)`);
    return null;
  } catch (err) {
    target.stats.errors++;
    registry.recordResult(target, Date.now() - start, false);
    console.log(`${label} -> ${target.id} ERROR: ${err.code || err.message}`);
    return err;
  } finally {
    target.stats.active--;
  }
}

async function handleProxy(req, res) {
  const reqId = ++requestCount;
  const label = `#${reqId} ${req.method} ${req.url}`;

  let body;
  try {
    body = await readBody(req);
  } catch {
    // The client closed the connection before sending everything
    return;
  }

  // First attempt + retries, each one on a server that hasn't been tried yet
  const maxAttempts = 1 + config.balancer.max_retries;
  const tried = [];
  let lastError = null;

  while (tried.length < maxAttempts) {
    const candidates = registry.available().filter((s) => !tried.includes(s));
    const target = algorithm.pick(candidates);
    if (!target) break;
    tried.push(target);

    const attemptLabel = tried.length > 1 ? `${label} [reintento ${tried.length - 1}]` : label;
    lastError = await tryServer(req, res, target, body, attemptLabel);
    if (!lastError) return;

    // If the server had already started answering, part of the response
    // reached the client and the request can't be retried anymore
    if (res.headersSent) return res.destroy();
  }

  // No server was available from the start
  if (tried.length === 0) {
    console.log(`${label} -> sin servidores disponibles`);
    return sendJson(res, 503, { error: 'No hay servidores disponibles' });
  }

  // Every attempt failed
  const status = lastError.code === 'ETIMEDOUT' ? 504 : 502;
  sendJson(res, status, {
    error: 'Fallaron todos los intentos',
    tried: tried.map((s) => s.id),
    detail: lastError.code || lastError.message,
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/lb/status') return handleStatus(res);
  return handleProxy(req, res);
});

server.listen(config.balancer.port, () => {
  console.log(`Balanceador escuchando en http://localhost:${config.balancer.port}`);
  console.log(`Algoritmo: ${algorithm.name}`);
  for (const s of registry.all()) console.log(`  - ${s.id} -> ${s.url}`);

  startHealthChecks(registry, {
    intervalMs: config.balancer.health_interval_ms,
    timeoutMs: config.balancer.health_timeout_ms,
  });

  startMetricsPolling(registry, {
    intervalMs: config.balancer.metrics_interval_ms,
    timeoutMs: config.balancer.metrics_timeout_ms,
  });
});
