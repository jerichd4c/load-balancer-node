// Selection algorithms. Each one exposes pick(servers),
// which receives the available servers and returns the chosen one

const { computeScores } = require('./score');

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

// Smooth weighted round robin (the one nginx uses), with each
// server's score as its weight. On every pick:
//   1. every server adds its weight to its counter
//   2. the server with the highest counter is chosen
//   3. the chosen one subtracts the sum of all weights from its counter
// A server with twice the weight is chosen twice as often, but its
// turns are spread out (A B A C A B...) instead of in a row (A A B C)
function createWeightedRoundRobin({ weights, criteriaOf }) {
  const counters = new Map(); // server id -> counter

  return {
    name: 'weighted_round_robin',
    pick(servers) {
      if (servers.length === 0) return null;

      // Scores are computed on every pick, so they always use the latest metrics
      const scored = computeScores(servers, weights, criteriaOf);
      const total = scored.reduce((sum, s) => sum + s.score, 0);

      // A server that went DOWN loses its counter, so it doesn't
      // come back with an old advantage
      const ids = new Set(servers.map((s) => s.id));
      for (const id of counters.keys()) {
        if (!ids.has(id)) counters.delete(id);
      }

      let chosen = null;
      for (const { server, score } of scored) {
        const counter = (counters.get(server.id) || 0) + score;
        counters.set(server.id, counter);
        if (!chosen || counter > counters.get(chosen.id)) chosen = server;
      }

      counters.set(chosen.id, counters.get(chosen.id) - total);
      return chosen;
    },
  };
}

// `options` is only used by weighted_round_robin:
//   weights:    the criteria weights from config.yaml
//   criteriaOf: function that returns the 7 criteria of a server
function createAlgorithm(name, options) {
  switch (name) {
    case 'round_robin':
      return createRoundRobin();
    case 'weighted_round_robin':
      return createWeightedRoundRobin(options);
    default:
      throw new Error(`Algoritmo desconocido: ${name}`);
  }
}

module.exports = { createAlgorithm };
