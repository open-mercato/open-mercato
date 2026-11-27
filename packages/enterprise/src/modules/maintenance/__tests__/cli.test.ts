import os from 'node:os'
import { createMaintenanceCliCommands, MAINTENANCE_EXIT, type MaintenanceCliDeps } from '../cli'
import { createFileMaintenanceStore } from '../lib/store/file'
import { mutateState } from '../lib/transitions'
import type { MaintenanceStateStore } from '../lib/store/types'
import { makeConfig, makeTempDir } from './helpers'

function harness(configOverrides: Parameters<typeof makeConfig>[1] = {}, store?: MaintenanceStateStore) {
  const dir = makeTempDir()
  const resolvedStore = store ?? createFileMaintenanceStore(dir)
  const logs: string[] = []
  const errors: string[] = []
  let exitCode = 0
  const deps: MaintenanceCliDeps = {
    config: makeConfig(dir, { heartbeatMs: 1000, ...configOverrides }),
    getStore: async () => resolvedStore,
    output: { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    setExitCode: (code) => { exitCode = code },
  }
  const commands = createMaintenanceCliCommands(deps)
  const run = async (name: string, argv: string[] = []) => {
    exitCode = 0
    logs.length = 0
    errors.length = 0
    await commands.find((command) => command.command === name)!.run(argv)
    return { exitCode, logs: [...logs], errors: [...errors] }
  }
  return { run, store: resolvedStore }
}

describe('mercato maintenance CLI', () => {
  it('turns the mode on and off and records history', async () => {
    const { run, store } = harness()
    const on = await run('on', ['--title', 'Upgrade', '--duration', '45m', '--json'])
    expect(on.exitCode).toBe(MAINTENANCE_EXIT.ok)
    const payload = JSON.parse(on.logs[0])
    expect(payload).toMatchObject({ version: 1, active: true, created: true, bypassToken: null })
    const status = await run('status', ['--json'])
    const statusPayload = JSON.parse(status.logs[0])
    expect(statusPayload).toMatchObject({ active: true, source: 'store', store: 'file', page: { title: 'Upgrade' } })
    expect(statusPayload.until).toBeTruthy()
    const off = await run('off')
    expect(off.exitCode).toBe(MAINTENANCE_EXIT.ok)
    const read = await store.readState()
    expect(read.kind === 'ok' && read.state.active).toBe(false)
    expect(read.kind === 'ok' && read.state.history).toHaveLength(1)
  })

  it('updates the page of an active window without a new epoch', async () => {
    const { run, store } = harness()
    await run('on')
    const before = await store.readState()
    await run('on', ['--message', 'Still working'])
    const after = await store.readState()
    expect(before.kind === 'ok' && after.kind === 'ok' && after.state.epoch === before.state.epoch).toBe(true)
    expect(after.kind === 'ok' && after.state.page.message).toBe('Still working')
  })

  it('prints a bypass token once and stores only its hash', async () => {
    const { run, store } = harness()
    const on = await run('on', ['--allow-bypass', '--bypass-ttl', '30m', '--json'])
    const payload = JSON.parse(on.logs[0])
    expect(payload.bypassUrl).toBe('/maintenance-bypass')
    expect(typeof payload.bypassToken).toBe('string')
    const read = await store.readState()
    const serialized = JSON.stringify(read)
    expect(serialized).not.toContain(payload.bypassToken)
    const status = await run('status', ['--json'])
    expect(status.logs[0]).not.toContain(payload.bypassToken)
  })

  it('rejects invalid arguments with exit 2', async () => {
    const { run } = harness()
    expect((await run('on', ['--until', 'tomorrow-ish'])).exitCode).toBe(MAINTENANCE_EXIT.invalidArgs)
    expect((await run('on', ['--until', '2026-01-01T00:00:00Z', '--duration', '1h'])).exitCode).toBe(MAINTENANCE_EXIT.invalidArgs)
    expect((await run('drain', ['--expect-processes', 'web=x'])).exitCode).toBe(MAINTENANCE_EXIT.invalidArgs)
  })

  it('refuses off while a hold exists (exit 5) and lists the holder', async () => {
    const { run, store } = harness()
    await run('on')
    await mutateState(store, (current) => ({
      next: { ...current, hold: { id: 'hold-1', operation: 'encryption.rotate-encryption-key', pid: process.pid, host: os.hostname(), heartbeatAt: new Date().toISOString(), forbidsBypass: true, gateRevision: current.gateRevision + 1 } },
      result: undefined,
    }))
    const off = await run('off')
    expect(off.exitCode).toBe(MAINTENANCE_EXIT.held)
    expect(off.errors.join('\n')).toContain('encryption.rotate-encryption-key')
    const forced = await run('off', ['--force-release-stale-holds'])
    expect(forced.exitCode).toBe(MAINTENANCE_EXIT.held)
  })

  it('recovers a stale hold whose owner pid is provably dead on this host', async () => {
    const { run, store } = harness()
    await run('on')
    await mutateState(store, (current) => ({
      next: { ...current, hold: { id: 'hold-1', operation: 'encryption.rotate', pid: 999_999_9, host: os.hostname(), heartbeatAt: new Date(Date.now() - 60_000).toISOString(), forbidsBypass: true, gateRevision: current.gateRevision + 1 } },
      result: undefined,
    }))
    const off = await run('off', ['--force-release-stale-holds'])
    expect(off.exitCode).toBe(MAINTENANCE_EXIT.ok)
  })

  it('refuses off while a reopen barrier is pending verification', async () => {
    const { run, store } = harness()
    await run('on')
    await mutateState(store, (current) => ({ next: { ...current, reopenBarrier: { operationId: 'op', generation: null } }, result: undefined }))
    const off = await run('off', ['--force-release-stale-holds'])
    expect(off.exitCode).toBe(MAINTENANCE_EXIT.held)
    expect(off.errors.join('\n')).toContain('reopen barrier')
  })

  it('reopens after a verified generation only once every writer restarted', async () => {
    const { run, store } = harness()
    await run('on')
    const generation = new Date().toISOString()
    await mutateState(store, (current) => ({ next: { ...current, reopenBarrier: { operationId: 'op', generation } }, result: undefined }))
    const old = new Date(Date.now() - 3_600_000).toISOString()
    await store.writeProcess({ processId: 'old', kind: 'web', host: 'h', pid: 1, startedAt: old, loadedGeneration: old, ackedGateRevision: 99, inflight: 0, heartbeatAt: new Date().toISOString() }, 1000)
    const refused = await run('off')
    expect(refused.exitCode).toBe(MAINTENANCE_EXIT.held)
    expect(refused.errors.join('\n')).toContain('restart')
    await store.removeProcess('old')
    const fresh = new Date(Date.now() + 1000).toISOString()
    await store.writeProcess({ processId: 'new', kind: 'web', host: 'h', pid: 2, startedAt: fresh, loadedGeneration: fresh, ackedGateRevision: 99, inflight: 0, heartbeatAt: new Date().toISOString() }, 1000)
    expect((await run('off')).exitCode).toBe(MAINTENANCE_EXIT.ok)
  })

  it('drain exits 6 when not active and 3 naming the missing role when the inventory is short', async () => {
    const { run } = harness()
    expect((await run('drain')).exitCode).toBe(MAINTENANCE_EXIT.notActive)
    await run('on')
    const drain = await run('drain', ['--timeout', '200ms', '--expect-processes', 'web=2,worker=1'])
    expect(drain.exitCode).toBe(MAINTENANCE_EXIT.drainTimeout)
    expect(drain.logs.join('\n')).toContain('missing web: expected 2, seen 0')
    expect(drain.logs.join('\n')).toContain('missing worker: expected 1, seen 0')
  })

  it('on --wait-drain exits 3 on timeout and keeps the mode on', async () => {
    const { run, store } = harness()
    const on = await run('on', ['--wait-drain', '--drain-timeout', '200ms', '--expect-processes', 'worker=1'])
    expect(on.exitCode).toBe(MAINTENANCE_EXIT.drainTimeout)
    const read = await store.readState()
    expect(read.kind === 'ok' && read.state.active).toBe(true)
  })

  it('exits 4 when the store is unreachable', async () => {
    const broken = { ...createFileMaintenanceStore(makeTempDir()), readState: async () => { throw new Error('ECONNREFUSED') } } as MaintenanceStateStore
    const { run } = harness({}, broken)
    expect((await run('on')).exitCode).toBe(MAINTENANCE_EXIT.storeUnreachable)
    expect((await run('status')).exitCode).toBe(MAINTENANCE_EXIT.storeUnreachable)
  })

  it('off refuses while OM_MAINTENANCE_FORCE is set', async () => {
    const { run } = harness({ force: true })
    expect((await run('off')).exitCode).toBe(MAINTENANCE_EXIT.held)
  })

  it('exits 4 when the store fails after it was opened', async () => {
    const base = createFileMaintenanceStore(makeTempDir())
    const flaky = { ...base, listProcesses: async () => { throw new Error('connection reset') } } as MaintenanceStateStore
    const { run } = harness({}, flaky)
    await run('on')
    const off = await run('off')
    expect(off.exitCode).toBe(MAINTENANCE_EXIT.storeUnreachable)
    expect(off.errors.join('\n')).toContain('connection reset')
  })

  it('refuses to change the bypass token while any operation holds the window', async () => {
    const { run, store } = harness()
    await run('on')
    await mutateState(store, (current) => ({
      next: { ...current, hold: { id: 'h', operation: 'backups.create', pid: process.pid, host: os.hostname(), heartbeatAt: new Date().toISOString(), forbidsBypass: false, gateRevision: current.gateRevision + 1 } },
      result: undefined,
    }))
    const before = await store.readState()
    const result = await run('on', ['--rotate-bypass'])
    expect(result.exitCode).toBe(MAINTENANCE_EXIT.invalidArgs)
    const after = await store.readState()
    expect(after.kind === 'ok' && before.kind === 'ok' && after.state.gateRevision === before.state.gateRevision).toBe(true)
  })
})
