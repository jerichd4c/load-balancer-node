// Selection algorithms. Each one exposes pick(servers),
// which receives the available servers and returns the chosen one

function createRoundRobin() {
  let index = 0;

  return {
    name: 'round_robin',
    pick(servers) {
      if (servers.length === 0) return null;
      // The modulo keeps the index inside the array if the list
      // changed size (for example, when a server goes down)
      const server = servers[index % servers.length];
      index = (index + 1) % servers.length;
      return server;
    },
  };
}

function createAlgorithm(name) {
  switch (name) {
    case 'round_robin':
      return createRoundRobin();
    case 'weighted_round_robin':
      // Implemented in a later step
      console.warn('weighted_round_robin aún no está implementado, se usa round_robin');
      return createRoundRobin();
    default:
      throw new Error(`Algoritmo desconocido: ${name}`);
  }
}

module.exports = { createAlgorithm };
