const si = require('systeminformation');

const MB = 1024 * 1024;

// Reads a numeric environment variable; returns null if it is not set
function envNumber(name) {
  const value = process.env[name];
  if (value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

let staticCache = null;

// Static metrics: they don't change while the server is running,
// so they are computed once and cached
async function getStaticMetrics() {
  if (staticCache) return staticCache;

  const [cpu, mem] = await Promise.all([si.cpu(), si.mem()]);

  const real = {
    cpuSpeedGHz: cpu.speed,
    ramTotalMB: Math.round(mem.total / MB),
    processors: cpu.processors,
    cores: cpu.physicalCores,
  };

  const sim = {
    cpuSpeedGHz: envNumber('SIM_CPU_SPEED'),
    ramTotalMB: envNumber('SIM_RAM_TOTAL'),
    processors: envNumber('SIM_PROCESSORS'),
    cores: envNumber('SIM_CORES'),
  };

  staticCache = {
    cpuSpeedGHz: sim.cpuSpeedGHz ?? real.cpuSpeedGHz,
    ramTotalMB: sim.ramTotalMB ?? real.ramTotalMB,
    processors: sim.processors ?? real.processors,
    cores: sim.cores ?? real.cores,
    simulated: Object.values(sim).some((v) => v !== null),
  };

  return staticCache;
}

// Dynamic metrics: they change all the time, so they are computed on every request
async function getDynamicMetrics() {
  const [mem, procs, statics] = await Promise.all([
    si.mem(),
    si.processes(),
    getStaticMetrics(),
  ]);

  // If total RAM is simulated, free RAM is scaled by the same ratio as
  // the real one, so free RAM never exceeds total RAM
  const freeRatio = mem.available / mem.total;

  return {
    ramFreeMB: Math.round(statics.ramTotalMB * freeRatio),
    activeProcesses: procs.all,
  };
}

module.exports = { getStaticMetrics, getDynamicMetrics };