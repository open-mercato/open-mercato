import os from 'node:os'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { parseModuleCliOptions } from '@open-mercato/shared/lib/cli/parseModuleCliOptions'
import type { DrainReport, MaintenanceExpectedProcesses } from '@open-mercato/shared/lib/maintenance/types'
import { parseExpectedProcesses, resolveMaintenanceConfig, type MaintenanceConfig } from './lib/config'
import { createMaintenanceStore, type MaintenanceStateStore } from './lib/store'
import { activateState, deactivateState, deactivationBlock, mutateState } from './lib/transitions'
import { collectDrainReport, isHoldOwnerProvablyStopped, waitForDrain } from './lib/coordinator'
import { checkReopenBarrier, type ReopenCheck } from './lib/reopen'
import { isHeartbeatStale } from './lib/drain'
import { createInitialState, type MaintenanceHoldRecord, type MaintenanceStateV1 } from './lib/state'
import { BYPASS_PATH, DEFAULT_BYPASS_TTL_MS, generateBypassToken, hashBypassToken, parseDurationMs } from './lib/bypass'
import { emitMaintenanceEventSafely } from './lib/emit'

export const MAINTENANCE_EXIT = {
  ok: 0,
  invalidArgs: 2,
  drainTimeout: 3,
  storeUnreachable: 4,
  held: 5,
  notActive: 6,
} as const

export type MaintenanceCliOutput = {
  log(message: string): void
  error(message: string): void
}

export type MaintenanceCliDeps = {
  config: MaintenanceConfig
  getStore: () => Promise<MaintenanceStateStore>
  output: MaintenanceCliOutput
  setExitCode: (code: number) => void
}

const DEFAULT_DRAIN_TIMEOUT_MS = 120_000
const JSON_VERSION = 1

class CliUsageError extends Error {}

type OffOutcome =
  | { kind: 'inactive' }
  | { kind: 'held'; holder: MaintenanceHoldRecord }
  | { kind: 'barrier'; check: ReopenCheck }
  | { kind: 'ended'; windowId: string | null }

function parseArgs(argv: string[]): Record<string, string | true> {
  return parseModuleCliOptions(argv)
}

function stringOpt(args: Record<string, string | true>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function parseUntil(args: Record<string, string | true>, now: Date): string | null | undefined {
  const until = stringOpt(args, 'until')
  const duration = stringOpt(args, 'duration')
  if (until && duration) throw new CliUsageError('Use either --until or --duration, not both.')
  if (until) {
    const parsed = Date.parse(until)
    if (!Number.isFinite(parsed)) throw new CliUsageError(`--until must be an ISO date-time, got "${until}".`)
    return new Date(parsed).toISOString()
  }
  if (duration) {
    const ms = parseDurationMs(duration)
    if (!ms) throw new CliUsageError(`--duration must look like 45m, 2h or 90s, got "${duration}".`)
    return new Date(now.getTime() + ms).toISOString()
  }
  return undefined
}

function parseExpected(args: Record<string, string | true>): MaintenanceExpectedProcesses | null | undefined {
  const raw = stringOpt(args, 'expect-processes')
  if (raw === undefined) return undefined
  try {
    return parseExpectedProcesses(raw)
  } catch (error) {
    throw new CliUsageError(`--expect-processes must look like web=2,worker=1,scheduler=1 (${(error as Error).message.replace('[internal] ', '')}).`)
  }
}

function parseTimeoutMs(args: Record<string, string | true>, key: string): number {
  const raw = stringOpt(args, key)
  if (raw === undefined) return DEFAULT_DRAIN_TIMEOUT_MS
  const ms = parseDurationMs(raw)
  if (ms === null) throw new CliUsageError(`--${key} must look like 120s or 5m, got "${raw}".`)
  return ms
}

async function openStore(deps: MaintenanceCliDeps): Promise<MaintenanceStateStore | null> {
  try {
    const store = await deps.getStore()
    await store.readState()
    return store
  } catch (error) {
    deps.output.error(`ERROR: maintenance state store is unreachable (${(error as Error).message}).`)
    deps.setExitCode(MAINTENANCE_EXIT.storeUnreachable)
    return null
  }
}

async function readStateOrInitial(store: MaintenanceStateStore): Promise<MaintenanceStateV1> {
  const read = await store.readState()
  if (read.kind === 'unsupported') throw new Error(`[internal] Maintenance state is unreadable (${read.reason})`)
  return read.kind === 'ok' ? read.state : createInitialState()
}

function formatDrainReport(report: DrainReport): string[] {
  const lines = [`Gate revision ${report.gateRevision}: ${report.drained ? 'drained' : 'NOT drained'}`]
  for (const entry of report.processes) {
    const flags = [entry.stale ? 'stale' : null, entry.acknowledged ? 'acked' : 'pending'].filter(Boolean).join(', ')
    lines.push(`  ${entry.kind.padEnd(9)} ${entry.host}:${entry.pid} acked=${entry.ackedGateRevision} inflight=${entry.inflight} (${flags})`)
  }
  for (const missing of report.missing) {
    lines.push(`  missing ${missing.kind}: expected ${missing.expected}, seen ${missing.seen}`)
  }
  return lines
}

function osUser(): string | undefined {
  try {
    return os.userInfo().username
  } catch {
    return undefined
  }
}

export function createMaintenanceCliCommands(deps: MaintenanceCliDeps): ModuleCli[] {
  const { output } = deps

  const on: ModuleCli = {
    command: 'on',
    help: 'Activate maintenance mode: mercato maintenance on [--title] [--message] [--until <iso> | --duration 45m] [--retry-after <s>] [--reason] [--allow-bypass [--bypass-ttl 2h]] [--rotate-bypass] [--expect-processes web=N,worker=M,scheduler=K] [--wait-drain [--drain-timeout 120s]] [--json]',
    async run(argv) {
      const args = parseArgs(argv)
      const json = args.json === true
      let until: string | null | undefined
      let expectedProcesses: MaintenanceExpectedProcesses | null | undefined
      let drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS
      let bypassTtlMs = DEFAULT_BYPASS_TTL_MS
      let retryAfterSeconds: number | undefined
      try {
        until = parseUntil(args, new Date())
        expectedProcesses = parseExpected(args)
        drainTimeoutMs = parseTimeoutMs(args, 'drain-timeout')
        const ttlRaw = stringOpt(args, 'bypass-ttl')
        if (ttlRaw !== undefined) {
          const ttl = parseDurationMs(ttlRaw)
          if (!ttl) throw new CliUsageError(`--bypass-ttl must look like 2h or 30m, got "${ttlRaw}".`)
          bypassTtlMs = ttl
        }
        const retryRaw = stringOpt(args, 'retry-after')
        if (retryRaw !== undefined) {
          retryAfterSeconds = Number(retryRaw)
          if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) throw new CliUsageError('--retry-after must be a positive number of seconds.')
        }
      } catch (error) {
        if (error instanceof CliUsageError) {
          output.error(`ERROR: ${error.message}`)
          deps.setExitCode(MAINTENANCE_EXIT.invalidArgs)
          return
        }
        throw error
      }
      const store = await openStore(deps)
      if (!store) return
      const issueBypass = args['allow-bypass'] === true || args['rotate-bypass'] === true
      const token = issueBypass ? generateBypassToken() : null
      let result
      try {
        result = await mutateState(store, (current, now) => {
          if (issueBypass && current.hold) {
            throw new CliUsageError(`Operation "${current.hold.operation}" holds the window; changing the bypass token now would abort it. Retry after it finishes.`)
          }
          return activateState(current, {
            title: stringOpt(args, 'title'),
            message: stringOpt(args, 'message'),
            until,
            retryAfterSeconds,
            reason: stringOpt(args, 'reason'),
            startedBy: { source: 'cli', host: deps.config.host, osUser: osUser() },
            bypassTokenSha256: token ? hashBypassToken(token) : null,
            bypassExpiresAt: token ? new Date(now.getTime() + bypassTtlMs).toISOString() : null,
            expectedProcesses: expectedProcesses === undefined ? (current.active ? undefined : deps.config.expectedProcesses) : expectedProcesses,
          }, now)
        })
      } catch (error) {
        if (error instanceof CliUsageError) {
          output.error(`ERROR: ${error.message}`)
          deps.setExitCode(MAINTENANCE_EXIT.invalidArgs)
          return
        }
        output.error(`ERROR: could not update maintenance state (${(error as Error).message.replace('[internal] ', '')}).`)
        deps.setExitCode(MAINTENANCE_EXIT.storeUnreachable)
        return
      }
      if (result.created) {
        await emitMaintenanceEventSafely('maintenance.window.started', { windowId: result.windowId, operation: 'cli' })
      }
      let drainReport: DrainReport | null = null
      if (args['wait-drain'] === true) {
        const state = await readStateOrInitial(store)
        drainReport = await waitForDrain(store, {
          targetRevision: state.gateRevision,
          expected: state.expectedProcesses,
          heartbeatMs: deps.config.heartbeatMs,
          timeoutMs: drainTimeoutMs,
        })
      }
      if (json) {
        output.log(JSON.stringify({
          version: JSON_VERSION,
          active: true,
          windowId: result.windowId,
          created: result.created,
          bypassUrl: token ? BYPASS_PATH : null,
          bypassToken: token,
          drain: drainReport,
        }))
      } else {
        output.log(result.created ? `Maintenance mode is ON. Window ${result.windowId}.` : `Maintenance window ${result.windowId} updated.`)
        if (token) {
          output.log(`Bypass page: ${BYPASS_PATH}`)
          output.log(`Bypass token (shown once, valid ${Math.round(bypassTtlMs / 60000)} min): ${token}`)
        }
        if (drainReport) for (const line of formatDrainReport(drainReport)) output.log(line)
      }
      if (drainReport && !drainReport.drained) {
        output.error('ERROR: drain timed out; maintenance mode stays on.')
        deps.setExitCode(MAINTENANCE_EXIT.drainTimeout)
      }
    },
  }

  const off: ModuleCli = {
    command: 'off',
    help: 'Deactivate maintenance mode: mercato maintenance off [--force-release-stale-holds] [--json]',
    async run(argv) {
      const args = parseArgs(argv)
      const json = args.json === true
      if (deps.config.force) {
        output.error('ERROR: OM_MAINTENANCE_FORCE=1 forces maintenance on; unset it and restart the processes instead.')
        deps.setExitCode(MAINTENANCE_EXIT.held)
        return
      }
      const store = await openStore(deps)
      if (!store) return
      const forceStale = args['force-release-stale-holds'] === true
      const [processes, storeNow] = await Promise.all([store.listProcesses(), store.now()])
      const outcome = await mutateState<OffOutcome>(store, (current, now) => {
        if (!current.active) return { next: null, result: { kind: 'inactive' as const } }
        let working = current
        if (working.hold && forceStale && isHoldOwnerProvablyStopped(working.hold, storeNow, deps.config.heartbeatMs, deps.config.host)) {
          working = { ...working, hold: null }
        }
        if (working.hold) return { next: null, result: { kind: 'held' as const, holder: working.hold } }
        if (working.reopenBarrier) {
          const check = checkReopenBarrier({ state: working, processes, expected: working.expectedProcesses, now: storeNow, heartbeatMs: deps.config.heartbeatMs })
          if (!check.ok) return { next: null, result: { kind: 'barrier' as const, check } }
        }
        const block = deactivationBlock({ ...working, reopenBarrier: null })
        if (block) return { next: null, result: { kind: 'held' as const, holder: working.hold! } }
        return { next: deactivateState(working, now), result: { kind: 'ended' as const, windowId: working.windowId } }
      })
      if (outcome.kind === 'inactive') {
        output.log(json ? JSON.stringify({ version: JSON_VERSION, active: false, changed: false }) : 'Maintenance mode is already off.')
        return
      }
      if (outcome.kind === 'held') {
        const holder = outcome.holder
        output.error(`ERROR: refusing to turn maintenance off while operation "${holder.operation}" holds the window (hold ${holder.id}, ${holder.host}:${holder.pid}, heartbeat ${holder.heartbeatAt}).`)
        if (forceStale) output.error('The hold owner could not be proven stopped (it must be stale and its pid dead on this host).')
        deps.setExitCode(MAINTENANCE_EXIT.held)
        return
      }
      if (outcome.kind === 'barrier') {
        const check = outcome.check
        if (check.ok === false && check.reason === 'pending_verification') {
          output.error('ERROR: a reopen barrier is pending verification of a policy retirement; complete the encryption runbook recovery first.')
        } else if (check.ok === false && check.reason === 'writers_not_restarted') {
          output.error('ERROR: writers still run the pre-retirement policy; restart them before reopening:')
          for (const record of check.processes) output.error(`  ${record.kind} ${record.host}:${record.pid} started ${record.startedAt}`)
          for (const missing of check.report.missing) output.error(`  missing ${missing.kind}: expected ${missing.expected}, seen ${missing.seen}`)
        }
        deps.setExitCode(MAINTENANCE_EXIT.held)
        return
      }
      await emitMaintenanceEventSafely('maintenance.window.ended', { windowId: outcome.windowId, operation: 'cli' })
      output.log(json ? JSON.stringify({ version: JSON_VERSION, active: false, changed: true, windowId: outcome.windowId }) : 'Maintenance mode is OFF.')
    },
  }

  const status: ModuleCli = {
    command: 'status',
    help: 'Show maintenance state, holds and per-process acknowledgments: mercato maintenance status [--json]',
    async run(argv) {
      const args = parseArgs(argv)
      const store = await openStore(deps)
      if (!store) return
      const read = await store.readState()
      const state = read.kind === 'ok' ? read.state : createInitialState()
      const report = await collectDrainReport(store, state.gateRevision, state.expectedProcesses, deps.config.heartbeatMs)
      const source = deps.config.force ? 'env' : 'store'
      const hosts = new Set(report.processes.filter((entry) => !entry.stale).map((entry) => entry.host))
      const warnings: string[] = []
      if (read.kind === 'unsupported') warnings.push(`State document is unreadable (${read.reason}); gates fail safe and treat the instance as in maintenance.`)
      if (store.kind === 'file' && hosts.size > 1) warnings.push('The file store is single-host but processes on several hosts report heartbeats; use OM_MAINTENANCE_STORE=redis.')
      if (args.json === true) {
        output.log(JSON.stringify({
          version: JSON_VERSION,
          active: deps.config.force || state.active,
          source,
          store: store.kind,
          windowId: state.windowId,
          epoch: state.epoch,
          gateRevision: state.gateRevision,
          startedAt: state.startedAt,
          startedBy: state.startedBy,
          until: state.until,
          retryAfterSeconds: state.retryAfterSeconds,
          page: state.page,
          bypass: { enabled: state.bypass.enabled, expiresAt: state.bypass.expiresAt },
          expectedProcesses: state.expectedProcesses,
          hold: state.hold ? { ...state.hold, stale: isHeartbeatStale(state.hold.heartbeatAt, new Date(report.checkedAt), deps.config.heartbeatMs) } : null,
          reopenBarrier: state.reopenBarrier,
          processes: report.processes,
          history: state.history,
          warnings,
        }))
        return
      }
      output.log(`Maintenance: ${deps.config.force || state.active ? 'ON' : 'OFF'} (source: ${source}, store: ${store.kind})`)
      if (state.active) {
        output.log(`Window ${state.windowId} since ${state.startedAt}${state.until ? `, until ${state.until}` : ''}`)
        if (state.reason) output.log(`Reason: ${state.reason}`)
        output.log(`Bypass: ${state.bypass.enabled ? `enabled until ${state.bypass.expiresAt ?? 'window end'}` : 'disabled'}`)
      }
      if (state.hold) output.log(`Hold: ${state.hold.operation} (${state.hold.id}) by ${state.hold.host}:${state.hold.pid}, heartbeat ${state.hold.heartbeatAt}`)
      if (state.reopenBarrier) output.log(`Reopen barrier: ${state.reopenBarrier.generation ? `generation ${state.reopenBarrier.generation}` : 'pending verification'}`)
      for (const line of formatDrainReport(report)) output.log(line)
      for (const warning of warnings) output.error(`WARNING: ${warning}`)
    },
  }

  const drain: ModuleCli = {
    command: 'drain',
    help: 'Wait for every process to acknowledge the active window idle: mercato maintenance drain [--timeout 120s] [--expect-processes web=N,worker=M,scheduler=K] [--json]',
    async run(argv) {
      const args = parseArgs(argv)
      let timeoutMs: number
      let expected: MaintenanceExpectedProcesses | null | undefined
      try {
        timeoutMs = parseTimeoutMs(args, 'timeout')
        expected = parseExpected(args)
      } catch (error) {
        if (error instanceof CliUsageError) {
          output.error(`ERROR: ${error.message}`)
          deps.setExitCode(MAINTENANCE_EXIT.invalidArgs)
          return
        }
        throw error
      }
      const store = await openStore(deps)
      if (!store) return
      const state = await readStateOrInitial(store)
      if (!state.active && !deps.config.force) {
        output.error('ERROR: maintenance mode is not active.')
        deps.setExitCode(MAINTENANCE_EXIT.notActive)
        return
      }
      const report = await waitForDrain(store, {
        targetRevision: state.gateRevision,
        expected: expected === undefined ? state.expectedProcesses ?? deps.config.expectedProcesses : expected,
        heartbeatMs: deps.config.heartbeatMs,
        timeoutMs,
      })
      if (args.json === true) output.log(JSON.stringify({ version: JSON_VERSION, ...report }))
      else for (const line of formatDrainReport(report)) output.log(line)
      if (!report.drained) deps.setExitCode(MAINTENANCE_EXIT.drainTimeout)
    },
  }

  return [on, off, status, drain].map((command) => ({
    ...command,
    async run(argv: string[]) {
      try {
        await command.run(argv)
      } catch (error) {
        const message = error instanceof Error ? error.message.replace('[internal] ', '') : String(error)
        output.error(`ERROR: maintenance state store operation failed (${message}).`)
        deps.setExitCode(MAINTENANCE_EXIT.storeUnreachable)
      }
    },
  }))
}

function createDefaultDeps(): MaintenanceCliDeps & { closeStore(): Promise<void> } {
  const config = resolveMaintenanceConfig()
  let storePromise: Promise<MaintenanceStateStore> | null = null
  return {
    async closeStore() {
      const store = storePromise ? await storePromise.catch(() => null) : null
      await store?.close()
    },
    config,
    getStore: () => {
      if (!storePromise) storePromise = createMaintenanceStore(config)
      return storePromise
    },
    output: {
      log: (message: string) => console.log(message),
      error: (message: string) => console.error(message),
    },
    setExitCode: (code: number) => {
      process.exitCode = code
    },
  }
}

function withDefaultDeps(): ModuleCli[] {
  const names = ['on', 'off', 'status', 'drain']
  return names.map((name) => ({
    command: name,
    help: createMaintenanceCliCommands(createDefaultDeps()).find((entry) => entry.command === name)?.help,
    async run(argv: string[]) {
      const deps = createDefaultDeps()
      const command = createMaintenanceCliCommands(deps).find((entry) => entry.command === name)!
      try {
        await command.run(argv)
      } finally {
        await deps.closeStore()
      }
    },
  }))
}

export default withDefaultDeps()
