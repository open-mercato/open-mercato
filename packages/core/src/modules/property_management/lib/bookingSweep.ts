import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Booking, Unavailability, Unit, type UnavailabilitySubjectType } from '../data/entities'
import { subjectsOf, unavailableDuring, windowOf, windowsForUnit, type UnavailabilityWindow, type UnitPlacement } from './availabilityResolver'
import { buildTrustedSalesContext } from './salesCommandContext'
import { reenqueueOpenOperations } from './leaseSweep'
import { resumeApplyingUnavailabilities } from './unavailabilityApply'
import type { OperationEnqueuer } from './salesOperations'
import type { Scope } from './productUse'
import { isCursorId, resolveSweepCache, SWEEP_CURSOR_TTL_MS } from './sweepCache'
import { compareWallClock, localNow, normalizeWallClock, parseWallClock, toStoredWallClock } from './wallClock'

const logger = createLogger('property_management')

export { BOOKING_SWEEP_QUEUE } from './queues'
const SWEEP_BATCH = 500
const SWEEP_MAX_PAGES = 20
export const SWEEP_MAX_COMPLETE_ATTEMPTS = 500
export const SWEEP_MAX_CONSECUTIVE_FAILURES = 20
export { SWEEP_CURSOR_TTL_MS }

export type BookingSweepSummary = { completed: number; reenqueued: number; resumedClosures: number }

export type BookingSweepDeps = {
  container: AwilixContainer
  em: EntityManager
  now?: string
  enqueuer?: OperationEnqueuer
  skipReenqueue?: boolean
}

type PastBooking = Pick<Booking, 'id' | 'unitId' | 'startsAt' | 'endsAt'>

export type ApplyingClosures = { windows: UnavailabilityWindow[]; cancelAfter: Map<string, string> }

type ApplyingClosureRow = Pick<
  Unavailability,
  'id' | 'subjectType' | 'subjectId' | 'reasonEntryId' | 'reasonText' | 'startsAt' | 'endsAt' | 'endedAt' | 'createdAt'
>

export type SweepCursor = { endsAt: string; id: string }

type SweepRange = { after: SweepCursor | null; upTo: SweepCursor | null }

type SweepRun = {
  commandBus: CommandBus
  ctx: CommandRuntimeContext
  completed: number
  attempts: number
  consecutiveFailures: number
}

export function applyingClosuresOf(closures: readonly ApplyingClosureRow[]): ApplyingClosures | null {
  const windows = closures.map(windowOf).filter((window): window is UnavailabilityWindow => window !== null)
  if (!windows.length) return null
  return { windows, cancelAfter: new Map(closures.map((closure) => [closure.id, localNow(closure.createdAt)])) }
}

export function isHeldBackByClosure(
  placement: UnitPlacement & { deletedAt?: Date | null },
  booking: { startsAt: string; endsAt: string },
  closures: ApplyingClosures,
): boolean {
  if (placement.deletedAt) return false
  const range = { start: normalizeWallClock(booking.startsAt), end: normalizeWallClock(booking.endsAt) }
  return unavailableDuring(windowsForUnit(placement, closures.windows), range).some((window) => {
    const cutoff = window.id ? closures.cancelAfter.get(window.id) : undefined
    return cutoff !== undefined && compareWallClock(range.end, cutoff) > 0
  })
}

function subjectFilters(placements: readonly UnitPlacement[]): Record<string, unknown>[] {
  const idsByType = new Map<UnavailabilitySubjectType, Set<string>>()
  for (const placement of placements) {
    for (const subject of subjectsOf(placement)) {
      if (!subject.id) continue
      const ids = idsByType.get(subject.type) ?? new Set<string>()
      ids.add(subject.id)
      idsByType.set(subject.type, ids)
    }
  }
  return Array.from(idsByType, ([subjectType, ids]) => ({ subjectType, subjectId: { $in: Array.from(ids) } }))
}

async function loadApplyingClosures(deps: BookingSweepDeps, scope: Scope, placements: readonly UnitPlacement[]): Promise<ApplyingClosures | null> {
  const filters = subjectFilters(placements)
  if (!filters.length) return null
  const closures = await findWithDecryption<Unavailability>(
    deps.em.fork(),
    Unavailability,
    { ...scope, applyStatus: 'applying', deletedAt: null, $or: filters },
    {
      limit: SWEEP_BATCH,
      orderBy: { createdAt: 'asc', id: 'asc' },
      fields: ['id', 'subjectType', 'subjectId', 'reasonEntryId', 'reasonText', 'startsAt', 'endsAt', 'endedAt', 'createdAt'],
    },
    scope,
  )
  if (closures.length >= SWEEP_BATCH) {
    logger.warn(
      'More unavailabilities are applying on the units of one booking sweep page than the sweep reads; the complete command still re-checks every booking it completes against all of them under its row lock',
      { limit: SWEEP_BATCH, organizationId: scope.organizationId },
    )
  }
  return applyingClosuresOf(closures)
}

async function bookingsHeldBack(deps: BookingSweepDeps, scope: Scope, candidates: readonly PastBooking[]): Promise<Set<string>> {
  const unitIds = Array.from(new Set(candidates.map((candidate) => candidate.unitId)))
  const units = await findWithDecryption(
    deps.em.fork(),
    Unit,
    { ...scope, id: { $in: unitIds }, deletedAt: null },
    { fields: ['id', 'buildingId', 'floorId', 'spaceId'] },
    scope,
  )
  const closures = await loadApplyingClosures(deps, scope, units)
  if (!closures) return new Set()
  const placements = new Map(units.map((unit) => [unit.id, unit]))
  const covered = candidates.filter((candidate) => {
    const unit = placements.get(candidate.unitId)
    return unit ? isHeldBackByClosure(unit, candidate, closures) : false
  })
  return new Set(covered.map((candidate) => candidate.id))
}

export function sweepCursorKey(scope: Scope): string {
  return `property_management:booking_sweep:cursor:${scope.tenantId}:${scope.organizationId}`
}

function isWallClock(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = parseWallClock(value)
  if (!parts) return false
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds))
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hours &&
    date.getUTCMinutes() === parts.minutes &&
    date.getUTCSeconds() === parts.seconds
  )
}

function parseSweepCursor(value: unknown): SweepCursor | null {
  if (!value || typeof value !== 'object') return null
  const { endsAt, id } = value as Record<string, unknown>
  return isWallClock(endsAt) && isCursorId(id) ? { endsAt, id } : null
}

function reportCursorFailure(operation: 'load' | 'save', scope: Scope, err: unknown): void {
  logger.warn('The booking sweep cursor is unavailable; the sweep starts from the oldest past booking', { operation, organizationId: scope.organizationId, err })
  getTelemetryRuntime()?.reportError(err, {
    module: 'property_management',
    code: 'property_management.booking_sweep_cursor_failed',
    attributes: { operation },
  })
}

async function loadSweepCursor(cache: CacheStrategy | null, scope: Scope): Promise<SweepCursor | null> {
  if (!cache) return null
  const key = sweepCursorKey(scope)
  try {
    return await runWithCacheTenant(scope.tenantId, async () => {
      const stored = await cache.get(key)
      if (stored === null || stored === undefined) return null
      const cursor = parseSweepCursor(stored)
      if (!cursor) {
        logger.warn('The booking sweep cursor is malformed; the sweep starts from the oldest past booking', { organizationId: scope.organizationId })
        await cache.delete(key)
      }
      return cursor
    })
  } catch (err) {
    reportCursorFailure('load', scope, err)
    return null
  }
}

async function saveSweepCursor(cache: CacheStrategy | null, scope: Scope, cursor: SweepCursor | null): Promise<void> {
  if (!cache) return
  const key = sweepCursorKey(scope)
  try {
    await runWithCacheTenant(scope.tenantId, async () => {
      if (cursor) await cache.set(key, cursor, { ttl: SWEEP_CURSOR_TTL_MS })
      else await cache.delete(key)
    })
  } catch (err) {
    reportCursorFailure('save', scope, err)
  }
}

function cursorOf(booking: PastBooking): SweepCursor {
  return { endsAt: booking.endsAt, id: booking.id }
}

function rangeFilters(range: SweepRange): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = []
  const { after, upTo } = range
  if (after) filters.push({ $or: [{ endsAt: { $gt: after.endsAt } }, { endsAt: after.endsAt, id: { $gt: after.id } }] })
  if (upTo) filters.push({ $or: [{ endsAt: { $lt: upTo.endsAt } }, { endsAt: upTo.endsAt, id: { $lte: upTo.id } }] })
  return filters
}

async function loadPastBookings(deps: BookingSweepDeps, scope: Scope, now: string, range: SweepRange): Promise<PastBooking[]> {
  const where: Record<string, unknown> = { ...scope, status: 'confirmed', endsAt: { $lte: toStoredWallClock(now) }, deletedAt: null }
  const filters = rangeFilters(range)
  if (filters.length) where.$and = filters
  return findWithDecryption(
    deps.em.fork(),
    Booking,
    where,
    { limit: SWEEP_BATCH, orderBy: { endsAt: 'asc', id: 'asc' }, fields: ['id', 'unitId', 'startsAt', 'endsAt'] },
    scope,
  )
}

function isExhausted(run: SweepRun): boolean {
  return run.attempts >= SWEEP_MAX_COMPLETE_ATTEMPTS || run.consecutiveFailures >= SWEEP_MAX_CONSECUTIVE_FAILURES
}

function startSweepRun(deps: BookingSweepDeps, scope: Scope): SweepRun {
  return {
    commandBus: deps.container.resolve('commandBus') as CommandBus,
    ctx: buildTrustedSalesContext(deps.container, scope),
    completed: 0,
    attempts: 0,
    consecutiveFailures: 0,
  }
}

async function completePage(deps: BookingSweepDeps, scope: Scope, run: SweepRun, candidates: readonly PastBooking[]): Promise<SweepCursor | null> {
  const heldBack = await bookingsHeldBack(deps, scope, candidates)
  let visited: SweepCursor | null = null
  for (const candidate of candidates) {
    if (isExhausted(run)) break
    visited = cursorOf(candidate)
    if (heldBack.has(candidate.id)) continue
    const input = { id: candidate.id, ...scope }
    run.attempts += 1
    try {
      const { result } = await run.commandBus.execute<typeof input, { completed: boolean }>('property_management.booking.complete', { input, ctx: run.ctx })
      run.consecutiveFailures = 0
      if (result?.completed) run.completed += 1
    } catch (err) {
      run.consecutiveFailures += 1
      logger.error('Completing a past booking failed', { bookingId: candidate.id, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.booking_complete_failed' })
    }
  }
  return visited
}

async function completePastBookings(deps: BookingSweepDeps, scope: Scope, now: string): Promise<number> {
  const cache = resolveSweepCache(deps.container)
  const start = await loadSweepCursor(cache, scope)
  let range: SweepRange | null = { after: start, upTo: null }
  let wrapped = start === null
  let resumeAt: SweepCursor | null = null
  let run: SweepRun | null = null
  for (let page = 1; range && page <= SWEEP_MAX_PAGES; page += 1) {
    const candidates = await loadPastBookings(deps, scope, now, range)
    if (candidates.length) {
      run ??= startSweepRun(deps, scope)
      resumeAt = (await completePage(deps, scope, run, candidates)) ?? resumeAt
      if (isExhausted(run)) break
    }
    if (candidates.length >= SWEEP_BATCH) {
      range = { ...range, after: cursorOf(candidates[candidates.length - 1]) }
    } else if (wrapped) {
      range = null
    } else {
      wrapped = true
      range = { after: null, upTo: start }
    }
  }
  await saveSweepCursor(cache, scope, range ? resumeAt : null)
  if (run && run.consecutiveFailures >= SWEEP_MAX_CONSECUTIVE_FAILURES) {
    logger.warn('Completing past bookings kept failing; the booking sweep stops for this run and continues after them on the next one', {
      consecutiveFailures: run.consecutiveFailures,
      organizationId: scope.organizationId,
    })
  }
  return run?.completed ?? 0
}

async function sweepStep(step: string, scope: Scope, run: () => Promise<number>): Promise<number> {
  try {
    return await run()
  } catch (err) {
    logger.error('A booking sweep step failed; the sweep continues with the next one', { step, organizationId: scope.organizationId, err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'property_management',
      code: 'property_management.booking_sweep_step_failed',
      attributes: { step },
    })
    return 0
  }
}

export async function runBookingSweep(deps: BookingSweepDeps, scope: Scope): Promise<BookingSweepSummary> {
  const now = deps.now ?? localNow()
  const completed = await sweepStep('complete_past_bookings', scope, () => completePastBookings(deps, scope, now))
  const reenqueued = deps.skipReenqueue ? 0 : await sweepStep('reenqueue_operations', scope, () => reenqueueOpenOperations(deps, scope))
  const resumedClosures = await sweepStep('resume_applying_unavailabilities', scope, () => resumeApplyingUnavailabilities(deps.em, scope))
  return { completed, reenqueued, resumedClosures }
}
