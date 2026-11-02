const { getJson } = require('./http-client');

// Periodically calls GET /health on every server and marks it UP or DOWN.
// Only state changes are logged, so the console doesn't fill up.
function startHealthChecks(registry, { intervalMs, timeoutMs }) {
  // Servers whose previous check hasn't finished yet
  const inFlight = new Set();

  async function checkServer(server) {
    if (inFlight.has(server.id)) return;
    inFlight.add(server.id);

    try {
      await getJson(`${server.url}/health`, timeoutMs);
      if (registry.markHealthy(server)) {
        console.log(`[health] ${server.id} UP`);
      }
    } catch (err) {
      const reason = err.code || err.message;
      if (registry.markUnhealthy(server, reason)) {
        console.log(`[health] ${server.id} DOWN (${server.failures} fallos seguidos: ${reason})`);
      }
    } finally {
      inFlight.delete(server.id);
    }
  }

  function checkAll() {
    for (const server of registry.all()) checkServer(server);
  }

  // First round right away, so servers don't wait a full interval to come UP
  checkAll();
  return setInterval(checkAll, intervalMs);
}

module.exports = { startHealthChecks };
