import spawn from 'cross-spawn'
import { ChildProcess } from 'node:child_process'

import { readProcessTable, readSessionProcessTable } from './dev-process-state.mjs'

const trackedProcessTrees = new WeakMap()

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
        killer.on('error', () => { /* best-effort: taskkill may not exist on stripped images */ })
      }
      return true
    } catch {
      return false
    }
  }

  const processes = (options.readProcesses ?? readProcessTable)()
  const tracked = trackedProcessTrees.get(child) ?? new Map()
  const root = processes?.find((entry) => entry.pid === child.pid)
  const previousRoot = tracked.get(child.pid)
  if (root && (!previousRoot || previousRoot.identity === root.identity)) tracked.set(root.pid, root)
  const pending = [...tracked.values()]
    .filter((entry) => processes?.some((current) => current.pid === entry.pid && current.identity === entry.identity))
    .map((entry) => entry.pid)
  const visited = new Set()
  while (pending.length) {
    const parentPid = pending.shift()
    if (visited.has(parentPid)) continue
    visited.add(parentPid)
    for (const entry of processes.filter((candidate) => candidate.ppid === parentPid)) {
      tracked.set(entry.pid, entry)
      pending.push(entry.pid)
    }
  }
  trackedProcessTrees.set(child, tracked)

  let signaled = false
  for (const entry of [...tracked.values()].reverse()) {
    if (entry.pid === child.pid) continue
    const current = processes?.find((candidate) => candidate.pid === entry.pid)
    if (!current || current.identity !== entry.identity || current.state.startsWith('Z')) continue
    try {
      const kill = options.kill ?? process.kill
      kill(entry.pid, signal)
      signaled = true
    } catch {}
  }
  const canUseNativeHandle = processes === null && child instanceof ChildProcess
    && child.exitCode === null && child.signalCode === null
  if (!previousRoot || (root && previousRoot.identity === root.identity) || canUseNativeHandle) {
    try {
      child.kill(signal)
      signaled = true
    } catch {}
  }
  return signaled
}

export async function waitForProcessTreesExit(children, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const processes = readProcessTable()
    const remaining = children.some((child) => {
      const tracked = trackedProcessTrees.get(child)
      if (processes && tracked?.size) {
        return [...tracked.values()].some((entry) => processes.some((current) => current.pid === entry.pid
          && current.identity === entry.identity && !current.state.startsWith('Z')))
      }
      if (!processes && tracked?.size) {
        return [...tracked.values()].some((entry) => {
          try { process.kill(entry.pid, 0); return true }
          catch (error) { return error?.code === 'EPERM' }
        })
      }
      return child.exitCode === null && child.signalCode === null
    })
    if (!remaining) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return false
}


export function getSessionProcessTargets(session) {
  if (!session) return []
  const table = readProcessTable()
  const registered = (session.getProcessRecords?.(table) ?? []).flatMap((record) => {
    const current = table?.find((entry) => entry.pid === record.pid)
    return current ? [{ ...current, role: record.role }] : []
  })
  const processes = [...new Map([
    ...readSessionProcessTable(session.token, session.ownsLock ? null : process.pid),
    ...registered,
  ].map((entry) => [entry.pid, entry])).values()]
    .filter((entry) => entry.pid !== process.pid && !entry.state.startsWith('Z'))
  const sessionPids = new Set(processes.map((entry) => entry.pid))
  return processes.filter((entry) => !sessionPids.has(entry.ppid)).map((entry) => {
    const target = { pid: entry.pid, kill: (signal) => process.kill(entry.pid, signal) }
    trackedProcessTrees.set(target, new Map([[entry.pid, entry]]))
    session.registerChild?.(target, entry.role ?? 'orphaned-session-process')
    return target
  })
}
