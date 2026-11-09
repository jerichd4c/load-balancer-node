// Load test: sends many requests to the balancer and shows how they
// were distributed among the servers.
// Usage: node scripts/load-test.js [--requests 300] [--concurrency 10]
//                                  [--path /] [--url http://localhost:8080]

const http = require('http');

// Reads "--name value" pairs from the command line
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) {
      throw new Error(`Argumento inválido: ${argv[i]}`);
    }
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

let options;
try {
  const args = parseArgs(process.argv.slice(2));
  options = {
    url: args.url || 'http://localhost:8080',
    path: args.path || '/',
    requests: Number(args.requests) || 300,
    concurrency: Number(args.concurrency) || 10,
  };
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Sends one GET request. Always resolves (never rejects), so a failed
// request is counted as an error instead of stopping the test
function request(path) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(`${options.url}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          server: res.headers['x-served-by'] || null,
          ms: Date.now() - start,
          body,
        });
      });
    });
    req.on('error', (err) => {
      resolve({ status: null, server: null, ms: Date.now() - start, error: err.code || err.message });
    });
  });
}

// Runs `options.requests` requests, at most `options.concurrency` at the same time.
// Each worker takes the next request number until there are none left
async function runLoad() {
  const results = [];
  let next = 0;

  async function worker() {
    while (next < options.requests) {
      next++;
      results.push(await request(options.path));
    }
  }

  const workers = [];
  for (let i = 0; i < options.concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Asks the balancer for its status (algorithm and expected shares)
async function getStatus() {
  const res = await request('/lb/status');
  if (res.status !== 200) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// Groups the results by server: count, average time and slowest request
function summarize(results) {
  const byServer = new Map();
  for (const r of results) {
    if (r.status !== 200) continue;
    const entry = byServer.get(r.server) || { count: 0, totalMs: 0, maxMs: 0 };
    entry.count++;
    entry.totalMs += r.ms;
    entry.maxMs = Math.max(entry.maxMs, r.ms);
    byServer.set(r.server, entry);
  }
  return byServer;
}

// Counts the failed requests by type (HTTP status or network error)
function countErrors(results) {
  const errors = {};
  for (const r of results) {
    if (r.status === 200) continue;
    const key = r.status ? `HTTP ${r.status}` : r.error;
    errors[key] = (errors[key] || 0) + 1;
  }
  return errors;
}

async function main() {
  const before = await getStatus();
  if (!before) {
    console.error(`No se pudo conectar con el balanceador en ${options.url}`);
    process.exit(1);
  }

  console.log(`Balanceador: ${options.url} (algoritmo: ${before.algorithm})`);
  console.log(
    `Enviando ${options.requests} peticiones a ${options.path}, ${options.concurrency} a la vez...\n`
  );

  const start = Date.now();
  const results = await runLoad();
  const totalMs = Date.now() - start;

  // The expected share is read at the end, with the latest metrics
  const after = (await getStatus()) || before;
  const byServer = summarize(results);
  const ok = results.filter((r) => r.status === 200).length;
  const upCount = after.servers.filter((s) => s.status === 'UP').length;

  // Share each server should get: with round_robin every UP server gets
  // the same, with weighted_round_robin it depends on the score
  function expectedShare(s) {
    if (s.status !== 'UP') return '-';
    if (after.algorithm === 'round_robin') return `${Math.round(100 / upCount)}%`;
    return s.scoring ? s.scoring.expectedShare : '-';
  }

  const rows = after.servers.map((s) => {
    const entry = byServer.get(s.id) || { count: 0, totalMs: 0, maxMs: 0 };
    return {
      servidor: s.id,
      estado: s.status,
      peticiones: entry.count,
      '% real': ok ? `${Math.round((entry.count / ok) * 100)}%` : '-',
      '% esperado': expectedShare(s),
      'prom. ms': entry.count ? Math.round(entry.totalMs / entry.count) : '-',
      'máx. ms': entry.count ? entry.maxMs : '-',
    };
  });
  console.table(rows);

  console.log(`Total: ${results.length} peticiones en ${(totalMs / 1000).toFixed(2)} s`);
  console.log(`Rendimiento: ${Math.round(results.length / (totalMs / 1000))} peticiones/s`);
  console.log(`Exitosas: ${ok}`);

  const errors = countErrors(results);
  const errorCount = results.length - ok;
  if (errorCount === 0) {
    console.log('Errores: 0');
  } else {
    const detail = Object.entries(errors)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    console.log(`Errores: ${errorCount} (${detail})`);
  }
}

main();