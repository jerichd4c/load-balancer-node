// Turns the 7 criteria of each server into a single score from 0 to 1

const { CRITERIA } = require('./config');

// Criteria where a lower value is better
const LOWER_IS_BETTER = ['active_processes'];

// Value given to a criterion a server doesn't have yet
// (metrics not received, or no requests to measure efficiency)
const NEUTRAL = 0.5;

// Compares the servers with each other on one criterion and
// turns each value into a number from 0 to 1:
//   higher is better: value / highest value
//   lower is better:  lowest value / value
// The best server gets 1 and the rest get their proportion
function normalize(values, lowerIsBetter) {
  const known = values.filter((v) => typeof v === 'number');
  if (known.length === 0) return values.map(() => NEUTRAL);

  const max = Math.max(...known);
  const min = Math.min(...known);

  return values.map((v) => {
    if (typeof v !== 'number') return NEUTRAL;
    if (lowerIsBetter) return v > 0 ? min / v : 1;
    return max > 0 ? v / max : 1;
  });
}

// Computes the score of each server:
//   score = sum of (criterion weight * normalized criterion)
// Since the weights add up to 1, the score goes from 0 to 1.
// `criteriaOf(server)` returns the 7 criteria, or null if there are no metrics yet
function computeScores(servers, weights, criteriaOf) {
  const rows = servers.map((s) => criteriaOf(s) || {});
  const parts = servers.map(() => ({}));

  for (const name of CRITERIA) {
    const values = rows.map((row) => row[name] ?? null);
    const normalized = normalize(values, LOWER_IS_BETTER.includes(name));
    normalized.forEach((value, i) => {
      parts[i][name] = value;
    });
  }

  return servers.map((server, i) => {
    let score = 0;
    for (const name of CRITERIA) score += weights[name] * parts[i][name];
    return { server, score, parts: parts[i] };
  });
}

module.exports = { computeScores };
