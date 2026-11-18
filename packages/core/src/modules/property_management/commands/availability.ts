import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ActionLogCreateInput } from '@open-mercato/core/modules/audit_logs/data/validators'
import { Booking, Floor, Unavailability } from '../data/entities'
import {
  unavailabilityCreateSchema,
  unavailabilityEndSchema,
  type UnavailabilityCreateInput,
  type UnavailabilityEndInput,
  type UnavailabilityPreviewInput,
} from '../data/validators'
import { assertBuildingPermitted, type PermittedBuildings } from '../lib/buildingAccess'
import { conflictError, notFoundError, unprocessableError } from '../lib/errors'
import { crmName, loadCrmRecords, type CrmAccess } from '../lib/crmAccess'
import { effectiveEnd, windowOf } from '../lib/availabilityResolver'
import { bookingCrudIndexer, emitBookingEvent } from '../lib/bookingEvents'
import { enqueueSalesOperations } from '../lib/salesOperations'
import { loadSettings, type SettingsValues } from '../lib/settings'
import { assertReasonEntry } from '../lib/unavailabilityReasons'
import { HOLDING_BOOKING_STATUSES } from '../lib/usageGuards'
import {
  assertSubjectStillExists,
  computeClosureImpact,
  CONFIRM_BOOKING_FIELDS,
  CONFIRM_UNIT_FIELDS,
  countClosureBookings,
  findClosureBookings,
  findSubjectUnits,
  INLINE_CANCEL_LIMIT,
  loadUnavailabilitySubject,
  PREVIEW_LIST_LIMIT,
  type ClosureImpact,
  type UnavailabilitySubject,
} from '../lib/unavailabilityImpact'
import {
  applyFailureMessage,
  enqueueUnavailabilityApply,
  INLINE_CANCELLED_META_KEY,
  resolveProgressService,
  UNAVAILABILITY_APPLY_JOB_TYPE,
} from '../lib/unavailabilityApply'
import { compareWallClock, datePartOf, localNow, normalizeWallClock, startOfDay, toStoredWallClock } from '../lib/wallClock'
import { emitPropertyManagementEvent } from '../events'
import type { Scope } from '../lib/productUse'
import { BOOKING_RESOURCE_KIND, markBookingReleased, recordBookingOrderCancellations } from './booking'
import { buildCrudLog, ensureScope, lockBuilding, lockFloors, persistentEventOptions, resolveEm, resolvePermitted } from './shared'

const logger = createLogger('property_management')

export const UNAVAILABILITY_RESOURCE_KIND = 'property_management.unavailability'
const UNDO_BOOKING_FIELDS = ['id', 'unitId', 'startsAt', 'endsAt']

export type UnavailabilityPreview = {
  subject: { type: string; id: string; name: string }
  units: Array<{ id: string; name: string }>
  unitCount: number
  bookingsToCancel: Array<{ id: string; unitId: string; unit: string | null; startsAt: string; endsAt: string; person?: string | null }>
  bookingCount: number
  leasesToFlag: Array<{ id: string; reference: string; company?: string | null; unit: string | null; startsOn: string; endsOn: string }>
  leaseCount: number
  previewToken: string
  crmAccess: CrmAccess
}

export type UnavailabilityCreateResult = {
  unavailabilityId: string
  cancelledBookings: number
  queuedBookings: number
  flaggedLeases: number
  applyStatus: 'applied' | 'applying'
  progressJobId: string | null
}

export type UnavailabilityEndResult = { unavailabilityId: string; endedAt: string }

type UnavailabilityUndoPayload = {
  id: string
  tenantId: string
  organizationId: string
  previousEndedAt?: string | null
}

function scopeOfInput(input: { tenantId: string; organizationId: string }): Scope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

function rangeOf(input: { startsAt: string; endsAt?: string | null }): { start: string; end: string | null } {
  return { start: normalizeWallClock(input.startsAt), end: input.endsAt ? normalizeWallClock(input.endsAt) : null }
}

async function assertRangeNotPast(range: { start: string; end: string | null }, now: string): Promise<void> {
  if (range.end !== null && compareWallClock(range.end, now) <= 0) {
    throw await unprocessableError('property_management.errors.unavailabilityInPast', 'The unavailable period has already ended.', {
      code: 'unavailability_in_past',
      fieldErrors: { endsAt: 'property_management.errors.unavailabilityInPast' },
    })
  }
  if (compareWallClock(range.start, startOfDay(datePartOf(now))) < 0) {
    throw await unprocessableError('property_management.errors.unavailabilityStartInPast', 'The unavailable period cannot start before today.', {
      code: 'unavailability_start_in_past',
      fieldErrors: { startsAt: 'property_management.errors.unavailabilityStartInPast' },
    })
  }
}

async function assertBuildingNotArchived(status: string): Promise<void> {
  if (status === 'archived') {
    throw await conflictError('property_management.errors.unavailabilitySubjectArchived', 'An archived building cannot be changed.', {
      code: 'subject_archived',
    })
  }
}

async function assertCancelledStatusConfigured(
  settings: Pick<SettingsValues, 'cancelledOrderStatusEntryId'>,
  impact: Pick<ClosureImpact, 'bookingsNeedCancelledStatus'>,
): Promise<void> {
  if (settings.cancelledOrderStatusEntryId || !impact.bookingsNeedCancelledStatus) return
  throw await unprocessableError(
    'property_management.errors.cancelledStatusMissing',
    'Choose the sales order status used for cancelled bookings in Property Management settings first.',
    { code: 'cancelled_status_missing' },
  )
}

async function describeImpact(
  em: EntityManager,
  scope: Scope,
  subject: UnavailabilitySubject,
  impact: ClosureImpact,
  crmAccess: CrmAccess,
): Promise<UnavailabilityPreview> {
  const unitNames = new Map(impact.units.map((unit) => [unit.id, unit.name]))
  const bookings = impact.bookings
  const leases = impact.leases.slice(0, PREVIEW_LIST_LIMIT)
  const customers = await loadCrmRecords(em, scope, crmAccess, {
    people: bookings.map((booking) => booking.bookedByPersonId),
    companies: leases.map((lease) => lease.customerCompanyId),
  })
  return {
    subject: { type: subject.type, id: subject.id, name: subject.name },
    units: impact.units.slice(0, PREVIEW_LIST_LIMIT).map((unit) => ({ id: unit.id, name: unit.name })),
    unitCount: impact.units.length,
    bookingsToCancel: bookings.map((booking) => ({
      id: booking.id,
      unitId: booking.unitId,
      unit: unitNames.get(booking.unitId) ?? null,
      startsAt: normalizeWallClock(booking.startsAt),
      endsAt: normalizeWallClock(booking.endsAt),
      ...(crmAccess.people ? { person: crmName(customers, booking.bookedByPersonId) } : {}),
    })),
    bookingCount: impact.bookingCount,
    leasesToFlag: leases.map((lease) => ({
      id: lease.id,
      reference: lease.reference,
      ...(crmAccess.companies ? { company: crmName(customers, lease.customerCompanyId) } : {}),
      unit: unitNames.get(lease.unitId) ?? null,
      startsOn: lease.startsOn,
      endsOn: lease.endsOn,
    })),
    leaseCount: impact.leaseCount,
    previewToken: impact.previewToken,
    crmAccess,
  }
}

export async function previewUnavailability(
  em: EntityManager,
  scope: Scope,
  permitted: PermittedBuildings,
  input: UnavailabilityPreviewInput,
  crmAccess: CrmAccess,
): Promise<UnavailabilityPreview> {
  const subject = await loadUnavailabilitySubject(em, scope, permitted, input.subjectType, input.subjectId)
  await assertReasonEntry(em, scope, input.reasonEntryId)
  const now = localNow()
  const range = rangeOf(input)
  await assertRangeNotPast(range, now)
  const impact = await computeClosureImpact(em, scope, subject, range, now, { preview: true, bookingLimit: PREVIEW_LIST_LIMIT })
  if (impact.bookingsNeedCancelledStatus) await assertCancelledStatusConfigured(await loadSettings(em, scope), impact)
  return describeImpact(em, scope, subject, impact, crmAccess)
}

async function lockSubjectLayout(trx: EntityManager, scope: Scope, subject: UnavailabilitySubject): Promise<void> {
  const building = await lockBuilding(trx, scope, subject.buildingId)
  await assertBuildingNotArchived(building.status)
  const floorIds = subject.floorId
    ? [subject.floorId]
    : (await findWithDecryption(trx, Floor, { ...scope, buildingId: subject.buildingId, deletedAt: null }, { fields: ['id'] }, scope)).map((floor) => floor.id)
  await lockFloors(trx, scope, floorIds)
  await assertSubjectStillExists(trx, scope, subject)
}

async function markBookingsChanged(ctx: CommandRuntimeContext, bookings: readonly Booking[]): Promise<void> {
  if (!bookings.length) return
  try {
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (const booking of bookings) {
      dataEngine.markOrmEntityChange({
        action: 'updated',
        entity: booking,
        identifiers: { id: booking.id, organizationId: booking.organizationId, tenantId: booking.tenantId },
        indexer: bookingCrudIndexer,
      })
    }
    await dataEngine.flushOrmEntityChanges()
  } catch (err) {
    logger.error('Booking side effects failed', { bookingCount: bookings.length, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.booking_side_effects_failed' })
  }
}

async function emitCancellations(ctx: CommandRuntimeContext, bookings: readonly Booking[]): Promise<void> {
  for (const booking of bookings) await emitBookingEvent('property_management.booking.cancelled', booking)
  await markBookingsChanged(ctx, bookings)
}

type InlineCancelLogService = { log(input: ActionLogCreateInput, transactionalEm?: EntityManager): Promise<unknown> }

function resolveActionLogService(ctx: CommandRuntimeContext): InlineCancelLogService | null {
  try {
    return ctx.container.resolve('actionLogService') as InlineCancelLogService
  } catch {
    return null
  }
}

async function logInlineCancellations(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: Scope,
  unavailabilityId: string,
  bookings: readonly Booking[],
): Promise<void> {
  if (!bookings.length) return
  const service = resolveActionLogService(ctx)
  if (!service) return
  try {
    const { translate } = await resolveTranslations()
    const actionLabel = translate('property_management.audit.booking.cancel', 'Cancel booking')
    await em.fork().transactional(async (logTrx) => {
      for (const booking of bookings) {
        await service.log(
          {
            ...scope,
            actorUserId: ctx.auth?.sub ?? null,
            commandId: 'property_management.booking.cancel',
            actionLabel,
            resourceKind: BOOKING_RESOURCE_KIND,
            resourceId: booking.id,
            relatedResourceKind: UNAVAILABILITY_RESOURCE_KIND,
            relatedResourceId: unavailabilityId,
            context: { reason: 'unavailability', unavailabilityId },
          },
          logTrx,
        )
      }
    })
  } catch (err) {
    logger.error('Logging the inline unavailability cancellations failed', { unavailabilityId, bookingCount: bookings.length, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_cancel_log_failed' })
  }
}

async function startApplyProgress(
  ctx: CommandRuntimeContext,
  scope: Scope,
  row: Unavailability,
  counts: { inline: number; remaining: number },
  subjectName: string,
): Promise<string | null> {
  const progress = resolveProgressService(ctx.container)
  if (!progress) return null
  try {
    const { translate } = await resolveTranslations()
    const job = await progress.createJob(
      {
        jobType: UNAVAILABILITY_APPLY_JOB_TYPE,
        name: translate('property_management.availability.progress.name', 'Cancel bookings · {subject}', { subject: subjectName }),
        description: translate('property_management.availability.progress.description', 'Bookings to cancel for the unavailability: {count}', { count: counts.remaining }),
        totalCount: counts.remaining,
        cancellable: false,
        meta: { source: 'property_management.unavailability', unavailabilityId: row.id, [INLINE_CANCELLED_META_KEY]: counts.inline },
      },
      { ...scope, userId: ctx.auth?.sub ?? null },
    )
    return job.id
  } catch (err) {
    logger.error('Creating the unavailability progress job failed', { unavailabilityId: row.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_progress_create_failed' })
    return null
  }
}

async function storeProgressJobId(em: EntityManager, scope: Scope, id: string, progressJobId: string): Promise<boolean> {
  try {
    const row = await findOneWithDecryption(em, Unavailability, { id, ...scope }, undefined, scope)
    if (!row) return false
    row.progressJobId = progressJobId
    await em.flush()
    return true
  } catch (err) {
    logger.error('Storing the unavailability progress job failed', { unavailabilityId: id, progressJobId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_progress_store_failed' })
    return false
  }
}

async function failUnreachableProgressJob(ctx: CommandRuntimeContext, scope: Scope, unavailabilityId: string, progressJobId: string): Promise<void> {
  const unreachable = new Error('[internal] the unavailability apply job was neither queued nor linked to its progress job')
  logger.error('The unavailability apply job was not queued and its progress job is not stored; failing the progress job', { unavailabilityId, progressJobId })
  getTelemetryRuntime()?.reportError(unreachable, { module: 'property_management', code: 'property_management.unavailability_progress_unreachable' })
  const progress = resolveProgressService(ctx.container)
  if (!progress) return
  try {
    const errorMessage = await applyFailureMessage(unreachable, { willRetry: false })
    await progress.failJob(progressJobId, { errorMessage }, { ...scope, userId: ctx.auth?.sub ?? null })
  } catch (err) {
    logger.error('Failing the unreachable unavailability progress job failed', { unavailabilityId, progressJobId, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_progress_fail_failed' })
  }
}

async function createUnavailability(input: UnavailabilityCreateInput, ctx: CommandRuntimeContext): Promise<UnavailabilityCreateResult> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const subject = await loadUnavailabilitySubject(em, scope, permitted, input.subjectType, input.subjectId)
  const reasonEntryId = await assertReasonEntry(em, scope, input.reasonEntryId)
  if (!input.previewToken) {
    throw await unprocessableError('property_management.errors.previewTokenRequired', 'Preview the change before confirming it.', {
      code: 'preview_token_required',
    })
  }
  const instant = new Date()
  const now = localNow(instant)
  const range = rangeOf(input)
  await assertRangeNotPast(range, now)
  const settings = await loadSettings(em, scope)
  const outcome = await em.fork().transactional(async (trx) => {
    await lockSubjectLayout(trx, scope, subject)
    const impact = await computeClosureImpact(trx, scope, subject, range, now, {
      bookingLimit: INLINE_CANCEL_LIMIT,
      lockUnits: true,
      unitFields: CONFIRM_UNIT_FIELDS,
      bookingFields: CONFIRM_BOOKING_FIELDS,
      countLeasesOnly: true,
    })
    if (impact.previewToken !== input.previewToken) {
      throw await conflictError('property_management.errors.previewStale', 'The bookings affected have changed. Review the preview again.', {
        code: 'preview_stale',
        previewToken: impact.previewToken,
        bookingCount: impact.bookingCount,
      })
    }
    await assertCancelledStatusConfigured(settings, impact)
    const inlineIds = impact.bookings.map((booking) => booking.id)
    const reloaded = inlineIds.length
      ? await findWithDecryption(trx, Booking, { ...scope, id: { $in: inlineIds } }, { orderBy: { startsAt: 'asc' }, refresh: true }, scope)
      : []
    const inline = reloaded.filter((booking) => HOLDING_BOOKING_STATUSES.includes(booking.status))
    const remaining = impact.bookingCount - inlineIds.length
    const row = trx.create(Unavailability, {
      id: randomUUID(),
      ...scope,
      buildingId: subject.buildingId,
      subjectType: subject.type,
      subjectId: subject.id,
      reasonEntryId,
      reasonText: input.reasonText,
      startsAt: toStoredWallClock(range.start),
      endsAt: range.end ? toStoredWallClock(range.end) : null,
      cancelledBookingCount: inline.length,
      applyStatus: remaining > 0 ? 'applying' : 'applied',
      createdAt: instant,
    })
    trx.persist(row)
    const operations = await recordBookingOrderCancellations(trx, scope, inline, settings.cancelledOrderStatusEntryId ?? null)
    for (const booking of inline) markBookingReleased(booking, { reason: 'unavailability', unavailabilityId: row.id })
    await trx.flush()
    return { row, cancelled: inline, operations, remaining, leaseCount: impact.leaseCount }
  })
  await enqueueSalesOperations(outcome.operations.map((operation) => operation.id))
  await emitCancellations(ctx, outcome.cancelled)
  await logInlineCancellations(ctx, em, scope, outcome.row.id, outcome.cancelled)
  let progressJobId: string | null = null
  if (outcome.remaining > 0) {
    progressJobId = await startApplyProgress(ctx, scope, outcome.row, { inline: outcome.cancelled.length, remaining: outcome.remaining }, subject.name)
    const stored = progressJobId ? await storeProgressJobId(em.fork(), scope, outcome.row.id, progressJobId) : false
    const enqueued = await enqueueUnavailabilityApply({
      unavailabilityId: outcome.row.id,
      progressJobId,
      userId: ctx.auth?.sub ?? null,
    })
    if (progressJobId && !stored && !enqueued) {
      await failUnreachableProgressJob(ctx, scope, outcome.row.id, progressJobId)
    }
  }
  await emitPropertyManagementEvent(
    'property_management.unavailability.created',
    {
      id: outcome.row.id,
      unavailabilityId: outcome.row.id,
      buildingId: outcome.row.buildingId,
      subjectType: outcome.row.subjectType,
      subjectId: outcome.row.subjectId,
      startsAt: range.start,
      endsAt: range.end,
      cancelledBookingCount: outcome.cancelled.length,
      queuedBookingCount: outcome.remaining,
      flaggedLeaseCount: outcome.leaseCount,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    persistentEventOptions(scope),
  ).catch((err) => {
    logger.error('Unavailability event failed', { id: outcome.row.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_event_failed' })
  })
  return {
    unavailabilityId: outcome.row.id,
    cancelledBookings: outcome.cancelled.length,
    queuedBookings: outcome.remaining,
    flaggedLeases: outcome.leaseCount,
    applyStatus: outcome.row.applyStatus,
    progressJobId,
  }
}

async function loadPermittedUnavailability(em: EntityManager, ctx: CommandRuntimeContext, scope: Scope, id: string): Promise<Unavailability> {
  const row = await findOneWithDecryption(em, Unavailability, { id, ...scope, deletedAt: null }, undefined, scope)
  const permitted = await resolvePermitted(ctx, scope)
  if (!row || (permitted !== null && !permitted.includes(row.buildingId))) {
    throw await notFoundError('property_management.errors.unavailabilityNotFound', 'Unavailability not found.')
  }
  return row
}

async function endUnavailability(input: UnavailabilityEndInput, ctx: CommandRuntimeContext): Promise<UnavailabilityEndResult & { previousEndedAt: string | null }> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const current = await loadPermittedUnavailability(em, ctx, scope, input.id)
  const now = localNow()
  const outcome = await em.fork().transactional(async (trx) => {
    const row = await findOneWithDecryption(trx, Unavailability, { id: current.id, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
    if (!row) throw await notFoundError('property_management.errors.unavailabilityNotFound', 'Unavailability not found.')
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: UNAVAILABILITY_RESOURCE_KIND,
      resourceId: row.id,
      current: row.updatedAt,
      request: ctx.request ?? null,
    })
    const end = effectiveEnd(row)
    if (end !== null && compareWallClock(end, now) <= 0) {
      throw await conflictError('property_management.errors.unavailabilityAlreadyEnded', 'This unavailability has already ended.', {
        code: 'unavailability_already_ended',
      })
    }
    const previousEndedAt = row.endedAt ? normalizeWallClock(row.endedAt) : null
    row.endedAt = toStoredWallClock(now)
    row.updatedAt = new Date()
    await trx.flush()
    return { row, previousEndedAt }
  })
  await emitPropertyManagementEvent(
    'property_management.unavailability.ended',
    {
      id: outcome.row.id,
      unavailabilityId: outcome.row.id,
      buildingId: outcome.row.buildingId,
      subjectType: outcome.row.subjectType,
      subjectId: outcome.row.subjectId,
      endedAt: now,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    persistentEventOptions(scope),
  ).catch((err) => {
    logger.error('Unavailability event failed', { id: outcome.row.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_event_failed' })
  })
  return { unavailabilityId: outcome.row.id, endedAt: now, previousEndedAt: outcome.previousEndedAt }
}

async function refuseBookingsInRestoredWindow(bookingCount: number, listed: readonly Booking[]): Promise<never> {
  throw await conflictError(
    'property_management.errors.unavailabilityUndoBookings',
    'Pending or confirmed bookings fall in this period ({count}). Cancel them or make the subject unavailable again.',
    {
      code: 'unavailability_undo_bookings',
      bookingCount,
      bookings: listed.map((booking) => ({
        id: booking.id,
        unitId: booking.unitId,
        startsAt: normalizeWallClock(booking.startsAt),
        endsAt: normalizeWallClock(booking.endsAt),
      })),
    },
    { count: bookingCount },
  )
}

async function undoEndUnavailability(payload: UnavailabilityUndoPayload, ctx: CommandRuntimeContext): Promise<void> {
  const scope = scopeOfInput(payload)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const current = await findOneWithDecryption(em, Unavailability, { id: payload.id, ...scope, deletedAt: null }, undefined, scope)
  if (!current) return
  const permitted = await resolvePermitted(ctx, scope)
  const subject = await loadUnavailabilitySubject(em, scope, permitted, current.subjectType, current.subjectId)
  const restoredEndedAt = payload.previousEndedAt ? normalizeWallClock(payload.previousEndedAt) : null
  const now = localNow()
  const restored = await em.fork().transactional(async (trx) => {
    await lockSubjectLayout(trx, scope, subject)
    const units = await findSubjectUnits(trx, scope, subject, { lock: true, fields: ['id'] })
    const row = await findOneWithDecryption(
      trx,
      Unavailability,
      { id: current.id, ...scope, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    if (!row) return null
    const window = windowOf({
      id: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      reasonEntryId: row.reasonEntryId,
      reasonText: row.reasonText,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      endedAt: restoredEndedAt,
    })
    if (window?.start) {
      const unitIds = units.map((unit) => unit.id)
      const range = { start: window.start, end: window.end }
      const bookingCount = await countClosureBookings(trx, scope, unitIds, range, now)
      if (bookingCount > 0) {
        const listed = await findClosureBookings(trx, scope, unitIds, range, now, { limit: PREVIEW_LIST_LIMIT, fields: UNDO_BOOKING_FIELDS })
        await refuseBookingsInRestoredWindow(bookingCount, listed)
      }
    }
    row.endedAt = restoredEndedAt ? toStoredWallClock(restoredEndedAt) : null
    row.updatedAt = new Date()
    await trx.flush()
    return row
  })
  if (!restored) return
  await emitPropertyManagementEvent(
    'property_management.unavailability.restored',
    {
      id: restored.id,
      unavailabilityId: restored.id,
      buildingId: restored.buildingId,
      subjectType: restored.subjectType,
      subjectId: restored.subjectId,
      startsAt: normalizeWallClock(restored.startsAt),
      endsAt: restored.endsAt ? normalizeWallClock(restored.endsAt) : null,
      endedAt: restoredEndedAt,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    persistentEventOptions(scope),
  ).catch((err) => {
    logger.error('Unavailability event failed', { id: restored.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_event_failed' })
  })
}

async function undoCreateUnavailability(payload: UnavailabilityUndoPayload, ctx: CommandRuntimeContext): Promise<void> {
  const scope = scopeOfInput(payload)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const current = await findOneWithDecryption(em, Unavailability, { id: payload.id, ...scope, deletedAt: null }, undefined, scope)
  if (!current) return
  await assertBuildingPermitted(await resolvePermitted(ctx, scope), current.buildingId)
  const now = localNow()
  const removed = await em.fork().transactional(async (trx) => {
    const row = await findOneWithDecryption(
      trx,
      Unavailability,
      { id: current.id, ...scope, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true },
      scope,
    )
    if (!row) return null
    row.deletedAt = new Date()
    row.updatedAt = new Date()
    await trx.flush()
    return row
  })
  if (!removed) return
  await emitPropertyManagementEvent(
    'property_management.unavailability.ended',
    {
      id: removed.id,
      unavailabilityId: removed.id,
      buildingId: removed.buildingId,
      subjectType: removed.subjectType,
      subjectId: removed.subjectId,
      endedAt: now,
      removed: true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    persistentEventOptions(scope),
  ).catch((err) => {
    logger.error('Unavailability event failed', { id: removed.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.unavailability_event_failed' })
  })
}

const createUnavailabilityCommand: CommandHandler<UnavailabilityCreateInput, UnavailabilityCreateResult> = {
  id: 'property_management.unavailability.create',
  async execute(rawInput, ctx) {
    return createUnavailability(unavailabilityCreateSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.unavailabilityId ?? null,
      'property_management.audit.unavailability.create',
      'Make unavailable',
      UNAVAILABILITY_RESOURCE_KIND,
    )
    if (!result || !input) return base
    const undo: UnavailabilityUndoPayload = { id: result.unavailabilityId, tenantId: input.tenantId, organizationId: input.organizationId }
    return { ...base, payload: { undo } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnavailabilityUndoPayload>(logEntry)
    if (!payload) return
    await undoCreateUnavailability(payload, ctx)
  },
}

const endUnavailabilityCommand: CommandHandler<UnavailabilityEndInput, UnavailabilityEndResult & { previousEndedAt: string | null }> = {
  id: 'property_management.unavailability.end',
  async execute(rawInput, ctx) {
    return endUnavailability(unavailabilityEndSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) => {
    const base = await buildCrudLog(
      ctx,
      input,
      result?.unavailabilityId ?? null,
      'property_management.audit.unavailability.end',
      'Make available',
      UNAVAILABILITY_RESOURCE_KIND,
    )
    if (!result || !input) return base
    const undo: UnavailabilityUndoPayload = {
      id: result.unavailabilityId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      previousEndedAt: result.previousEndedAt,
    }
    return { ...base, payload: { undo } }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnavailabilityUndoPayload>(logEntry)
    if (!payload) return
    await undoEndUnavailability(payload, ctx)
  },
}

registerCommand(createUnavailabilityCommand)
registerCommand(endUnavailabilityCommand)
