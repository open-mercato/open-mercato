import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INFRA_COMPOSE_FILE = path.join('starters', 'docker', 'compose.infra.yml')

export function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

// Canonical invocation: --project-directory anchors .env interpolation and
// every relative path in the compose file at the repo root, keeping the
// compose project identity identical to the pre-starters layout.
export function composeArgs(repoRoot, extraArgs, composeFile = INFRA_COMPOSE_FILE) {
  return ['compose', '--project-directory', repoRoot, '-f', path.join(repoRoot, composeFile), ...extraArgs]
}

export function runCompose(repoRoot, extraArgs, { composeFile, stdio = 'inherit' } = {}) {
  const result = spawnSync('docker', composeArgs(repoRoot, extraArgs, composeFile), {
    cwd: repoRoot,
    stdio,
    encoding: 'utf8',
  })
  if (result.error) {
    throw new Error(`docker compose could not be executed: ${result.error.message}`)
  }
  return result
}

export function detectDocker() {
  const cli = spawnSync('docker', ['--version'], { stdio: 'ignore' })
  if (cli.error || cli.status !== 0) {
    return { ok: false, reason: 'docker CLI not found' }
  }
  const composePlugin = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' })
  if (composePlugin.error || composePlugin.status !== 0) {
    return { ok: false, reason: 'docker compose v2 plugin not found' }
  }
  const engine = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' })
  if (engine.error || engine.status !== 0) {
    return { ok: false, reason: 'docker engine not running' }
  }
  return { ok: true }
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

export function summarizeServiceStates(entries) {
  const states = {}
  for (const entry of entries) {
    const service = entry?.Service
    if (!service) continue
    states[service] = {
      state: entry.State ?? 'unknown',
      health: entry.Health ?? '',
    }
  }
  return states
}

export function spawnStreaming(command, commandArgs, { cwd, env } = {}) {
  const isWindows = process.platform === 'win32'
  return spawn(command, commandArgs, {
    cwd: cwd ?? process.cwd(),
    env: env ?? process.env,
    stdio: 'inherit',
    // .cmd shims (yarn) need a shell on Windows since the Node spawn
    // hardening in 18.20+; docker/git are real executables and do not.
    shell: isWindows && /\.(cmd|bat)$/i.test(command) === false && ['yarn', 'npm', 'corepack'].includes(command),
  })
}

export function runStreamingSync(command, commandArgs, { cwd, env } = {}) {
  const isWindows = process.platform === 'win32'
  const result = spawnSync(command, commandArgs, {
    cwd: cwd ?? process.cwd(),
    env: env ?? process.env,
    stdio: 'inherit',
    shell: isWindows && ['yarn', 'npm', 'corepack'].includes(command),
  })
  if (result.error) {
    throw new Error(`${command} could not be executed: ${result.error.message}`)
  }
  return result.status ?? 1
}
