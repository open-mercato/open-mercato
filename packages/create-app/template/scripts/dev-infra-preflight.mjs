// Docker preflight + health-waited infra startup shared by the monorepo starter
// (`yarn setup`, `yarn infra:up`) and generated apps (`yarn setup`,
// `yarn infra:up`). Node stdlib only and free of sibling imports:
// `yarn template:sync` mirrors this file byte-for-byte to
// packages/create-app/template/scripts/dev-infra-preflight.mjs, where no
// `packages/starter` directory exists.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'

export const INFRA_PROBE_TIMEOUT_MS = 20_000
export const NO_INFRA_FLAG = '--no-infra'

export function runDockerProbe(args, { spawnSyncImpl = spawnSync, timeout = INFRA_PROBE_TIMEOUT_MS } = {}) {
  return spawnSyncImpl('docker', args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function firstOutputLine(result) {
  const text = `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
}

// Order matters: the CLI and the compose plugin answer without a daemon, so a
// stopped engine is only reported once both are known to exist.
export function detectDockerRuntime({ probe = runDockerProbe } = {}) {
  const cli = probe(['--version'])
  if (cli?.error || cli?.status !== 0) {
    return { ok: false, code: 'cli-missing', detail: 'docker CLI not found' }
  }
  const compose = probe(['compose', 'version'])
  if (compose?.error || compose?.status !== 0) {
    return { ok: false, code: 'compose-missing', detail: 'docker compose v2 plugin not found' }
  }
  const engine = probe(['info', '--format', '{{.ServerVersion}}'])
  if (engine?.error?.code === 'ETIMEDOUT') {
    return { ok: false, code: 'daemon-unresponsive', detail: 'docker engine did not respond in time' }
  }
  if (engine?.error || engine?.status !== 0) {
    const output = firstOutputLine(engine)
    if (/permission denied/i.test(output)) {
      return { ok: false, code: 'daemon-permission', detail: 'no permission to talk to the docker engine' }
    }
    return { ok: false, code: 'daemon-stopped', detail: 'docker engine not running' }
  }
  return { ok: true, code: 'ok', serverVersion: String(engine.stdout ?? '').trim() }
}

// `compose ps --format json` prints NDJSON on compose >= 2.21 and a JSON array
// on older releases — tolerate both.
export function parseComposePsOutput(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return []
    }
  }
  const entries = []
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Ignore non-JSON noise lines.
    }
  }
  return entries
}

export function runningComposeServices(entries) {
  return new Set(entries.filter((entry) => entry?.State === 'running').map((entry) => entry.Service).filter(Boolean))
}

// Services `compose up --wait` gave up on: missing, not running, or running
// with a failing healthcheck. A service without a healthcheck reports an empty
// Health and counts as ready once it runs.
export function findUnhealthyServices(entries, required) {
  const byService = new Map(entries.filter((entry) => entry?.Service).map((entry) => [entry.Service, entry]))
  const unhealthy = []
  for (const service of required) {
    const entry = byService.get(service)
    if (!entry) {
      unhealthy.push({ service, state: 'missing', health: '' })
      continue
    }
    const state = entry.State ?? 'unknown'
    const health = entry.Health ?? ''
    if (state !== 'running' || (health && health !== 'healthy')) unhealthy.push({ service, state, health })
  }
  return unhealthy
}

// Host-side probes use 127.0.0.1, never `localhost` (modern Windows resolves
// `localhost` to ::1 first while published container ports listen on IPv4).
export function probeTcpPort(port, { host = '127.0.0.1', timeoutMs = 750 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const closed = () => {
      socket.destroy()
      resolve(false)
    }
    socket.once('timeout', closed)
    socket.once('error', closed)
  })
}

// Only ports of services that are NOT already running in this compose project
// can conflict: our own running containers legitimately own theirs.
export async function findPortConflicts(services, { running = new Set(), probe = probeTcpPort } = {}) {
  const conflicts = []
  for (const entry of services) {
    if (running.has(entry.service)) continue
    if (await probe(entry.port)) conflicts.push(entry)
  }
  return conflicts
}

// WSL2 reports platform 'linux', but its usual Docker is Docker Desktop on the
// Windows side, exposed to the distribution through "WSL integration". Telling
// a WSL user to install Docker Engine would put a second engine next to it.
export function detectWsl({ env = process.env, readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  try {
    return /microsoft/i.test(readFile('/proc/version'))
  } catch {
    return false
  }
}

const WSL_INTEGRATION_HINT = 'Inside WSL: open Docker Desktop on Windows -> Settings -> Resources -> WSL integration, enable it for this distribution, then open a new terminal. (Only install Docker Engine inside WSL if you do not use Docker Desktop.)'

function remediationFor(problem, platform, { wsl = false, databaseUrlFile = '.env', portConflictHints = [] } = {}) {
  switch (problem.code) {
    case 'cli-missing':
      return [
        wsl
          ? WSL_INTEGRATION_HINT
          : platform === 'linux'
            ? 'Install Docker Engine with the compose plugin: https://docs.docker.com/engine/install/'
            : 'Install Docker Desktop (https://docs.docker.com/get-started/get-docker/) or Rancher Desktop (https://rancherdesktop.io), then start it.',
        'Setup never installs Docker for you.',
      ]
    case 'compose-missing':
      return [
        'Install the Docker Compose v2 plugin so that `docker compose version` works: https://docs.docker.com/compose/install/',
      ]
    case 'daemon-stopped':
      return [
        wsl
          ? 'Start Docker Desktop on Windows and wait until it reports it is running (or start the engine inside WSL if you installed one there).'
          : platform === 'linux'
            ? 'Start the engine yourself, for example: sudo systemctl start docker'
            : 'Start Docker Desktop or Rancher Desktop (or `colima start`) and wait until it reports it is running.',
      ]
    case 'daemon-unresponsive':
      return ['Docker did not answer in time. Restart Docker Desktop / the engine and re-run.']
    case 'daemon-permission':
      return [
        'Your user may not talk to the Docker engine. Add it to the docker group (sudo usermod -aG docker "$USER"), log out and back in, then re-run.',
      ]
    case 'port-conflict':
      return [
        ...problem.ports.map(({ service, port, envKey }) => `Port ${port} (${service}) is already in use by another process.${envKey ? ` Stop that process, or pick a free port with ${envKey} in .env.` : ' Stop that process.'}`),
        `If you change POSTGRES_PORT, update the port in DATABASE_URL (${databaseUrlFile}) as well.`,
        '`docker ps` shows containers of other projects that may hold these ports.',
        ...portConflictHints,
      ]
    case 'unhealthy':
      return [
        ...problem.services.map(({ service, state, health }) => `${service}: ${health ? `${state} (${health})` : state}`),
        `Inspect the logs: ${problem.logsCommand ?? 'docker compose logs <service>'}`,
      ]
    default:
      return [
        'docker compose failed — see the output above, fix the cause and re-run.',
        'Output says "port is already allocated" or "ports are not available"? Another process holds that port: pick a free one with the matching *_PORT in .env.',
        ...(platform === 'win32'
          ? ['On Windows the port may sit in a range reserved by Hyper-V/WinNAT (list them: netsh interface ipv4 show excludedportrange protocol=tcp); choose a port outside those ranges.']
          : []),
      ]
  }
}

const PROBLEM_TITLES = {
  'cli-missing': 'Docker is not installed (docker CLI not found).',
  'compose-missing': 'Docker Compose v2 is not available.',
  'daemon-stopped': 'The Docker engine is not running.',
  'daemon-unresponsive': 'The Docker engine is not responding.',
  'daemon-permission': 'No permission to use the Docker engine.',
  'port-conflict': 'Infrastructure ports are already in use.',
  unhealthy: 'Infrastructure services did not become healthy.',
  'compose-failed': 'Starting the infrastructure containers failed.',
}

// Every message ends with the opt-out, so a developer with their own
// PostgreSQL/Redis/Meilisearch is never stuck behind a Docker problem.
//   databaseUrlFile    -> where DATABASE_URL lives (apps/mercato/.env in the monorepo)
//   portConflictHints  -> layout-specific extra lines for port conflicts
export function formatInfraProblem(problem, {
  platform = process.platform,
  optOutCommand = `yarn setup ${NO_INFRA_FLAG}`,
  wsl = platform === 'linux' && detectWsl(),
  databaseUrlFile = '.env',
  portConflictHints = [],
} = {}) {
  return [
    PROBLEM_TITLES[problem.code] ?? PROBLEM_TITLES['compose-failed'],
    ...remediationFor(problem, platform, { wsl, databaseUrlFile, portConflictHints }).map((line) => `  ${line}`),
    `  Already running PostgreSQL, Redis and Meilisearch yourself? Re-run with: ${optOutCommand}`,
    '  (it makes no Docker calls and keeps the URLs in your .env).',
  ]
}

// Preflight + `compose up -d --wait`. Never removes containers or volumes:
// re-running reuses the existing project resources and their data.
//   composeArgs(extra)  -> full docker argv for this project's compose file
//   services            -> [{ service, port, envKey }] that must become ready
//   upArgs              -> extra args placed before `up` (e.g. --profile x)
//   cwd                 -> directory docker runs in (compose file lookup, .env)
//   beforeUp            -> slow preparation (image pulls/builds) that should
//                          only run once the cheap checks above passed
export async function startInfraServices({
  composeArgs,
  services,
  upArgs = [],
  cwd,
  beforeUp,
  detect = detectDockerRuntime,
  spawnSyncImpl = spawnSync,
  portProbe = probeTcpPort,
  log = console.log,
}) {
  const runtime = detect()
  if (!runtime.ok) return { ok: false, problem: { code: runtime.code, detail: runtime.detail } }

  const required = services.map((entry) => entry.service)
  // null when `compose ps` itself fails (e.g. an interpolation error in .env).
  const listServices = () => {
    const ps = spawnSyncImpl('docker', composeArgs(['ps', '--all', '--format', 'json']), { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return !ps?.error && (ps?.status ?? 1) === 0 ? parseComposePsOutput(ps.stdout) : null
  }

  const listed = listServices()
  const running = runningComposeServices(listed ?? [])
  // Without the project's container list our own running containers would look
  // like foreign port owners, so the port probe is skipped and `compose up`
  // reports the real compose error instead.
  if (listed === null) {
    log('   could not list this project\'s containers (docker compose ps failed); skipping the port check')
  } else {
    const conflicts = await findPortConflicts(services, { running, probe: portProbe })
    if (conflicts.length > 0) return { ok: false, problem: { code: 'port-conflict', ports: conflicts } }
  }

  const reused = required.filter((service) => running.has(service))
  if (reused.length > 0) log(`   reusing running containers: ${reused.join(', ')} (data preserved)`)
  if (beforeUp) beforeUp()

  const up = spawnSyncImpl('docker', composeArgs([...upArgs, 'up', '-d', '--wait']), { cwd, stdio: 'inherit', windowsHide: true })
  if (up?.error) return { ok: false, problem: { code: 'compose-failed', detail: up.error.message } }
  if ((up?.status ?? 1) === 0) return { ok: true, reused }

  const after = listServices()
  const unhealthy = after === null ? [] : findUnhealthyServices(after, required)
  if (unhealthy.length > 0) {
    const logsCommand = `docker ${composeArgs(['logs', unhealthy[0].service]).join(' ')}`
    return { ok: false, problem: { code: 'unhealthy', services: unhealthy, logsCommand } }
  }
  return { ok: false, problem: { code: 'compose-failed' } }
}
