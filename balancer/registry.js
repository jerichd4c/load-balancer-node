// Table of registered servers: keeps the state and stats
// of each one while the balancer is running

function createRegistry(servers, failuresToDown) {
  const list = servers.map((s) => ({
    id: s.id,
    url: s.url,
    host: s.host,
    port: s.port,
    // Every server starts DOWN until its first health check passes
    status: 'DOWN',
    failures: 0, // consecutive failed health checks
    lastError: null,
    stats: {
      requests: 0, // requests sent to this server
      errors: 0, // requests that failed
      active: 0, // requests in progress right now
    },
  }));

  return {
    all() {
      return list;
    },

    // Servers that can receive requests
    available() {
      return list.filter((s) => s.status === 'UP');
    },

    // Records a passed health check.
    // Returns true if the server just changed to UP
    markHealthy(server) {
      server.failures = 0;
      server.lastError = null;
      if (server.status === 'UP') return false;
      server.status = 'UP';
      return true;
    },

    // Records a failed health check.
    // Returns true if the server just changed to DOWN
    markUnhealthy(server, reason) {
      server.failures++;
      server.lastError = reason;
      if (server.status === 'DOWN' || server.failures < failuresToDown) return false;
      server.status = 'DOWN';
      return true;
    },
  };
}

module.exports = { createRegistry };
