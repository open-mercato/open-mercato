import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import {
  acquireDevSession,
  DevSessionConflictError,
  inspectDevSessionRecovery,
  withDevSessionRecovery,
} from './dev-session-guard.mjs'

function canonicalPath(value) {
  if (typeof value !== 'string' || !value) return null
  try { return fs.realpathSync(value) } catch { return path.resolve(value) }
}

function processWorkspace(pid) {
  if (process.platform === 'linux') {
    try { return fs.readlinkSync(`/proc/${pid}/cwd`) } catch { return null }
  }
  if (process.platform !== 'darwin') return null
  const result = spawnSync('lsof', ['-b', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024,
  })
  if (result.status !== 0) return null
  return result.stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? null
}

function parseLocalEndpoint(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const endpoint = new URL(value)
    return ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ? endpoint : null
  } catch {
    return null
  }
}

async function endpointAvailable(value) {
  const endpoint = parseLocalEndpoint(value)
  if (!endpoint) return false
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80))
  const hosts = endpoint.hostname === 'localhost' ? ['127.0.0.1', '::1'] : [endpoint.hostname.replace(/^\[|\]$/g, '')]
  for (const host of hosts) {
    const available = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', (error) => resolve(host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)))
      server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)))
    })
    if (!available) return false
  }
  return true
}

async function confirmRecovery(description) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await terminal.question(`${description} [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    terminal.close()
  }
}

function isInsideWorkspace(workspaceRoot, candidate) {
  const relative = path.relative(workspaceRoot, candidate)
  return !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
}

function classifySession(state, dependencies) {
  const running = []
  const stale = []
  const unverified = []
  const rows = new Map()
  for (const member of state.liveRecords) {
    const tree = dependencies.inspectTree(member.pid)
    const root = tree.find((row) => row.pid === member.pid)
    if (!root) {
      stale.push({ member, reason: 'exited' })
      continue
    }
    const lastSeen = Date.parse(member.registeredAt ?? member.heartbeatAt ?? state.owner.transferredAt ?? state.owner.startedAt)
    const started = Date.parse(root.startedAt)
    if (Number.isFinite(lastSeen) && Number.isFinite(started) && started > lastSeen) {
      stale.push({ member, reason: 'reused' })
      continue
    }
    const workspace = canonicalPath(dependencies.processWorkspace(member.pid))
    if (workspace && !isInsideWorkspace(state.workspaceRoot, workspace)) {
      stale.push({ member, reason: 'reused' })
      continue
    }
    if (!workspace || !Number.isFinite(lastSeen) || !Number.isFinite(started)) {
      unverified.push(member)
      continue
    }
    running.push(member)
    for (const row of tree) rows.set(row.pid, row)
  }
  const protectedPids = new Set([process.ppid].filter((pid) => Number.isInteger(pid) && pid > 1))
  const protectedRecords = [...rows.values()].filter((row) => protectedPids.has(row.pid))
  return { running, stale, unverified, protectedRecords, rows: [...rows.values()] }
}

function describeConflict(snapshot, plan, endpointFree) {
  const owner = snapshot.owner
  const endpoint = parseLocalEndpoint(owner.url)
  const lines = [
    `Another Open Mercato dev session already owns this workspace (PID ${owner.pid ?? 'unknown'}, mode ${owner.mode || 'unknown'}, URL ${owner.url || 'unavailable'}).`,
    `Workspace: ${snapshot.workspaceRoot}`,
    ...plan.running.map((record) => `  ${record.role ?? 'managed process'} (PID ${record.pid}) is still running in this workspace`),
    ...plan.stale.map(({ member, reason }) => `  ${member.role ?? 'managed process'} (PID ${member.pid}) is no longer running${reason === 'reused' ? ' (the PID now belongs to an unrelated process, which is left untouched)' : ''}`),
  ]
  if (endpoint) {
    lines.push(endpointFree
      ? `The application endpoint ${endpoint.origin} has no listener.`
      : `The application endpoint ${endpoint.origin} is still serving; continuing stops it.`)
  }
  lines.push(plan.running.length
    ? 'Stop these processes, clean up the session lock and continue startup?'
    : 'Clean up the stale session lock and continue startup?')
  return lines.join('\n')
}

function describeRefusal(snapshot, plan) {
  const lines = []
  for (const record of plan.unverified) {
    lines.push(`Could not verify that PID ${record.pid} (${record.role ?? 'managed process'}) belongs to ${snapshot.workspaceRoot}; it was left untouched.`)
  }
  for (const record of plan.protectedRecords) {
    lines.push(`PID ${record.pid} is a parent of this launch and cannot be stopped from here.`)
  }
  lines.push('Stop it manually (Ctrl+C in its terminal, or kill <PID>) and retry.')
  return `${lines.join('\n')}\n`
}

async function loadProcessUtilities(overrides) {
  if (overrides.inspectTree && overrides.signalTree) return {}
  const { inspectProcessTree, signalProcessTree } = await import('./dev-shutdown-utils.mjs')
  return { inspectTree: inspectProcessTree, signalTree: signalProcessTree }
}

export async function acquireDevSessionWithRecovery(options = {}, overrides = {}) {
  let conflict
  try { return acquireDevSession(options) } catch (error) {
    if (!(error instanceof DevSessionConflictError)) throw error
    conflict = error
  }
  const interactive = overrides.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI)
  if (!interactive) throw conflict
  const dependencies = {
    confirm: confirmRecovery,
    endpointAvailable,
    processWorkspace,
    output: process.stdout,
    graceMs: 10_000,
    ...await loadProcessUtilities(overrides),
    ...overrides,
  }
  let snapshot = inspectDevSessionRecovery(options.workspaceRoot ?? process.cwd())
  if (!snapshot?.liveRecords.length) return acquireDevSession(options)
  const plan = classifySession(snapshot, dependencies)
  if (plan.unverified.length || plan.protectedRecords.length) {
    dependencies.output.write(describeRefusal(snapshot, plan))
    throw conflict
  }
  const endpointFree = await dependencies.endpointAvailable(snapshot.owner.url)
  if (!await dependencies.confirm(describeConflict(snapshot, plan, endpointFree))) throw conflict

  const expectedRunning = new Set(plan.running.map((record) => record.pid))
  let records = []
  withDevSessionRecovery(snapshot, (current, retainProcesses) => {
    const fresh = classifySession(current, dependencies)
    if (fresh.unverified.length || fresh.protectedRecords.length || fresh.running.some((record) => !expectedRunning.has(record.pid))) throw conflict
    records = fresh.rows
    if (!records.length) return
    snapshot = retainProcesses(records.map((record) => record.pid)) ?? snapshot
    dependencies.signalTree(records, 'SIGTERM')
  })

  if (records.length) {
    dependencies.output.write(`Stopping ${records.length} process${records.length === 1 ? '' : 'es'} of the previous session...\n`)
    const retain = (pids, onRetained) => {
      try {
        withDevSessionRecovery(snapshot, (current, retainProcesses) => {
          snapshot = retainProcesses(pids) ?? snapshot
          onRetained?.()
        })
      } catch (error) {
        if (!(error instanceof DevSessionConflictError)) throw error
        onRetained?.()
      }
    }
    const survivingTrees = () => {
      const survivors = new Map()
      for (const record of records) {
        const tree = dependencies.inspectTree(record.pid)
        if (tree.some((row) => row.pid === record.pid && row.startedAt === record.startedAt)) {
          for (const row of tree) survivors.set(row.pid, row)
        }
      }
      const discovered = [...survivors.values()].filter((row) => !records.some((record) => record.pid === row.pid && record.startedAt === row.startedAt))
      if (discovered.length) {
        retain([...survivors.keys()], () => {
          records = [...new Map([...records, ...discovered].map((record) => [record.pid, record])).values()]
        })
      }
      return [...survivors.values()]
    }
    const deadline = Date.now() + dependencies.graceMs
    while (survivingTrees().length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const survivors = survivingTrees()
    if (survivors.length) {
      retain(survivors.map((record) => record.pid), () => {
        records = survivors
        dependencies.signalTree(records, 'SIGKILL')
      })
      const forcedDeadline = Date.now() + 2000
      while (survivingTrees().length && Date.now() < forcedDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      if (survivingTrees().length) throw conflict
    }
  }

  try {
    const session = acquireDevSession(options)
    dependencies.output.write('Previous dev session cleaned up; continuing startup.\n')
    return session
  } catch (error) {
    if (!(error instanceof DevSessionConflictError)) throw error
  }
  withDevSessionRecovery(snapshot, (current, retainProcesses, discardLock) => {
    const remaining = classifySession(current, dependencies)
    if (remaining.running.length || remaining.unverified.length) throw conflict
    discardLock()
  })
  const session = acquireDevSession(options)
  dependencies.output.write('Stale dev session lock removed; continuing startup.\n')
  return session
}
