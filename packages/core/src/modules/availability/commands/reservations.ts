// Release 5 Phase 3 (Step 2.2). Thin command-bus wrappers over `lib/reservationCommands.ts`
// — same shape as `wms`'s `wms.inventory.reserve`/`.release` wrappers over
// `wmsReservationService` (see that file's own "Undo Policy" header comment): all the
// locking/allocation/CAS logic lives in the lib function; these commands exist only so
// `availability.reserve`/`.release`/`.commit` are reachable through the command bus
// (checkout resolves them softly, D-R5-18) and carry the audit trail.
//
// `isUndoable: false` (A14/D-R5-10): reversal is an explicit counter-action — `release`
// with a reason, or checkout's own compensation table (§7.3) — never a generic undo. A
// committed order hold must never be returned to `checkout` from the audit log.
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  commitAvailability,
  releaseAvailability,
  reserveAvailability,
  type CommitAvailabilityResult,
  type ReleaseAvailabilityResult,
  type ReserveAvailabilityResult,
} from '../lib/reservationCommands'

const reserveAvailabilityCommand: CommandHandler<unknown, ReserveAvailabilityResult> = {
  id: 'availability.reserve',
  isUndoable: false,
  async execute(input, ctx) {
    return reserveAvailability(ctx.container, input)
  },
  buildLog: async ({ input, result }) => {
    const parsed = (input ?? {}) as { tenantId?: string; organizationId?: string; sourceId?: string }
    return {
      actionLabel: 'Reserve availability',
      resourceKind: 'availability.reservation',
      resourceId: result?.reservationId ?? null,
      parentResourceId: parsed.sourceId ?? null,
      tenantId: parsed.tenantId ?? null,
      organizationId: parsed.organizationId ?? null,
    }
  },
}

const releaseAvailabilityCommand: CommandHandler<unknown, ReleaseAvailabilityResult> = {
  id: 'availability.release',
  isUndoable: false,
  async execute(input, ctx) {
    return releaseAvailability(ctx.container, input)
  },
  buildLog: async ({ input, result }) => {
    const parsed = (input ?? {}) as { tenantId?: string; organizationId?: string }
    return {
      actionLabel: 'Release availability reservation',
      resourceKind: 'availability.reservation',
      resourceId: result?.reservationId ?? null,
      tenantId: parsed.tenantId ?? null,
      organizationId: parsed.organizationId ?? null,
    }
  },
}

const commitAvailabilityCommand: CommandHandler<unknown, CommitAvailabilityResult> = {
  id: 'availability.commit',
  isUndoable: false,
  async execute(input, ctx) {
    return commitAvailability(ctx.container, input)
  },
  buildLog: async ({ input, result }) => {
    const parsed = (input ?? {}) as { tenantId?: string; organizationId?: string; orderId?: string }
    return {
      actionLabel: 'Commit availability reservation',
      resourceKind: 'availability.reservation',
      resourceId: result?.reservationId ?? null,
      parentResourceId: parsed.orderId ?? null,
      tenantId: parsed.tenantId ?? null,
      organizationId: parsed.organizationId ?? null,
    }
  },
}

registerCommand(reserveAvailabilityCommand)
registerCommand(releaseAvailabilityCommand)
registerCommand(commitAvailabilityCommand)

export { reserveAvailabilityCommand, releaseAvailabilityCommand, commitAvailabilityCommand }
