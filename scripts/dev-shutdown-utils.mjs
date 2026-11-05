import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'

const trackedProcessTrees = new WeakMap()

function readProcessTable() {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,stat=,command='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 1000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(\S+)\s+(.+)$/)
      if (!match || match[4].startsWith('Z')) return []
      return [{
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        startedAt: match[3].replace(/\s+/g, ' '),
        command: match[5],
      }]
    })
  } catch {
    return []
  }
}

function collectProcessTree(pid, processes) {
  const root = processes.find((entry) => entry.pid === pid)
  if (!root) return []
  const descendants = [root]
  const selected = new Set([pid])
  for (const parent of descendants) {
    for (const entry of processes) {
      if (entry.parentPid === parent.pid && !selected.has(entry.pid)) {
        selected.add(entry.pid)
        descendants.push(entry)
      }
    }
  }
  return descendants
}

export function inspectProcessTree(pid, options = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return []
  return collectProcessTree(pid, (options.readProcessTable ?? readProcessTable)())
}

export function signalProcessTree(processes, signal, options = {}) {
  const current = new Map((options.readProcessTable ?? readProcessTable)().map((entry) => [entry.pid, entry]))
  const kill = options.kill ?? process.kill.bind(process)
  let signaled = false
  for (const entry of [...processes].reverse()) {
    if (!Number.isInteger(entry.pid) || entry.pid <= 1 || entry.pid === process.pid) continue
    if (typeof entry.startedAt !== 'string' || !entry.startedAt || current.get(entry.pid)?.startedAt !== entry.startedAt) continue
    try {
      kill(entry.pid, signal)
      signaled = true
    } catch {}
  }
  return signaled
}

export function killProcessTree(child, signal, options = {}) {
  if (!child) return false

  const platform = options.platform ?? process.platform
  const spawnImpl = options.spawn ?? spawn

  if (platform === 'win32') {
    const pid = child.pid
    if (typeof pid !== 'number' || Number.isNaN(pid) || pid <= 0) {
      return false
    }
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      if (killer && typeof killer.on === 'function') {
        killer.on('error', () => {})
      }
      return true
    } catch {
      return false
    }
  }

  const processes = (options.readProcessTable ?? readProcessTable)()
  const current = new Map(processes.map((entry) => [entry.pid, entry]))
  const tracked = trackedProcessTrees.get(child) ?? new Map()
  const roots = tracked.size ? [...tracked.values()] : [{ pid: child.pid }]
  for (const previous of roots) {
    const present = current.get(previous.pid)
    if (!present || (previous.startedAt && previous.startedAt !== present.startedAt)) continue
    for (const entry of collectProcessTree(previous.pid, processes)) tracked.set(entry.pid, entry)
  }
  trackedProcessTrees.set(child, tracked)
  const descendants = [...tracked.values()].filter((entry) => entry.pid !== child.pid)
  const signaled = signalProcessTree(descendants, signal, {
    ...options,
    readProcessTable: () => processes,
  })
  if (child.exitCode != null || child.signalCode != null) return signaled
  const original = tracked.get(child.pid)
  if (original && current.get(child.pid)?.startedAt !== original.startedAt) return signaled
  try {
    return child.kill(signal) || signaled
  } catch {
    return signaled
  }
}
