const { getJson } = require('./http-client');

// Periodically calls GET /metrics on every UP server and stores the result.
// Only changes are logged (metrics received / metrics failing).
function startMetricsPolling(registry, { intervalMs, timeoutMs }) {
  // Servers whose previous poll hasn't finished yet
  const inFlight = new Set();

  async function pollServer(server) {
    if (inFlight.has(server.id)) return;
    inFlight.add(server.id);

    try {
      const data = await getJson(`${server.url}/metrics`, timeoutMs);
      if (registry.updateMetrics(server, data)) {
        console.log(`[metrics] ${server.id} métricas recibidas`);
      }
    } catch (err) {
      const reason = err.code || err.message;
      if (registry.markMetricsFailed(server, reason)) {
        console.log(`[metrics] ${server.id} no respondió las métricas: ${reason}`);
      }
    } finally {
      inFlight.delete(server.id);
    }
  }

  function pollAll() {
    // A DOWN server can't answer, so it isn't asked.
    // It keeps its last metrics until it comes back UP
    for (const server of registry.available()) pollServer(server);
  }

  pollAll();
  return setInterval(pollAll, intervalMs);
}

module.exports = { startMetricsPolling };
