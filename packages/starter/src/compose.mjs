import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { detectDockerRuntime, parseComposePsOutput } from './infra-preflight.mjs'
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

// Thin adapter over the shared preflight: `reason` stays the human-readable
// string doctor prints; `code` distinguishes missing CLI / missing compose /
// stopped or unreachable daemon for callers that explain the fix.
export function detectDocker({ probe } = {}) {
  const runtime = detectDockerRuntime(probe ? { probe } : {})
  if (runtime.ok) return { ok: true, code: runtime.code }
  return { ok: false, code: runtime.code, reason: runtime.detail }
}

export { parseComposePsOutput }

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

// Windows shell shims spawn a process tree; killing only cmd.exe leaves
// builds running. POSIX captured children have their own process group.
export function stopStreamingChild(child, signal, { platform = process.platform, grouped = true, spawnSyncImpl = spawnSync, killImpl = process.kill } = {}) {
  if (platform === 'win32' && child.pid) {
    const result = spawnSyncImpl('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    if (!result.error && result.status === 0) return
  } else if (grouped && child.pid) {
    try { killImpl(-child.pid, signal); return } catch { /* child may already have exited */ }
  }
  child.kill(signal)
}

// Async output capture keeps the setup log toggle responsive during long
// installs/builds. With no sink, preserve inherited stdio (CI / verbose).
export function runStreaming(command, commandArgs, { cwd, env, logs, spawnImpl = spawn } = {}) {
  const resolved = resolveSpawnCommand(command, commandArgs)
  return new Promise((resolve, reject) => {
    const child = spawnImpl(resolved.command, resolved.args, {
      cwd: cwd ?? process.cwd(),
      env: env ?? process.env,
      stdio: logs ? [logs.interactive ? 'ignore' : 'inherit', 'pipe', 'pipe'] : 'inherit',
      // Give piped children their own group so Ctrl+C reaches yarn's workers
      // as well as yarn itself. Windows does not support POSIX group signals.
      detached: Boolean(logs) && process.platform !== 'win32',
      ...resolved.spawnOptions,
    })
    const interrupt = (signal) => {
      logs?.stop()
      stopStreamingChild(child, signal, { grouped: Boolean(logs) })
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    const onSigint = () => interrupt('SIGINT')
    const onSigterm = () => interrupt('SIGTERM')
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
    const cleanup = () => {
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => logs?.raw(chunk))
    child.stderr?.on('data', (chunk) => logs?.raw(chunk))
    child.once('error', (error) => { cleanup(); reject(new Error(`${command} could not be executed: ${error.message}`)) })
    child.once('close', (code) => { cleanup(); resolve(code ?? 1) })
  })
}
