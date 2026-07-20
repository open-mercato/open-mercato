import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { resolveSpawnCommand } from './spawn.mjs'

export const INFRA_COMPOSE_FILE = path.join('starters', 'docker', 'compose.infra.yml')

function isOpenMercatoRoot(dir) {
  // Works for the monorepo AND for standalone apps scaffolded by create-app:
  // both carry the starters/docker compose layout at their root.
  if (fs.existsSync(path.join(dir, INFRA_COMPOSE_FILE))) return true
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg?.name === 'open-mercato'
  } catch {
    return false
  }
}

// The starter can run from anywhere (npx, package bin inside node_modules, a
// subdirectory of the clone) — never assume a location relative to this file.
export function resolveRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir)
  while (true) {
    if (isOpenMercatoRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
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

// Both helpers route through resolveSpawnCommand (spawn.mjs): it validates
// command + args and only enables the cmd.exe shell for the .cmd shims
// (yarn/npm/corepack) that Node >= 18.20 cannot spawn directly on Windows.
export function spawnStreaming(command, commandArgs, { cwd, env } = {}) {
  const resolved = resolveSpawnCommand(command, commandArgs)
  return spawn(resolved.command, resolved.args, {
    cwd: cwd ?? process.cwd(),
    env: env ?? process.env,
    stdio: 'inherit',
    ...resolved.spawnOptions,
  })
}

// Capture-mode sibling of runStreamingSync for probes that need the output
// (version checks, registry queries). Same Windows shim handling.
export function runCaptureSync(command, commandArgs, { cwd, env, timeout = 15000 } = {}) {
  const resolved = resolveSpawnCommand(command, commandArgs)
  return spawnSync(resolved.command, resolved.args, {
    cwd: cwd ?? process.cwd(),
    env: env ?? process.env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    ...resolved.spawnOptions,
  })
}

export function runStreamingSync(command, commandArgs, { cwd, env } = {}) {
  const resolved = resolveSpawnCommand(command, commandArgs)
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: cwd ?? process.cwd(),
    env: env ?? process.env,
    stdio: 'inherit',
    ...resolved.spawnOptions,
  })
  if (result.error) {
    throw new Error(`${command} could not be executed: ${result.error.message}`)
  }
  return result.status ?? 1
}
