import {
  registerCommand,
  type CommandHandler,
  type CommandLogMetadata,
  type CommandRuntimeContext,
  type CommandUndoLogEntry,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges, emitCrudSideEffects, snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentImpact } from '../data/entities'
import {
  impactAddSchema,
  impactRemoveSchema,
  impactUpdateSchema,
  type IncidentImpactAddInput,
  type IncidentImpactRemoveInput,
  type IncidentImpactUpdateInput,
} from '../data/validators'
import { emitIncidentsEvent, type IncidentsEventId } from '../events'
import {
  emitIncidentSideEffects,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import { assertIncidentMutable } from './actions'

type ImpactCommandResult = {
  impactId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
  revenueAtRiskMinor: string | null
  revenueAtRiskCurrency: string | null
}

type ImpactSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  incidentId: string
  targetType: string
  targetId: string | null
  componentLabel: string | null
  impactStatus: string
  snapshot: Record<string, unknown> | null
  revenueAmountMinor: string | null
  revenueCurrency: string | null
  revenueRefreshedAt: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type ImpactUndoPayload = UndoPayload<ImpactSnapshot>

const IMPACT_CHANGE_KEYS = [
  'targetType',
  'targetId',
  'componentLabel',
  'impactStatus',
  'snapshot',
  'revenueAmountMinor',
  'revenueCurrency',
  'revenueRefreshedAt',
  'deletedAt',
] as const satisfies readonly string[]

const EMAIL_LIKE_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const IMPACT_TARGET_UNIQUE_INDEX = 'incident_impacts_target_unique'

const impactIndexer: CrudIndexerConfig<IncidentImpact> = {
  entityType: E.incidents.incident_impact,
}

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeRevenueCurrency(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)
  return normalized ? normalized.toUpperCase() : null
}

function snapshotImpact(impact: IncidentImpact): ImpactSnapshot {
  return {
    id: impact.id,
    organizationId: impact.organizationId,
    tenantId: impact.tenantId,
    incidentId: impact.incidentId,
    targetType: impact.targetType,
    targetId: impact.targetId ?? null,
    componentLabel: impact.componentLabel ?? null,
    impactStatus: impact.impactStatus,
    snapshot: impact.snapshot ?? null,
    revenueAmountMinor: impact.revenueAmountMinor ?? null,
    revenueCurrency: impact.revenueCurrency ?? null,
    revenueRefreshedAt: optionalIso(impact.revenueRefreshedAt),
    createdAt: impact.createdAt.toISOString(),
    updatedAt: impact.updatedAt.toISOString(),
    deletedAt: optionalIso(impact.deletedAt),
  }
}

async function loadImpactSnapshot(
  em: EntityManager,
  impactId: string,
  scope: IncidentScope,
): Promise<ImpactSnapshot | null> {
  const impact = await em.findOne(IncidentImpact, {
    id: impactId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return impact ? snapshotImpact(impact) : null
}

function applyImpactSnapshot(impact: IncidentImpact, snapshot: ImpactSnapshot): void {
  impact.organizationId = snapshot.organizationId
  impact.tenantId = snapshot.tenantId
  impact.incidentId = snapshot.incidentId
  impact.targetType = snapshot.targetType
  impact.targetId = snapshot.targetId
  impact.componentLabel = snapshot.componentLabel
  impact.impactStatus = snapshot.impactStatus
  impact.snapshot = snapshot.snapshot
  impact.revenueAmountMinor = snapshot.revenueAmountMinor
  impact.revenueCurrency = snapshot.revenueCurrency
  impact.revenueRefreshedAt = parseOptionalDate(snapshot.revenueRefreshedAt)
  impact.createdAt = new Date(snapshot.createdAt)
  impact.updatedAt = new Date(snapshot.updatedAt)
  impact.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createImpactFromSnapshot(em: EntityManager, snapshot: ImpactSnapshot): IncidentImpact {
  const impact = em.create(IncidentImpact, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    incidentId: snapshot.incidentId,
    targetType: snapshot.targetType,
    targetId: snapshot.targetId,
    componentLabel: snapshot.componentLabel,
    impactStatus: snapshot.impactStatus,
    snapshot: snapshot.snapshot,
    revenueAmountMinor: snapshot.revenueAmountMinor,
    revenueCurrency: snapshot.revenueCurrency,
    revenueRefreshedAt: parseOptionalDate(snapshot.revenueRefreshedAt),
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(impact)
  return impact
}

async function loadIncidentForImpact(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<Incident> {
  const incident = await findOneWithDecryption(
    em,
    Incident,
    { id, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  if (!incident) throw new CrudHttpError(404, { error: '[internal] incident not found' })
  return incident
}

async function loadActiveImpact(
  em: EntityManager,
  impactId: string,
  incidentId: string,
  scope: IncidentScope,
): Promise<IncidentImpact> {
  const impact = await em.findOne(IncidentImpact, {
    id: impactId,
    incidentId,
    ...scope,
    deletedAt: null,
  })
  if (!impact) throw new CrudHttpError(404, { error: '[internal] incident impact not found' })
  return impact
}

async function enforceIncidentOptimisticLock(
  ctx: CommandRuntimeContext,
  incident: Incident,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'incidents.incident',
    resourceId: incident.id,
    current: incident.updatedAt,
    request: ctx.request ?? null,
  })
}

function assertSnapshotLabelIsNonPii(snapshot: Record<string, unknown> | null | undefined): void {
  if (!snapshot) return
  for (const value of Object.values(snapshot)) {
    if (typeof value === 'string' && EMAIL_LIKE_REGEX.test(value)) {
      throw new CrudHttpError(400, { error: '[internal] impact snapshot must not contain an email/PII' })
    }
  }
}

function normalizeTarget(input: Pick<IncidentImpactAddInput, 'targetType' | 'targetId' | 'componentLabel'>): {
  targetId: string | null
  componentLabel: string | null
} {
  if (input.targetType === 'component') {
    return {
      targetId: null,
      componentLabel: normalizeOptionalText(input.componentLabel),
    }
  }
  return {
    targetId: input.targetId ?? null,
    componentLabel: null,
  }
}

async function assertNoDuplicateTarget(
  em: EntityManager,
  incidentId: string,
  scope: IncidentScope,
  targetType: string,
  targetId: string | null,
  componentLabel: string | null,
): Promise<void> {
  const existing = await em.findOne(IncidentImpact, {
    incidentId,
    targetType,
    ...(targetId ? { targetId } : { componentLabel }),
    ...scope,
    deletedAt: null,
  })
  if (existing) throw new CrudHttpError(409, { error: '[internal] duplicate impact target' })
}

function mapDuplicateImpactError(error: unknown): never {
  if (isUniqueViolation(error, IMPACT_TARGET_UNIQUE_INDEX)) {
    throw new CrudHttpError(409, { error: '[internal] duplicate impact target' }, { cause: error })
  }
  throw error
}

type RevenueBucket = {
  currency: string
  sum: bigint
  count: number
}

export async function recomputeIncidentRevenue(
  em: EntityManager,
  scope: IncidentScope,
  incident: Incident,
): Promise<void> {
  const impacts = await em.find(IncidentImpact, {
    incidentId: incident.id,
    ...scope,
    deletedAt: null,
  })
  const buckets = new Map<string, RevenueBucket>()
  for (const impact of impacts) {
    const amountRaw = impact.revenueAmountMinor
    const currency = normalizeRevenueCurrency(impact.revenueCurrency)
    if (!amountRaw || !currency || !/^\d+$/.test(amountRaw)) continue
    const existing = buckets.get(currency) ?? { currency, sum: 0n, count: 0 }
    existing.sum += BigInt(amountRaw)
    existing.count += 1
    buckets.set(currency, existing)
  }

  if (buckets.size === 0) {
    incident.revenueAtRiskMinor = null
    incident.revenueAtRiskCurrency = null
    em.persist(incident)
    return
  }

  const ordered = Array.from(buckets.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count
    if (right.sum > left.sum) return 1
    if (right.sum < left.sum) return -1
    return left.currency.localeCompare(right.currency)
  })
  const selected = ordered[0]!
  // mixed-currency: per-currency breakdown deferred to enricher
  incident.revenueAtRiskMinor = selected.sum.toString()
  incident.revenueAtRiskCurrency = selected.currency
  em.persist(incident)
}

async function emitImpactSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  impact: IncidentImpact,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: impact,
    identifiers: {
      id: impact.id,
      organizationId: impact.organizationId,
      tenantId: impact.tenantId,
    },
    indexer: impactIndexer,
  })
}

async function emitImpactEvent(
  eventId: IncidentsEventId,
  ctx: CommandRuntimeContext,
  incident: Incident,
  impact: IncidentImpact,
  actorUserId: string,
): Promise<void> {
  await emitIncidentsEvent(
    eventId,
    {
      id: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      actorUserId,
      impactId: impact.id,
      targetType: impact.targetType,
      targetId: impact.targetId ?? null,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    },
    { persistent: true },
  )
}

async function captureImpactAfter(
  result: ImpactCommandResult,
  ctx: CommandRuntimeContext,
): Promise<ImpactSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadImpactSnapshot(em, result.impactId, result)
}

async function buildImpactLog(
  snapshots: { before?: unknown; after?: unknown },
  result: ImpactCommandResult,
  label: { key: string; fallback: string },
): Promise<CommandLogMetadata | null> {
  const before = snapshots.before as ImpactSnapshot | undefined
  const after = snapshots.after as ImpactSnapshot | undefined
  if (!before && !after) return null
  if (before && after && snapshotsEqual(before, after)) return { skipLog: true }
  const snapshot = after ?? before
  if (!snapshot) return null
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.impact',
    resourceId: snapshot.id,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: after ? buildChanges(before ? { ...before } : null, { ...after }, IMPACT_CHANGE_KEYS) : null,
    payload: {
      undo: { before, after } satisfies ImpactUndoPayload,
    },
  }
}

async function restoreImpactSnapshot(
  em: EntityManager,
  snapshot: ImpactSnapshot,
): Promise<IncidentImpact> {
  const impact = await em.findOne(IncidentImpact, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
  })
  if (!impact) return createImpactFromSnapshot(em, snapshot)
  applyImpactSnapshot(impact, snapshot)
  em.persist(impact)
  return impact
}

async function undoToSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: ImpactSnapshot | null | undefined,
  action: 'created' | 'updated' | 'deleted',
): Promise<void> {
  if (!snapshot) return
  const scope = { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId }
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const incident = await findOneWithDecryption(
    em,
    Incident,
    { id: snapshot.incidentId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  let impact!: IncidentImpact
  const now = new Date()
  await withAtomicFlush(em, [
    async () => {
      impact = await restoreImpactSnapshot(em, snapshot)
      impact.updatedAt = now
      if (action === 'created') impact.deletedAt = null
      if (incident) {
        incident.updatedAt = now
        em.persist(incident)
      }
    },
    async () => {
      if (incident) await recomputeIncidentRevenue(em, scope, incident)
    },
  ], { transaction: true, label: 'incidents.impact.undo' })
  await emitImpactSideEffects(ctx, action, impact)
  if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
}

const addImpactCommand: CommandHandler<IncidentImpactAddInput, ImpactCommandResult> = {
  id: 'incidents.impact.add',
  async execute(rawInput, ctx) {
    const parsed = impactAddSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForImpact(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    assertSnapshotLabelIsNonPii(parsed.snapshot)

    const target = normalizeTarget(parsed)
    await assertNoDuplicateTarget(em, incident.id, scope, parsed.targetType, target.targetId, target.componentLabel)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    const revenueCurrency = normalizeRevenueCurrency(parsed.revenueCurrency)
    const revenueRefreshedAt = parsed.revenueAmountMinor !== undefined || parsed.revenueCurrency !== undefined
      ? now
      : null
    let impact!: IncidentImpact
    try {
      await withAtomicFlush(em, [
        () => {
          impact = em.create(IncidentImpact, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            incidentId: incident.id,
            targetType: parsed.targetType,
            targetId: target.targetId,
            componentLabel: target.componentLabel,
            impactStatus: parsed.impactStatus,
            snapshot: parsed.snapshot ?? null,
            revenueAmountMinor: parsed.revenueAmountMinor ?? null,
            revenueCurrency,
            revenueRefreshedAt,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          em.persist(impact)
          incident.updatedAt = now
          em.persist(incident)
        },
        () => recomputeIncidentRevenue(em, scope, incident),
      ], { transaction: true, label: 'incidents.impact.add' })
    } catch (error) {
      mapDuplicateImpactError(error)
    }

    await emitImpactSideEffects(ctx, 'created', impact)
    await emitImpactEvent('incidents.impact.added', ctx, incident, impact, actorUserId)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      impactId: impact.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
      revenueAtRiskMinor: incident.revenueAtRiskMinor ?? null,
      revenueAtRiskCurrency: incident.revenueAtRiskCurrency ?? null,
    }
  },
  captureAfter: (_input, result, ctx) => captureImpactAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildImpactLog(snapshots, result, {
    key: 'incidents.audit.impact.add',
    fallback: 'Add incident impact',
  }),
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<ImpactUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const impact = await em.findOne(IncidentImpact, { id: after.id, ...scope })
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: after.incidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!impact) return
    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        impact.deletedAt = now
        impact.updatedAt = now
        if (incident) {
          incident.updatedAt = now
          em.persist(incident)
        }
      },
      async () => {
        if (incident) await recomputeIncidentRevenue(em, scope, incident)
      },
    ], { transaction: true, label: 'incidents.impact.add.undo' })
    await emitImpactSideEffects(ctx, 'deleted', impact)
    if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
  },
}

const updateImpactCommand: CommandHandler<IncidentImpactUpdateInput, ImpactCommandResult> = {
  id: 'incidents.impact.update_status',
  async prepare(rawInput, ctx) {
    const parsed = impactUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadImpactSnapshot(em, parsed.impactId, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = impactUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForImpact(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    assertSnapshotLabelIsNonPii(parsed.snapshot)
    const impact = await loadActiveImpact(em, parsed.impactId, incident.id, scope)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    await withAtomicFlush(em, [
      () => {
        if (parsed.impactStatus !== undefined) impact.impactStatus = parsed.impactStatus
        if (parsed.snapshot !== undefined) impact.snapshot = parsed.snapshot ?? null
        if (parsed.revenueAmountMinor !== undefined) impact.revenueAmountMinor = parsed.revenueAmountMinor ?? null
        if (parsed.revenueCurrency !== undefined) impact.revenueCurrency = normalizeRevenueCurrency(parsed.revenueCurrency)
        if (parsed.revenueAmountMinor !== undefined || parsed.revenueCurrency !== undefined) {
          impact.revenueRefreshedAt = now
        }
        impact.updatedAt = now
        incident.updatedAt = now
        em.persist(impact)
        em.persist(incident)
      },
      () => recomputeIncidentRevenue(em, scope, incident),
    ], { transaction: true, label: 'incidents.impact.update_status' })

    await emitImpactSideEffects(ctx, 'updated', impact)
    await emitImpactEvent('incidents.impact.updated', ctx, incident, impact, actorUserId)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      impactId: impact.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
      revenueAtRiskMinor: incident.revenueAtRiskMinor ?? null,
      revenueAtRiskCurrency: incident.revenueAtRiskCurrency ?? null,
    }
  },
  captureAfter: (_input, result, ctx) => captureImpactAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildImpactLog(snapshots, result, {
    key: 'incidents.audit.impact.update_status',
    fallback: 'Update incident impact',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ImpactUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'updated')
  },
}

const removeImpactCommand: CommandHandler<IncidentImpactRemoveInput, ImpactCommandResult> = {
  id: 'incidents.impact.remove',
  async prepare(rawInput, ctx) {
    const parsed = impactRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadImpactSnapshot(em, parsed.impactId, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = impactRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForImpact(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    const impact = await loadActiveImpact(em, parsed.impactId, incident.id, scope)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    await withAtomicFlush(em, [
      () => {
        impact.deletedAt = now
        impact.updatedAt = now
        incident.updatedAt = now
        em.persist(impact)
        em.persist(incident)
      },
      () => recomputeIncidentRevenue(em, scope, incident),
    ], { transaction: true, label: 'incidents.impact.remove' })

    await emitImpactSideEffects(ctx, 'deleted', impact)
    await emitImpactEvent('incidents.impact.removed', ctx, incident, impact, actorUserId)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      impactId: impact.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
      revenueAtRiskMinor: incident.revenueAtRiskMinor ?? null,
      revenueAtRiskCurrency: incident.revenueAtRiskCurrency ?? null,
    }
  },
  captureAfter: (_input, result, ctx) => captureImpactAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildImpactLog(snapshots, result, {
    key: 'incidents.audit.impact.remove',
    fallback: 'Remove incident impact',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ImpactUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'created')
  },
}

registerCommand(addImpactCommand)
registerCommand(updateImpactCommand)
registerCommand(removeImpactCommand)
