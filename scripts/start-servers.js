// Starts the config.yaml servers that run on this machine.
//   node scripts/start-servers.js              -> all of them
//   node scripts/start-servers.js srv-1 srv-3  -> only those

const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('../balancer/config');

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
const SERVER_SCRIPT = path.join(__dirname, '..', 'server', 'index.js');

// Environment variable names read by server/metrics.js
const SIM_ENV = {
  cpu_speed: 'SIM_CPU_SPEED',
  ram_total: 'SIM_RAM_TOTAL',
  processors: 'SIM_PROCESSORS',
  cores: 'SIM_CORES',
};

function buildEnv(server) {
  const env = { ...process.env, PORT: String(server.port), SERVER_ID: server.id };

  // Clear any SIM_* left over in the terminal,
  // so each server only uses its own profile
  for (const name of Object.values(SIM_ENV)) delete env[name];

  for (const [key, value] of Object.entries(server.simulate || {})) {
    env[SIM_ENV[key]] = String(value);
  }
  return env;
}

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const requested = process.argv.slice(2);
  const servers = config.servers.filter(
    (s) => LOCAL_HOSTS.includes(s.host) && (requested.length === 0 || requested.includes(s.id))
  );

  if (servers.length === 0) {
    console.error('No hay servidores locales para levantar con esos ids');
    process.exit(1);
  }

  const children = servers.map((server) => {
    const child = spawn(process.execPath, [SERVER_SCRIPT], {
      env: buildEnv(server),
      stdio: 'inherit',
    });
    child.on('exit', (code, signal) => {
      console.log(`[${server.id}] terminó (code=${code}, signal=${signal})`);
    });
    return child;
  });

  // Ctrl+C also shuts down every server
  process.on('SIGINT', () => {
    for (const child of children) child.kill();
    process.exit(0);
  });
}

main();