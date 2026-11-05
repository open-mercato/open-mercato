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
import { inspectProcessTree, signalProcessTree } from './dev-shutdown-utils.mjs'

function canonicalPath(value) {
  try { return fs.realpathSync(value) } catch { return null }
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

async function endpointAvailable(value) {
  let endpoint
  try { endpoint = new URL(value) } catch { return false }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) return false
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
    const answer = await terminal.question(`${description}\nStop these orphaned processes and continue startup? [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    terminal.close()
  }
}

function inspectOrphans(snapshot, dependencies) {
  if (!snapshot?.liveRecords.length) return null
  if (!snapshot.owner.transferredAt && snapshot.liveRecords.some((record) => record.pid === snapshot.owner.pid)) return null
  const trees = new Map()
  for (const member of snapshot.liveRecords) {
    for (const row of dependencies.inspectTree(member.pid)) trees.set(row.pid, row)
  }
  for (const member of snapshot.liveRecords) {
    const root = trees.get(member.pid)
    const lastSeen = Date.parse(member.registeredAt ?? member.heartbeatAt ?? snapshot.owner.transferredAt ?? snapshot.owner.startedAt)
    const started = Date.parse(root?.startedAt)
    if (!root || !Number.isFinite(lastSeen) || !Number.isFinite(started) || started > lastSeen) return null
    const workspace = canonicalPath(dependencies.processWorkspace(member.pid))
    if (!workspace) return null
    const relative = path.relative(snapshot.workspaceRoot, workspace)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    const visited = new Set()
    let ancestor = root
    while (ancestor.parentPid !== 1) {
      if (visited.has(ancestor.pid)) return null
      visited.add(ancestor.pid)
      ancestor = trees.get(ancestor.parentPid)
      if (!ancestor) return null
    }
  }
  return [...trees.values()]
}

export async function acquireDevSessionWithRecovery(options = {}, overrides = {}) {
  let conflict
  try { return acquireDevSession(options) } catch (error) {
    if (!(error instanceof DevSessionConflictError)) throw error
    conflict = error
  }
  const dependencies = {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI),
    confirm: confirmRecovery,
    endpointAvailable,
    inspectTree: inspectProcessTree,
    processWorkspace,
    signalTree: signalProcessTree,
    output: process.stdout,
    graceMs: 3000,
    ...overrides,
  }
  if (!dependencies.interactive) throw conflict
  let snapshot = inspectDevSessionRecovery(options.workspaceRoot ?? process.cwd())
  if (!snapshot?.liveRecords.length) return acquireDevSession(options)
  let records = inspectOrphans(snapshot, dependencies)
  if (!records || !await dependencies.endpointAvailable(snapshot.owner.url)) throw conflict
  const endpoint = new URL(snapshot.owner.url)
  const description = [
    `A stopped development session left orphaned processes in ${snapshot.workspaceRoot}.`,
    ...snapshot.liveRecords.map((record) => `  ${record.role ?? 'managed process'} (PID ${record.pid})`),
    `The application endpoint ${endpoint.origin} has no listener.`,
  ].join('\n')
  if (!await dependencies.confirm(description)) throw conflict
  if (!await dependencies.endpointAvailable(snapshot.owner.url)) throw conflict
  withDevSessionRecovery(snapshot, (current, retainProcesses) => {
    const inspected = inspectOrphans(snapshot, dependencies)
    if (!inspected || records.some((record) => !inspected.some((row) => row.pid === record.pid && row.startedAt === record.startedAt))) throw conflict
    records = inspected
    snapshot = retainProcesses(records.map((record) => record.pid))
    dependencies.signalTree(records, 'SIGTERM')
  })
  const survivingTrees = () => {
    const survivors = new Map()
    for (const record of records) {
      const tree = dependencies.inspectTree(record.pid)
      if (tree.some((row) => row.pid === record.pid && row.startedAt === record.startedAt)) {
        for (const row of tree) survivors.set(row.pid, row)
      }
    }
    return [...survivors.values()]
  }
  const deadline = Date.now() + dependencies.graceMs
  while (survivingTrees().length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const survivors = survivingTrees()
  if (survivors.length) {
    withDevSessionRecovery(snapshot, (current, retainProcesses) => {
      snapshot = retainProcesses(survivors.map((record) => record.pid))
      records = survivors
      dependencies.signalTree(records, 'SIGKILL')
    })
    const forcedDeadline = Date.now() + 1000
    while (survivingTrees().length && Date.now() < forcedDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (survivingTrees().length) throw conflict
  }
  return acquireDevSession(options)
}
