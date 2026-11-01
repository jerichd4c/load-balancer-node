// Table of registered servers: keeps the state and stats
// of each one while the balancer is running

function createRegistry(servers) {
  const list = servers.map((s) => ({
    id: s.id,
    url: s.url,
    host: s.host,
    port: s.port,
    status: 'UP',
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
  };
}

module.exports = { createRegistry };
