import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { DEV_LOG_DIR, RUN_STATE_DIR, resolveStackPorts, stackUrls } from './constants.mjs'
import { color, icons } from './ui.mjs'

// Detached ("PM2-like") lifecycle for the host processes. `yarn dev` is the
// actual supervisor (it restarts the app and the MCP server with backoff);
// this module only detaches it, tracks the pid, and exposes stop/status/logs.

const PID_FILE = 'dev.json'

function runStatePath(repoRoot) {
  return path.join(repoRoot, RUN_STATE_DIR, PID_FILE)
}

export function readRunState(repoRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(runStatePath(repoRoot), 'utf8'))
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

export function isPidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else — count it
    // as alive so we never clobber a foreign pid.
    return error?.code === 'EPERM'
  }
}

export function startDetached(repoRoot, devArgs = [], { env = process.env, log = console.log } = {}) {
  const existing = readRunState(repoRoot)
  if (existing && isPidAlive(existing.pid)) {
    log(`✅ Dev runtime already running (pid ${existing.pid}). Use \`status\` / \`logs\` / \`stop\`.`)
    return existing.pid
  }
  fs.mkdirSync(path.join(repoRoot, RUN_STATE_DIR), { recursive: true })
  fs.mkdirSync(path.join(repoRoot, DEV_LOG_DIR), { recursive: true })
  const logFile = path.join(repoRoot, DEV_LOG_DIR, 'detached-dev.log')
  const outFd = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'dev.mjs'), ...devArgs], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: {
      ...env,
      // Headless: no browser popup, no interactive assumptions.
      OM_DEV_AUTO_OPEN: '0',
      FORCE_COLOR: '0',
    },
  })
  fs.closeSync(outFd)
  child.unref()
  fs.writeFileSync(runStatePath(repoRoot), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), args: devArgs, logFile }, null, 2))
  log(`✅ Dev runtime started in the background (pid ${child.pid}).`)
  log(`   logs:   ${path.relative(repoRoot, logFile)}  (or \`logs --follow\`)`)
  return child.pid
}

function killTree(pid) {
  if (process.platform === 'win32') {
    // Windows never propagates signals to grandchildren — kill the whole tree.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    return
  }
  // detached:true made the child a process-group leader; signal the group so
  // yarn -> turbo -> next descendants all get SIGTERM.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}

export async function stopDetached(repoRoot, { log = console.log, graceMs = 8000 } = {}) {
  const state = readRunState(repoRoot)
  if (!state || !isPidAlive(state.pid)) {
    if (state) fs.rmSync(runStatePath(repoRoot), { force: true })
    log('ℹ️ No detached dev runtime is running.')
    return true
  }
  log(`Stopping dev runtime (pid ${state.pid}) ...`)
  killTree(state.pid)
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline && isPidAlive(state.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (isPidAlive(state.pid) && process.platform !== 'win32') {
    try {
      process.kill(-state.pid, 'SIGKILL')
    } catch {
      // gone
    }
  }
  const stopped = !isPidAlive(state.pid)
  if (stopped) {
    fs.rmSync(runStatePath(repoRoot), { force: true })
    log('✅ Dev runtime stopped.')
  } else {
    log(`❌ Process ${state.pid} survived SIGKILL — inspect it manually.`)
  }
  return stopped
}

async function fetchJson(url, timeoutMs = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function probeHttp(url, timeoutMs = 3000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

export async function collectStatus(repoRoot, { runCompose }) {
  const ports = resolveStackPorts(repoRoot)
  const urls = stackUrls(ports)
  const state = readRunState(repoRoot)
  const detachedAlive = state ? isPidAlive(state.pid) : false

  const [appUp, mcpUp, opencodeUp, splash] = await Promise.all([
    probeHttp(urls.app),
    probeHttp(urls.mcpHealth),
    probeHttp(urls.opencodeHealth),
    fetchJson(`${urls.splash}/status`),
  ])

  let containers = []
  try {
    const psResult = runCompose(repoRoot, ['ps', '--format', 'json'], { stdio: 'pipe' })
    const { parseComposePsOutput } = await import('./compose.mjs')
    containers = parseComposePsOutput(psResult.stdout).map((entry) => ({
      service: entry.Service ?? entry.Name ?? 'unknown',
      state: entry.State ?? 'unknown',
      health: entry.Health ?? '',
    }))
  } catch {
    containers = []
  }

  return { ports, urls, detached: state && detachedAlive ? state : null, appUp, mcpUp, opencodeUp, splash, containers }
}

export function printStatus(status, { log = console.log } = {}) {
  log('')
  log(color.bold('Open Mercato — stack status'))
  log('')
  const flag = (up) => (up ? `${icons.ok} up  ` : `${icons.fail} down`)
  log(`  app        ${flag(status.appUp)}   ${color.cyan(status.urls.app)}`)
  log(`  mcp        ${flag(status.mcpUp)}   ${color.cyan(status.urls.mcpHealth)}`)
  log(`  opencode   ${flag(status.opencodeUp)}   ${color.cyan(status.urls.opencodeHealth)}`)
  if (status.detached) log(`  supervisor ${icons.ok} detached (pid ${status.detached.pid}, since ${status.detached.startedAt})`)
  else log(`  supervisor ${icons.info} not detached (foreground \`yarn dev\` or stopped)`)
  if (status.splash?.phase || status.splash?.activity) {
    log(`  runtime    ${status.splash.phase ?? ''}${status.splash.activity ? ` — ${status.splash.activity}` : ''}`)
  }
  log('')
  if (status.containers.length === 0) {
    log(`  containers: none running ${color.dim('(start them with `up`)')}`)
  } else {
    for (const container of status.containers) {
      const health = container.health ? ` (${container.health})` : ''
      const healthy = container.state === 'running' && (!container.health || container.health === 'healthy')
      log(`  container  ${healthy ? icons.ok : icons.warn} ${container.service.padEnd(14)} ${container.state}${health}`)
    }
  }
  log('')
}

export function tailLogs(repoRoot, { follow = false, lines = 60, log = console.log } = {}) {
  const logDir = path.join(repoRoot, DEV_LOG_DIR)
  let files = []
  try {
    files = fs.readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => ({ name, file: path.join(logDir, name), mtime: fs.statSync(path.join(logDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    files = []
  }
  if (files.length === 0) {
    log(`ℹ️ No logs yet under ${path.relative(repoRoot, logDir)} — start the stack first.`)
    return
  }
  const newest = files[0]
  const printTail = (fromSize = null) => {
    const content = fs.readFileSync(newest.file, 'utf8')
    const slice = fromSize === null
      ? content.split('\n').slice(-lines).join('\n')
      : content.slice(fromSize)
    if (slice.trim()) log(slice.replace(/\n$/, ''))
    return content.length
  }
  log(`── ${path.relative(repoRoot, newest.file)} ──`)
  let size = printTail()
  if (!follow) return
  fs.watchFile(newest.file, { interval: 500 }, () => {
    size = printTail(size)
  })
}
