// Table of registered servers: keeps the state and stats
// of each one while the balancer is running

// How many of the latest requests are used to compute efficiency
const EFFICIENCY_WINDOW = 20;

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
    metrics: null, // last answer from GET /metrics
    metricsError: null,
    results: [], // latest requests: { durationMs, ok }
    stats: {
      requests: 0, // requests sent to this server
      errors: 0, // requests that failed
      active: 0, // requests in progress right now
    },
  }));

  // Efficiency from the latest requests:
  //   successRate   = share of requests that didn't fail (0 to 1)
  //   avgResponseMs = average time of the successful ones
  //   value         = successRate * 1000 / avgResponseMs
  // The value reads as "successful requests per second": a server
  // that answers fast and doesn't fail gets a higher value
  function efficiency(server) {
    const samples = server.results.length;
    if (samples === 0) {
      return { value: null, successRate: null, avgResponseMs: null, samples };
    }

    const ok = server.results.filter((r) => r.ok);
    const successRate = ok.length / samples;
    if (ok.length === 0) {
      return { value: 0, successRate, avgResponseMs: null, samples };
    }

    const totalMs = ok.reduce((sum, r) => sum + r.durationMs, 0);
    // At least 1 ms, so a very fast answer doesn't divide by zero
    const avgResponseMs = Math.max(totalMs / ok.length, 1);
    return {
      value: Number(((successRate * 1000) / avgResponseMs).toFixed(2)),
      successRate: Number(successRate.toFixed(2)),
      avgResponseMs: Math.round(avgResponseMs),
      samples,
    };
  }

  // The 7 criteria from the diagram, with the same names as in config.yaml.
  // Returns null while the server's metrics haven't arrived yet
  function criteria(server) {
    const m = server.metrics;
    if (!m) return null;
    return {
      cpu_speed: m.cpuSpeedGHz,
      ram_total: m.ramTotalMB,
      ram_free: m.ramFreeMB,
      processors: m.processors,
      cores: m.cores,
      active_processes: m.activeProcesses,
      efficiency: efficiency(server).value,
    };
  }

  return {
    efficiency,
    criteria,

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

    // Stores the metrics a server answered.
    // Returns true if they were missing or failing before
    updateMetrics(server, data) {
      const changed = server.metrics === null || server.metricsError !== null;
      server.metrics = { ...data, updatedAt: new Date().toISOString() };
      server.metricsError = null;
      return changed;
    },

    // Records a failed metrics poll. The last metrics are kept.
    // Returns true if they had been working until now
    markMetricsFailed(server, reason) {
      const changed = server.metricsError === null;
      server.metricsError = reason;
      return changed;
    },

    // Records the result of a forwarded request, keeping only the latest ones
    recordResult(server, durationMs, ok) {
      server.results.push({ durationMs, ok });
      if (server.results.length > EFFICIENCY_WINDOW) server.results.shift();
    },
  };
}

module.exports = { createRegistry };
