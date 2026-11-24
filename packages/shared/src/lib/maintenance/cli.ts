import { resolveMaintenanceCoordinator, withMaintenanceHold, type MaintenanceHoldScope } from './hold'
import {
  MaintenanceDrainTimeoutError,
  MaintenanceHeldError,
  MaintenanceHoldLostError,
  MaintenanceInventoryMissingError,
  MaintenanceNotActiveError,
  MaintenanceOperationBusyError,
  MaintenanceStoreNotDurableError,
  MaintenanceStoreUnavailableError,
  MaintenanceWriterFenceUnavailableError,
  isMaintenanceError,
  type MaintenanceError,
} from './types'

/** Exit codes shared by every maintenance-protected encryption command. */
export const ENCRYPTION_MAINTENANCE_EXIT = {
  drainTimeout: 3,
  storeUnavailable: 4,
  busy: 5,
  notActive: 7,
} as const

export const ENTER_MAINTENANCE_FLAG = 'enter-maintenance'
export const EXIT_MAINTENANCE_FLAG = 'exit-maintenance'

const DEFAULT_DRAIN_TIMEOUT_MS = 120_000

export type EncryptionMaintenanceIo = {
  log(message: string): void
  error(message: string): void
  setExitCode(code: number): void
}

const defaultIo: EncryptionMaintenanceIo = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  setExitCode: (code) => {
    process.exitCode = code
  },
}

type ResolvableContainer = Parameters<typeof resolveMaintenanceCoordinator>[0]

export type EncryptionMaintenanceOptions = {
  operation: string
  dryRun: boolean
  enterMaintenance: boolean
  exitMaintenance: boolean
  drainTimeoutMs?: number
}

export type EncryptionMaintenanceScope = MaintenanceHoldScope

function red(label: string): string {
  return process.stderr.isTTY ? `\u001b[31m${label}\u001b[0m` : label
}

function readDrainTimeoutMs(explicit: number | undefined): number {
  if (explicit !== undefined) return explicit
  const parsed = Number(process.env.OM_MAINTENANCE_DRAIN_TIMEOUT_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRAIN_TIMEOUT_MS
}

export function describeMaintenanceRefusal(error: MaintenanceError, operation: string): { exitCode: number; lines: string[] } {
  if (error instanceof MaintenanceNotActiveError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.notActive,
      lines: [
        `${operation} requires a drained maintenance window on this Enterprise install. No writes were made.`,
        'Run `mercato maintenance on --wait-drain` first, or rerun this command with --enter-maintenance.',
      ],
    }
  }
  if (error instanceof MaintenanceDrainTimeoutError) {
    const lines = [`Maintenance drain timed out before ${operation} could start. No writes were made; maintenance stays on.`]
    for (const entry of error.report.outstanding) {
      lines.push(`  not acknowledged: ${entry.kind} ${entry.host}:${entry.pid} (acked revision ${entry.ackedGateRevision}, in flight ${entry.inflight})`)
    }
    for (const missing of error.report.missing) {
      lines.push(`  missing ${missing.kind}: expected ${missing.expected}, seen ${missing.seen}`)
    }
    return { exitCode: ENCRYPTION_MAINTENANCE_EXIT.drainTimeout, lines }
  }
  if (error instanceof MaintenanceInventoryMissingError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.drainTimeout,
      lines: [
        `${operation} needs the expected writer inventory to prove the drain. No writes were made.`,
        'Set OM_MAINTENANCE_EXPECTED_PROCESSES (for example web=2,worker=1,scheduler=1) or run `mercato maintenance on --expect-processes ...`.',
      ],
    }
  }
  if (error instanceof MaintenanceOperationBusyError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.busy,
      lines: [`Another maintenance operation (${error.holder?.operation ?? 'unknown'}) holds the window. No writes were made.`],
    }
  }
  if (error instanceof MaintenanceStoreNotDurableError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable,
      lines: [`The maintenance state store is not durable (enable Redis AOF or RDB persistence). ${operation} refuses to run. No writes were made.`],
    }
  }
  if (error instanceof MaintenanceWriterFenceUnavailableError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable,
      lines: [`Writers on other hosts report heartbeats but the file maintenance store is single-host; use OM_MAINTENANCE_STORE=redis. No writes were made.`],
    }
  }
  if (error instanceof MaintenanceHoldLostError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable,
      lines: [`The maintenance hold was lost while ${operation} ran; it stopped before the next batch. Maintenance stays on; follow the encryption runbook before reopening.`],
    }
  }
  if (error instanceof MaintenanceStoreUnavailableError) {
    return {
      exitCode: ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable,
      lines: [`The maintenance state store is unreachable. ${operation} fails closed; no writes were made.`],
    }
  }
  return { exitCode: ENCRYPTION_MAINTENANCE_EXIT.storeUnavailable, lines: [`${operation} refused: ${error.message.replace('[internal] ', '')}`] }
}

/**
 * Runs a mutating encryption-maintenance command. Without a registered coordinator (OSS, or
 * Enterprise modules disabled) `fn` runs exactly as before. With one, `fn` runs only inside an
 * exclusive, drained, bypass-forbidding hold; refusals print an ERROR and set the exit code
 * without calling `fn`. The window always stays on afterwards unless `--exit-maintenance`
 * was given and the run succeeded.
 */
export async function runEncryptionMaintenance(
  container: ResolvableContainer,
  options: EncryptionMaintenanceOptions,
  fn: (scope: EncryptionMaintenanceScope) => Promise<void>,
  io: EncryptionMaintenanceIo = defaultIo,
): Promise<void> {
  const noopScope: EncryptionMaintenanceScope = {
    hold: null,
    coordinator: null,
    windowId: null,
    enteredByCaller: false,
    assertLive: async () => {},
  }
  if (options.dryRun) {
    await fn(noopScope)
    return
  }
  const coordinator = resolveMaintenanceCoordinator(container)
  if (!coordinator) {
    if (options.enterMaintenance || options.exitMaintenance) {
      io.log(`Maintenance module is not installed; --${ENTER_MAINTENANCE_FLAG}/--${EXIT_MAINTENANCE_FLAG} are ignored.`)
    }
    await fn(noopScope)
    return
  }

  let started = false
  let windowId: string | null = null
  try {
    await withMaintenanceHold(
      container,
      options.operation,
      {
        enterIfInactive: options.enterMaintenance,
        forbidsBypass: true,
        requireDrained: true,
        drainTimeoutMs: readDrainTimeoutMs(options.drainTimeoutMs),
        reason: `${options.operation} (--${ENTER_MAINTENANCE_FLAG})`,
      },
      async (scope) => {
        started = true
        windowId = scope.windowId
        io.log(`Maintenance hold acquired for ${options.operation} (window ${scope.windowId}).`)
        await fn(scope)
      },
    )
  } catch (error) {
    if (isMaintenanceError(error) && (!started || error instanceof MaintenanceHoldLostError)) {
      const refusal = describeMaintenanceRefusal(error, options.operation)
      io.error(`${red('ERROR')}: ${refusal.lines[0]}`)
      for (const line of refusal.lines.slice(1)) io.error(line)
      io.setExitCode(refusal.exitCode)
      return
    }
    io.error(`${red('ERROR')}: ${options.operation} failed. The maintenance hold was released and maintenance mode stays ON.`)
    throw error
  }

  if (options.exitMaintenance && windowId) {
    try {
      await coordinator.exit({ windowId, operation: options.operation })
      io.log('Maintenance mode is OFF.')
    } catch (error) {
      if (error instanceof MaintenanceHeldError) {
        io.error(`${red('ERROR')}: maintenance stays ON — a reopen barrier or another hold blocks reopening. Restart every writer, then run \`mercato maintenance off\`.`)
        io.setExitCode(ENCRYPTION_MAINTENANCE_EXIT.busy)
        return
      }
      throw error
    }
    return
  }
  io.log('Maintenance mode stays ON. Verify the result, then run `mercato maintenance off`.')
}
