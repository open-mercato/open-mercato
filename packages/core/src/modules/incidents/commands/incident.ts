import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentSettings, IncidentSeverity, IncidentType } from '../data/entities'
import type { IncidentEscalationLastTargets } from '../data/entities'
import {
  incidentCreateSchema,
  incidentUpdateSchema,
  type IncidentCreateInput,
  type IncidentUpdateInput,
} from '../data/validators'
import type { IncidentNumberGenerator } from '../services/incidentNumberGenerator'
import * as escalationService from '../services/escalationService'
import { emitIncidentsEvent } from '../events'
import { applyIncidentUpdateCadence } from '../lib/updateCadence'

const DEFAULT_NUMBER_FORMAT = 'INC-{yyyy}{mm}{dd}-{seq:4}'

export type IncidentScope = {
  organizationId: string
  tenantId: string
}

type ScopedInput = {
  organizationId?: string | null
  tenantId?: string | null
}

export type IncidentCommandResult = {
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt?: Date
}

type IncidentDeleteInput = {
  id?: string
  organizationId?: string
  tenantId?: string
}

export type IncidentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  number: string
  title: string
  description: string | null
  incidentTypeId: string | null
  severityId: string
  priority: string | null
  status: string
  visibility: string
  isDrill: boolean
  isMajor: boolean
  ownerUserId: string | null
  owningTeamId: string | null
  reporterUserId: string
  detectedAt: string | null
  acknowledgedAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  closedAt: string | null
  escalationLevel: number
  nextEscalationAt: string | null
  nextUpdateDueAt: string | null
  updateOverdueNotifiedAt: string | null
  snoozedUntil: string | null
  escalationPolicyId: string | null
  escalationStatus: string
  escalationRepeatsDone: number
  escalationLastTargets: IncidentEscalationLastTargets | null
  slaResponseDueAt: string | null
  slaResolutionDueAt: string | null
  slaAtRisk: boolean
  slaBreached: boolean
  mergedIntoIncidentId: string | null
  sourceEventRef: string | null
  customerImpactSummary: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type IncidentUndoPayload = UndoPayload<IncidentSnapshot>

export const incidentIndexer: CrudIndexerConfig<Incident> = { entityType: E.incidents.incident }

export const incidentEvents: CrudEventsConfig<Incident> = {
  module: 'incidents',
  entity: 'incident',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const INCIDENT_CHANGE_KEYS = [
  'title',
  'description',
  'incidentTypeId',
  'severityId',
  'priority',
  'status',
  'visibility',
  'isDrill',
  'isMajor',
  'ownerUserId',
  'owningTeamId',
  'detectedAt',
  'acknowledgedAt',
  'startedAt',
  'resolvedAt',
  'closedAt',
  'escalationLevel',
  'nextEscalationAt',
  'nextUpdateDueAt',
  'updateOverdueNotifiedAt',
  'snoozedUntil',
  'escalationPolicyId',
  'escalationStatus',
  'escalationRepeatsDone',
  'escalationLastTargets',
  'slaResponseDueAt',
  'slaResolutionDueAt',
  'slaAtRisk',
  'slaBreached',
  'mergedIntoIncidentId',
  'sourceEventRef',
  'customerImpactSummary',
] as const satisfies readonly string[]

const INCIDENT_DATE_FIELDS = [
  'detectedAt',
  'acknowledgedAt',
  'startedAt',
  'resolvedAt',
  'closedAt',
  'nextEscalationAt',
  'nextUpdateDueAt',
  'updateOverdueNotifiedAt',
  'snoozedUntil',
  'slaResponseDueAt',
  'slaResolutionDueAt',
  'createdAt',
  'updatedAt',
  'deletedAt',
] as const

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

export function resolveCommandScope(ctx: CommandRuntimeContext, input: ScopedInput): IncidentScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant scope required' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization scope required' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

export function resolveActorUserId(ctx: CommandRuntimeContext): string {
  const actorUserId = ctx.auth?.userId ?? (ctx.auth?.isApiKey ? null : ctx.auth?.sub ?? null)
  if (!actorUserId) throw new CrudHttpError(401, { error: 'Authenticated user is required' })
  return actorUserId
}

async function requireSeverityInScope(
  em: EntityManager,
  severityId: string,
  scope: IncidentScope,
): Promise<void> {
  const severity = await em.findOne(IncidentSeverity, { id: severityId, ...scope, deletedAt: null })
  if (!severity) throw new CrudHttpError(400, { error: 'Incident severity not found' })
}

async function requireTypeInScope(
  em: EntityManager,
  incidentTypeId: string | null | undefined,
  scope: IncidentScope,
): Promise<void> {
  if (!incidentTypeId) return
  const type = await em.findOne(IncidentType, { id: incidentTypeId, ...scope, deletedAt: null })
  if (!type) throw new CrudHttpError(400, { error: 'Incident type not found' })
}

export async function loadIncidentSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<IncidentSnapshot | null> {
  const scoped = { organizationId: scope.organizationId, tenantId: scope.tenantId }
  const incident = await findOneWithDecryption(
    em,
    Incident,
    { id, ...scoped },
    undefined,
    scoped,
  )
  if (!incident) return null
  return {
    id: incident.id,
    organizationId: incident.organizationId,
    tenantId: incident.tenantId,
    number: incident.number,
    title: incident.title,
    description: incident.description ?? null,
    incidentTypeId: incident.incidentTypeId ?? null,
    severityId: incident.severityId,
    priority: incident.priority ?? null,
    status: incident.status,
    visibility: incident.visibility,
    isDrill: incident.isDrill,
    isMajor: incident.isMajor,
    ownerUserId: incident.ownerUserId ?? null,
    owningTeamId: incident.owningTeamId ?? null,
    reporterUserId: incident.reporterUserId,
    detectedAt: optionalIso(incident.detectedAt),
    acknowledgedAt: optionalIso(incident.acknowledgedAt),
    startedAt: optionalIso(incident.startedAt),
    resolvedAt: optionalIso(incident.resolvedAt),
    closedAt: optionalIso(incident.closedAt),
    escalationLevel: incident.escalationLevel,
    nextEscalationAt: optionalIso(incident.nextEscalationAt),
    nextUpdateDueAt: optionalIso(incident.nextUpdateDueAt),
    updateOverdueNotifiedAt: optionalIso(incident.updateOverdueNotifiedAt),
    snoozedUntil: optionalIso(incident.snoozedUntil),
    escalationPolicyId: incident.escalationPolicyId ?? null,
    escalationStatus: incident.escalationStatus,
    escalationRepeatsDone: incident.escalationRepeatsDone,
    escalationLastTargets: incident.escalationLastTargets ?? null,
    slaResponseDueAt: optionalIso(incident.slaResponseDueAt),
    slaResolutionDueAt: optionalIso(incident.slaResolutionDueAt),
    slaAtRisk: incident.slaAtRisk,
    slaBreached: incident.slaBreached,
    mergedIntoIncidentId: incident.mergedIntoIncidentId ?? null,
    sourceEventRef: incident.sourceEventRef ?? null,
    customerImpactSummary: incident.customerImpactSummary ?? null,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    deletedAt: optionalIso(incident.deletedAt),
  }
}

export function applyIncidentSnapshot(record: Incident, snapshot: IncidentSnapshot): void {
  record.number = snapshot.number
  record.title = snapshot.title
  record.description = snapshot.description
  record.incidentTypeId = snapshot.incidentTypeId
  record.severityId = snapshot.severityId
  record.priority = snapshot.priority
  record.status = snapshot.status
  record.visibility = snapshot.visibility
  record.isDrill = snapshot.isDrill
  record.isMajor = snapshot.isMajor
  record.ownerUserId = snapshot.ownerUserId
  record.owningTeamId = snapshot.owningTeamId
  record.reporterUserId = snapshot.reporterUserId
  record.detectedAt = parseOptionalDate(snapshot.detectedAt)
  record.acknowledgedAt = parseOptionalDate(snapshot.acknowledgedAt)
  record.startedAt = parseOptionalDate(snapshot.startedAt)
  record.resolvedAt = parseOptionalDate(snapshot.resolvedAt)
  record.closedAt = parseOptionalDate(snapshot.closedAt)
  record.escalationLevel = snapshot.escalationLevel
  record.nextEscalationAt = parseOptionalDate(snapshot.nextEscalationAt)
  record.nextUpdateDueAt = parseOptionalDate(snapshot.nextUpdateDueAt)
  record.updateOverdueNotifiedAt = parseOptionalDate(snapshot.updateOverdueNotifiedAt)
  record.snoozedUntil = parseOptionalDate(snapshot.snoozedUntil)
  record.escalationPolicyId = snapshot.escalationPolicyId
  record.escalationStatus = snapshot.escalationStatus
  record.escalationRepeatsDone = snapshot.escalationRepeatsDone
  record.escalationLastTargets = snapshot.escalationLastTargets
  record.slaResponseDueAt = parseOptionalDate(snapshot.slaResponseDueAt)
  record.slaResolutionDueAt = parseOptionalDate(snapshot.slaResolutionDueAt)
  record.slaAtRisk = snapshot.slaAtRisk
  record.slaBreached = snapshot.slaBreached
  record.mergedIntoIncidentId = snapshot.mergedIntoIncidentId
  record.sourceEventRef = snapshot.sourceEventRef
  record.customerImpactSummary = snapshot.customerImpactSummary
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

export function createIncidentFromSnapshot(em: EntityManager, snapshot: IncidentSnapshot): Incident {
  const record = em.create(Incident, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    number: snapshot.number,
    title: snapshot.title,
    description: snapshot.description,
    incidentTypeId: snapshot.incidentTypeId,
    severityId: snapshot.severityId,
    priority: snapshot.priority,
    status: snapshot.status,
    visibility: snapshot.visibility,
    isDrill: snapshot.isDrill,
    isMajor: snapshot.isMajor,
    ownerUserId: snapshot.ownerUserId,
    owningTeamId: snapshot.owningTeamId,
    reporterUserId: snapshot.reporterUserId,
    detectedAt: parseOptionalDate(snapshot.detectedAt),
    acknowledgedAt: parseOptionalDate(snapshot.acknowledgedAt),
    startedAt: parseOptionalDate(snapshot.startedAt),
    resolvedAt: parseOptionalDate(snapshot.resolvedAt),
    closedAt: parseOptionalDate(snapshot.closedAt),
    escalationLevel: snapshot.escalationLevel,
    nextEscalationAt: parseOptionalDate(snapshot.nextEscalationAt),
    nextUpdateDueAt: parseOptionalDate(snapshot.nextUpdateDueAt),
    updateOverdueNotifiedAt: parseOptionalDate(snapshot.updateOverdueNotifiedAt),
    snoozedUntil: parseOptionalDate(snapshot.snoozedUntil),
    escalationPolicyId: snapshot.escalationPolicyId,
    escalationStatus: snapshot.escalationStatus,
    escalationRepeatsDone: snapshot.escalationRepeatsDone,
    escalationLastTargets: snapshot.escalationLastTargets,
    slaResponseDueAt: parseOptionalDate(snapshot.slaResponseDueAt),
    slaResolutionDueAt: parseOptionalDate(snapshot.slaResolutionDueAt),
    slaAtRisk: snapshot.slaAtRisk,
    slaBreached: snapshot.slaBreached,
    mergedIntoIncidentId: snapshot.mergedIntoIncidentId,
    sourceEventRef: snapshot.sourceEventRef,
    customerImpactSummary: snapshot.customerImpactSummary,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(record)
  return record
}

export async function emitIncidentSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  incident: Incident,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: incident,
    identifiers: {
      id: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
    },
    indexer: incidentIndexer,
    events: incidentEvents,
  })
}

export async function emitIncidentUndoSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  incident: Incident | null | undefined,
  identifiers: IncidentScope & { id: string },
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: incident,
    identifiers,
    indexer: incidentIndexer,
    events: incidentEvents,
  })
}

async function emitPendingEscalationEvents(events: escalationService.PendingEscalationEvent[]): Promise<void> {
  for (const event of events) {
    await emitIncidentsEvent(event.id, event.payload, { persistent: true })
  }
}

const createIncidentCommand: CommandHandler<IncidentCreateInput, IncidentCommandResult> = {
  id: 'incidents.incidents.create',
  async execute(rawInput, ctx) {
    const parsed = incidentCreateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await requireSeverityInScope(em, parsed.severityId, scope)
    await requireTypeInScope(em, parsed.incidentTypeId, scope)

    const settings = await em.findOne(IncidentSettings, { ...scope, deletedAt: null })
    const numberFormat = settings?.numberFormat ?? DEFAULT_NUMBER_FORMAT
    const numberGenerator = ctx.container.resolve('incidentNumberGenerator') as IncidentNumberGenerator
    const number = await numberGenerator.allocate(scope, numberFormat)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let incident!: Incident
    const pendingEscalationEvents: escalationService.PendingEscalationEvent[] = []
    await withAtomicFlush(em, [
      () => {
        incident = em.create(Incident, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          number,
          title: parsed.title,
          description: normalizeOptionalText(parsed.description),
          incidentTypeId: parsed.incidentTypeId ?? null,
          severityId: parsed.severityId,
          priority: normalizeOptionalText(parsed.priority),
          status: 'open',
          visibility: 'internal',
          isDrill: false,
          isMajor: false,
          ownerUserId: parsed.ownerUserId ?? null,
          owningTeamId: parsed.owningTeamId ?? null,
          reporterUserId: actorUserId,
          detectedAt: now,
          startedAt: now,
          customerImpactSummary: normalizeOptionalText(parsed.customerImpactSummary),
          sourceEventRef: parsed.sourceEventRef ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(incident)
      },
      async () => {
        await applyIncidentUpdateCadence(em, scope, incident, now)
      },
      async () => {
        try {
          const policyId = parsed.escalationPolicyId !== undefined
            ? parsed.escalationPolicyId ?? null
            : await escalationService.resolveDefaultPolicyId(em, scope, incident.incidentTypeId ?? null)
          incident.escalationPolicyId = policyId
        } catch (error) {
          console.error('[incidents.create] failed to resolve escalation policy', error)
        }
      },
      async () => {
        try {
          const startResult = await escalationService.startEscalation(em, scope, incident, {
            actorUserId,
            now,
            container: ctx.container,
          })
          pendingEscalationEvents.push(...startResult.pendingEvents)
        } catch (error) {
          console.error('[incidents.create] failed to start escalation', error)
        }
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'created', incident)
    await emitPendingEscalationEvents(pendingEscalationEvents)
    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadIncidentSnapshot(em, result.incidentId, result)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as IncidentSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.incident.create', 'Create incident'),
      resourceKind: 'incidents.incident',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies IncidentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<IncidentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await findOneWithDecryption(em, Incident, { id: after.id, ...scope }, undefined, scope)
    if (!incident) return
    await withAtomicFlush(em, [
      () => {
        incident.deletedAt = new Date()
        incident.updatedAt = new Date()
      },
    ], { transaction: true })
    await emitIncidentUndoSideEffects(ctx, 'deleted', incident, { ...scope, id: incident.id })
  },
  redo: makeCreateRedo<Incident, IncidentSnapshot, IncidentCreateInput, IncidentCommandResult>({
    entityClass: Incident,
    dateFields: INCIDENT_DATE_FIELDS,
    buildResult: (incident) => ({
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
    }),
    findRow: ({ em, id, snapshot }) =>
      findOneWithDecryption(
        em,
        Incident,
        { id, organizationId: snapshot.organizationId, tenantId: snapshot.tenantId },
        undefined,
        { organizationId: snapshot.organizationId, tenantId: snapshot.tenantId },
      ),
    events: incidentEvents,
    indexer: incidentIndexer,
    transaction: true,
  }),
}

const updateIncidentCommand: CommandHandler<IncidentUpdateInput, IncidentCommandResult> = {
  id: 'incidents.incidents.update',
  async prepare(rawInput, ctx) {
    const parsed = incidentUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadIncidentSnapshot(em, parsed.id, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = incidentUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: parsed.id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: 'Incident not found' })

    if (parsed.severityId !== undefined) await requireSeverityInScope(em, parsed.severityId, scope)
    if (parsed.incidentTypeId !== undefined) await requireTypeInScope(em, parsed.incidentTypeId, scope)

    const now = new Date()
    const pendingEscalationEvents: escalationService.PendingEscalationEvent[] = []
    const phases: Array<() => void | Promise<void>> = [
      () => {
        if (parsed.title !== undefined) incident.title = parsed.title
        if (parsed.description !== undefined) incident.description = normalizeOptionalText(parsed.description)
        if (parsed.incidentTypeId !== undefined) incident.incidentTypeId = parsed.incidentTypeId ?? null
        if (parsed.severityId !== undefined) incident.severityId = parsed.severityId
        if (parsed.priority !== undefined) incident.priority = normalizeOptionalText(parsed.priority)
        if (parsed.ownerUserId !== undefined) incident.ownerUserId = parsed.ownerUserId ?? null
        if (parsed.owningTeamId !== undefined) incident.owningTeamId = parsed.owningTeamId ?? null
        if (parsed.customerImpactSummary !== undefined) {
          incident.customerImpactSummary = normalizeOptionalText(parsed.customerImpactSummary)
        }
        incident.updatedAt = now
      },
    ]

    if (parsed.severityId !== undefined) {
      phases.push(async () => {
        await applyIncidentUpdateCadence(em, scope, incident, now)
      })
    }

    if (parsed.escalationPolicyId !== undefined) {
      const actorUserId = resolveActorUserId(ctx)
      phases.push(async () => {
        const policyResult = await escalationService.applyPolicyChange(
          em,
          scope,
          incident,
          parsed.escalationPolicyId ?? null,
          { actorUserId, now, container: ctx.container },
        )
        pendingEscalationEvents.push(...policyResult.pendingEvents)
      })
    }

    await withAtomicFlush(em, phases, { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitPendingEscalationEvents(pendingEscalationEvents)
    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadIncidentSnapshot(em, result.incidentId, result)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as IncidentSnapshot | undefined
    const after = snapshots.after as IncidentSnapshot | undefined
    if (!before || !after) return null
    if (snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.incident.update', 'Update incident'),
      resourceKind: 'incidents.incident',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges({ ...before }, { ...after }, INCIDENT_CHANGE_KEYS),
      payload: {
        undo: { before, after } satisfies IncidentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<IncidentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let incident = await findOneWithDecryption(em, Incident, { id: before.id, ...scope }, undefined, scope)
    await withAtomicFlush(em, [
      () => {
        if (!incident) {
          incident = createIncidentFromSnapshot(em, before)
          return
        }
        applyIncidentSnapshot(incident, before)
      },
    ], { transaction: true })
    await emitIncidentUndoSideEffects(ctx, 'updated', incident, { ...scope, id: before.id })
  },
}

const deleteIncidentCommand: CommandHandler<IncidentDeleteInput, IncidentCommandResult> = {
  id: 'incidents.incidents.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Incident id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadIncidentSnapshot(em, id, scope)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Incident id is required')
    const scope = resolveCommandScope(ctx, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!incident) throw new CrudHttpError(404, { error: 'Incident not found' })

    await withAtomicFlush(em, [
      () => {
        incident.deletedAt = new Date()
        incident.updatedAt = new Date()
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'deleted', incident)
    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as IncidentSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('incidents.audit.incident.delete', 'Delete incident'),
      resourceKind: 'incidents.incident',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies IncidentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<IncidentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = { organizationId: before.organizationId, tenantId: before.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let incident = await findOneWithDecryption(em, Incident, { id: before.id, ...scope }, undefined, scope)
    await withAtomicFlush(em, [
      () => {
        if (!incident) {
          incident = createIncidentFromSnapshot(em, before)
          incident.deletedAt = null
          return
        }
        applyIncidentSnapshot(incident, before)
        incident.deletedAt = null
      },
    ], { transaction: true })
    await emitIncidentUndoSideEffects(ctx, 'created', incident, { ...scope, id: before.id })
  },
}

registerCommand(createIncidentCommand)
registerCommand(updateIncidentCommand)
registerCommand(deleteIncidentCommand)
