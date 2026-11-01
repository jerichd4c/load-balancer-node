const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_PATH = path.join(__dirname, '..', 'config.yaml');

const ALGORITHMS = ['round_robin', 'weighted_round_robin'];

const CRITERIA = [
  'cpu_speed',
  'ram_total',
  'ram_free',
  'processors',
  'cores',
  'active_processes',
  'efficiency',
];

const SIMULABLE = ['cpu_speed', 'ram_total', 'processors', 'cores'];

// Defaults for any value missing from the YAML
const BALANCER_DEFAULTS = {
  port: 8080,
  algorithm: 'weighted_round_robin',
  metrics_interval_ms: 5000,
  metrics_timeout_ms: 4000,
  health_interval_ms: 2000,
  health_timeout_ms: 1000,
  failures_to_down: 3,
  request_timeout_ms: 15000,
  max_retries: 1,
};

function fail(message) {
  throw new Error(`config.yaml: ${message}`);
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateBalancer(raw = {}) {
  const balancer = { ...BALANCER_DEFAULTS, ...raw };

  if (!ALGORITHMS.includes(balancer.algorithm)) {
    fail(`algorithm "${balancer.algorithm}" no es válido (usa: ${ALGORITHMS.join(', ')})`);
  }

  for (const [key, value] of Object.entries(balancer)) {
    if (key === 'algorithm') continue;
    if (!isNumber(value) || value < 0) fail(`balancer.${key} debe ser un número >= 0`);
  }

  return balancer;
}

function validateWeights(raw) {
  if (!raw || typeof raw !== 'object') fail('falta la sección "weights"');

  for (const key of Object.keys(raw)) {
    if (!CRITERIA.includes(key)) fail(`weights.${key} no es un criterio conocido`);
  }

  const weights = {};
  for (const key of CRITERIA) {
    const value = raw[key];
    if (!isNumber(value) || value < 0) fail(`weights.${key} debe ser un número >= 0`);
    weights[key] = value;
  }

  // Allow a small floating-point error
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 0.001) fail(`los pesos deben sumar 1 (suman ${sum.toFixed(3)})`);

  return weights;
}

function validateSimulate(raw, id) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') fail(`servers.${id}.simulate debe ser un objeto`);

  for (const [key, value] of Object.entries(raw)) {
    if (!SIMULABLE.includes(key)) fail(`servers.${id}.simulate.${key} no se puede simular`);
    if (!isNumber(value) || value <= 0) fail(`servers.${id}.simulate.${key} debe ser un número > 0`);
  }

  return { ...raw };
}

function validateServers(raw) {
  if (!Array.isArray(raw) || raw.length === 0) fail('debe haber al menos un servidor en "servers"');

  const ids = new Set();

  return raw.map((server, i) => {
    const id = server && server.id;
    if (typeof id !== 'string' || id.trim() === '') fail(`servers[${i}] no tiene "id"`);
    if (ids.has(id)) fail(`el id "${id}" está repetido`);
    ids.add(id);

    let parsed;
    try {
      parsed = new URL(server.url);
    } catch {
      fail(`servers.${id}.url "${server.url}" no es una URL válida`);
    }
    if (parsed.protocol !== 'http:') fail(`servers.${id}.url debe empezar con http://`);

    return {
      id,
      url: parsed.origin,
      host: parsed.hostname,
      port: Number(parsed.port) || 80,
      simulate: validateSimulate(server.simulate, id),
    };
  });
}

// Reads the YAML, validates it and returns the normalized config.
// Throws an error with a clear message if anything is wrong.
function loadConfig(filePath = process.env.LB_CONFIG || DEFAULT_PATH) {
  let raw;
  try {
    raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`no se pudo leer ${filePath} (${err.message})`);
  }
  if (!raw || typeof raw !== 'object') fail('el archivo está vacío');

  return {
    balancer: validateBalancer(raw.balancer),
    weights: validateWeights(raw.weights),
    servers: validateServers(raw.servers),
  };
}

module.exports = { loadConfig, CRITERIA };
