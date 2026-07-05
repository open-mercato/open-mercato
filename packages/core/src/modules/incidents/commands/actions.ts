import { incidentFind, incidentFindOne } from '../lib/read'
import { z } from 'zod'
import {
  registerCommand,
  type CommandHandler,
  type CommandLogMetadata,
  type CommandRuntimeContext,
  type CommandUndoLogEntry,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges, snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Incident, IncidentImpact, IncidentPostmortem, IncidentSeverity, IncidentTimelineEntry, IncidentType } from '../data/entities'
import type { IncidentEscalationTarget } from '../data/entities'
import {
  acknowledgeSchema,
  assignSchema,
  changeSeveritySchema,
  escalateSchema,
  incidentStatusSchema,
  snoozeSchema,
  transitionSchema,
  type IncidentAcknowledgeInput,
  type IncidentAssignInput,
  type IncidentChangeSeverityInput,
  type IncidentEscalateInput,
  type IncidentSnoozeInput,
  type IncidentTransitionInput,
} from '../data/action-validators'
import { emitIncidentsEvent, type IncidentsEventId } from '../events'
import * as escalationService from '../services/escalationService'
import { applyIncidentUpdateCadence, clearIncidentUpdateCadence } from '../lib/updateCadence'
import {
  applyIncidentSnapshot,
  createIncidentFromSnapshot,
  emitIncidentSideEffects,
  emitIncidentUndoSideEffects,
  INCIDENT_CHANGE_KEYS,
  loadIncidentSnapshot,
  resolveActorUserId,
  resolveCommandScope,
  type IncidentCommandResult,
  type IncidentScope,
  type IncidentSnapshot,
  type IncidentUndoPayload,
} from './incident'

type IncidentStatus = z.infer<typeof incidentStatusSchema>

type IncidentActionResult = IncidentCommandResult & {
  timelineEntryId?: string
  escalationLevel?: number
  escalationStepCount?: number
  escalationStatus?: string
  nextEscalationAt?: Date | null
  pagedTargets?: IncidentEscalationTarget[]
  recipients?: escalationService.EscalationRecipient[]
}

type IncidentActionSchema<TInput> = {
  parse(input: unknown): TInput
}

type ActionLogLabel = {
  key: string
  fallback: string
}

type TimelineKind =
  | 'ack'
  | 'status_change'
  | 'reopened'
  | 'severity_change'
  | 'assignment'
  | 'escalation'
  | 'system'

type TimelineMetadata = Record<string, unknown>

type PostmortemTextField = 'summary' | 'rootCause' | 'impact' | 'contributingFactors' | 'lessons'

const ALLOWED_TRANSITIONS = {
  open: ['investigating', 'identified', 'mitigated', 'resolved'],
  investigating: ['identified'],
  identified: ['investigating', 'mitigated'],
  mitigated: ['identified', 'resolved'],
  resolved: ['closed', 'open'],
  closed: ['open'],
} as const satisfies Record<IncidentStatus, readonly IncidentStatus[]>

const POSTMORTEM_FIELD_MAP: Record<string, PostmortemTextField> = {
  summary: 'summary',
  root_cause: 'rootCause',
  rootCause: 'rootCause',
  impact: 'impact',
  contributing_factors: 'contributingFactors',
  contributingFactors: 'contributingFactors',
  lessons: 'lessons',
}

function resolveUserFeatures(ctx: CommandRuntimeContext): string[] {
  const features = (ctx.auth as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

function requireCloseFeature(ctx: CommandRuntimeContext): void {
  if ((ctx.auth as { isSuperAdmin?: boolean } | null)?.isSuperAdmin === true) return
  if (hasFeature(resolveUserFeatures(ctx), 'incidents.incident.close')) return
  throw new CrudHttpError(403, { error: '[internal] incident close permission required' })
}

async function prepareIncidentAction<TInput extends { id: string; organizationId?: string | null; tenantId?: string | null }>(
  schema: IncidentActionSchema<TInput>,
  rawInput: TInput,
  ctx: CommandRuntimeContext,
): Promise<{ before?: IncidentSnapshot }> {
  const parsed = schema.parse(rawInput)
  const scope = resolveCommandScope(ctx, parsed)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const before = await loadIncidentSnapshot(em, parsed.id, scope)
  return before ? { before } : {}
}

async function captureIncidentAfter(
  result: IncidentActionResult,
  ctx: CommandRuntimeContext,
): Promise<IncidentSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadIncidentSnapshot(em, result.incidentId, result)
}

async function buildIncidentActionLog(
  snapshots: { before?: unknown; after?: unknown },
  label: ActionLogLabel,
): Promise<CommandLogMetadata | null> {
  const before = snapshots.before as IncidentSnapshot | undefined
  const after = snapshots.after as IncidentSnapshot | undefined
  if (!before || !after) return null
  if (snapshotsEqual(before, after)) return { skipLog: true }
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.incident',
    resourceId: before.id,
    tenantId: before.tenantId,
    organizationId: before.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: buildChanges({ ...before }, { ...after }, INCIDENT_CHANGE_KEYS),
    context: {
      timelineEntriesAppendOnly: true,
    },
    payload: {
      undo: { before, after } satisfies IncidentUndoPayload,
    },
  }
}

async function undoIncidentAction(logEntry: CommandUndoLogEntry, ctx: CommandRuntimeContext): Promise<void> {
  const before = extractUndoPayload<IncidentUndoPayload>(logEntry)?.before
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
}

async function loadIncidentForAction(
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

export function assertIncidentNotMerged(incident: Incident): void {
  if (incident.mergedIntoIncidentId) {
    throw new CrudHttpError(409, { error: '[internal] incident_merged' })
  }
}

export function assertIncidentMutable(incident: Incident, options?: { allowClosed?: boolean }): void {
  assertIncidentNotMerged(incident)
  if (incident.status === 'closed' && !options?.allowClosed) {
    throw new CrudHttpError(409, { error: '[internal] incident is closed' })
  }
}

export function applyIncidentCloseCascade(incident: Incident, now: Date): void {
  incident.status = 'closed'
  incident.resolvedAt = incident.resolvedAt ?? now
  incident.closedAt = now
  incident.nextEscalationAt = null
  incident.snoozedUntil = null
  clearIncidentUpdateCadence(incident)
  escalationService.clearEscalationForResolveClose(incident)
}

async function enforceIncidentOptimisticLock(
  ctx: CommandRuntimeContext,
  incident: Incident,
): Promise<void> {
  const expectedUpdatedAt = (ctx as CommandRuntimeContext & {
    incidentOptimisticLockExpectedUpdatedAtById?: Record<string, string | null | undefined>
  }).incidentOptimisticLockExpectedUpdatedAtById?.[incident.id]

  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: 'incidents.incident',
    resourceId: incident.id,
    current: incident.updatedAt,
    expected: expectedUpdatedAt,
    request: ctx.request ?? null,
  })
}

function appendTimelineEntry(input: {
  em: EntityManager
  scope: IncidentScope
  incidentId: string
  kind: TimelineKind
  actorUserId: string
  metadata: TimelineMetadata | null
  now: Date
}): IncidentTimelineEntry {
  const entry = input.em.create(IncidentTimelineEntry, {
    organizationId: input.scope.organizationId,
    tenantId: input.scope.tenantId,
    incidentId: input.incidentId,
    kind: input.kind,
    actorUserId: input.actorUserId,
    body: null,
    visibility: 'internal',
    metadata: input.metadata,
    createdAt: input.now,
  })
  input.em.persist(entry)
  return entry
}

function readTimelineEntryId(entry: IncidentTimelineEntry | null): string | undefined {
  return entry?.id
}

function eventPayload(
  ctx: CommandRuntimeContext,
  scope: IncidentScope,
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    ...extra,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }
}

const CUSTOMER_IMPACT_TARGET_TYPES = ['customer_account', 'customer_person', 'customer_company'] as const

export async function resolveIncidentAccountTargetIds(
  em: EntityManager,
  scope: IncidentScope,
  incidentId: string,
): Promise<string[]> {
  const impacts = await incidentFind(em,
    IncidentImpact,
    {
      incidentId,
      ...scope,
      targetType: { $in: CUSTOMER_IMPACT_TARGET_TYPES },
      deletedAt: null,
    },
    { fields: ['targetId'] as const },
  )
  return Array.from(new Set(
    impacts
      .map((impact) => impact.targetId ?? null)
      .filter((targetId): targetId is string => typeof targetId === 'string' && targetId.length > 0),
  ))
}

async function resolvePortalRecipientGroups(
  ctx: CommandRuntimeContext,
  incident: Incident,
  accountTargetIds: string[],
): Promise<string[][]> {
  if (accountTargetIds.length === 0) return []
  try {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const placeholders = accountTargetIds.map(() => '?').join(', ')
    const rows = await em.getConnection().execute<{ id: string; customer_entity_id: string | null; person_entity_id: string | null }[]>(
      `select "id", "customer_entity_id", "person_entity_id" from "customer_users" where "tenant_id" = ? and "organization_id" = ? and "is_active" = true and "deleted_at" is null and ("customer_entity_id" in (${placeholders}) or "person_entity_id" in (${placeholders}))`,
      [incident.tenantId, incident.organizationId, ...accountTargetIds, ...accountTargetIds],
    )
    const groups: string[][] = []
    for (const targetId of accountTargetIds) {
      const recipientUserIds = Array.from(new Set(
        rows
          .filter((row) => row.customer_entity_id === targetId || row.person_entity_id === targetId)
          .map((row) => row.id)
          .filter((id) => typeof id === 'string' && id.length > 0),
      ))
      if (recipientUserIds.length > 0) groups.push(recipientUserIds)
    }
    return groups
  } catch (error) {
    console.warn('[incidents] portal recipient resolution failed', {
      incidentId: incident.id,
      targetCount: accountTargetIds.length,
      error,
    })
    return []
  }
}

export async function emitIncidentCustomerUpdated(
  ctx: CommandRuntimeContext,
  incident: Incident,
  accountTargetIds: string[],
): Promise<void> {
  const recipientGroups = await resolvePortalRecipientGroups(ctx, incident, accountTargetIds)
  for (const recipientUserIds of recipientGroups) {
    await emitIncidentsEvent(
      'incidents.incident.customer_updated',
      {
        incidentId: incident.id,
        organizationId: incident.organizationId,
        tenantId: incident.tenantId,
        status: incident.status,
        number: incident.number,
        recipientUserIds,
        ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
      },
      { persistent: true },
    )
  }
}

async function emitLifecycleEvent(
  eventId: IncidentsEventId,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitIncidentsEvent(eventId, payload, { persistent: true })
}

async function emitTimelineAdded(
  ctx: CommandRuntimeContext,
  scope: IncidentScope,
  entry: IncidentTimelineEntry | null,
): Promise<void> {
  if (!entry) return
  await emitLifecycleEvent(
    'incidents.timeline_entry.added',
    eventPayload(ctx, scope, entry.id, {
      incidentId: entry.incidentId,
      kind: entry.kind,
      visibility: entry.visibility,
    }),
  )
}

function normalizeFieldValue(value: string | number | boolean | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized.length ? normalized : null
}

function fieldAliases(key: string): string[] {
  const mapped = POSTMORTEM_FIELD_MAP[key]
  if (!mapped) return [key]
  const aliases = Object.entries(POSTMORTEM_FIELD_MAP)
    .filter(([, field]) => field === mapped)
    .map(([alias]) => alias)
  return Array.from(new Set([key, mapped, ...aliases]))
}

function readRequiredFieldValue(
  fields: IncidentTransitionInput['fields'] | undefined,
  key: string,
): string | null {
  if (!fields) return null
  for (const alias of fieldAliases(key)) {
    if (!Object.prototype.hasOwnProperty.call(fields, alias)) continue
    const value = normalizeFieldValue(fields[alias])
    if (value) return value
  }
  return null
}

function requiredFieldErrors(
  requiredFields: readonly string[],
  fields: IncidentTransitionInput['fields'] | undefined,
  existing: IncidentPostmortem | null,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const key of requiredFields) {
    const fromPayload = readRequiredFieldValue(fields, key)
    const fromExisting = readPersistedPostmortemValue(existing, key)
    if (!fromPayload && !fromExisting) errors[key] = 'required'
  }
  return errors
}

function readPostmortemTextField(postmortem: IncidentPostmortem, field: PostmortemTextField): string | null {
  switch (field) {
    case 'summary':
      return normalizeFieldValue(postmortem.summary)
    case 'rootCause':
      return normalizeFieldValue(postmortem.rootCause)
    case 'impact':
      return normalizeFieldValue(postmortem.impact)
    case 'contributingFactors':
      return normalizeFieldValue(postmortem.contributingFactors)
    case 'lessons':
      return normalizeFieldValue(postmortem.lessons)
  }
}

function readPersistedPostmortemValue(existing: IncidentPostmortem | null, key: string): string | null {
  if (!existing) return null
  for (const alias of fieldAliases(key)) {
    const target = POSTMORTEM_FIELD_MAP[alias]
    if (!target) continue
    const value = readPostmortemTextField(existing, target)
    if (value) return value
  }
  return null
}

function setPostmortemField(postmortem: IncidentPostmortem, field: PostmortemTextField, value: string | null): void {
  switch (field) {
    case 'summary':
      postmortem.summary = value
      return
    case 'rootCause':
      postmortem.rootCause = value
      return
    case 'impact':
      postmortem.impact = value
      return
    case 'contributingFactors':
      postmortem.contributingFactors = value
      return
    case 'lessons':
      postmortem.lessons = value
      return
  }
}

function applyPostmortemFields(
  postmortem: IncidentPostmortem,
  fields: IncidentTransitionInput['fields'] | undefined,
  now: Date,
): void {
  if (fields) {
    for (const [key, rawValue] of Object.entries(fields)) {
      const target = POSTMORTEM_FIELD_MAP[key]
      if (!target) continue
      const value = normalizeFieldValue(rawValue)
      if (!value) continue
      setPostmortemField(postmortem, target, value)
    }
  }
  postmortem.status = 'draft'
  postmortem.updatedAt = now
}

async function resolveRequiredFieldsOnResolve(
  em: EntityManager,
  incident: Incident,
  scope: IncidentScope,
): Promise<readonly string[]> {
  if (!incident.incidentTypeId) return []
  const type = await incidentFindOne(em, IncidentType, { id: incident.incidentTypeId, ...scope, deletedAt: null })
  return Array.isArray(type?.requiredFieldsOnResolve) ? type.requiredFieldsOnResolve : []
}

function isAllowedTransition(from: string, to: IncidentStatus): boolean {
  const parsedFrom = incidentStatusSchema.safeParse(from)
  if (!parsedFrom.success) return false
  const allowed: readonly IncidentStatus[] = ALLOWED_TRANSITIONS[parsedFrom.data]
  return allowed.includes(to)
}

const acknowledgeIncidentCommand: CommandHandler<IncidentAcknowledgeInput, IncidentActionResult> = {
  id: 'incidents.incident.acknowledge',
  prepare: (input, ctx) => prepareIncidentAction(acknowledgeSchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = acknowledgeSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    if (incident.acknowledgedAt) {
      return {
        incidentId: incident.id,
        organizationId: incident.organizationId,
        tenantId: incident.tenantId,
        updatedAt: incident.updatedAt,
      }
    }

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        incident.acknowledgedAt = now
        escalationService.haltEscalationForAck(incident, now)
        incident.updatedAt = now
        timelineEntry = appendTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: 'ack',
          actorUserId,
          metadata: { acknowledgedAt: now.toISOString() },
          now,
        })
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitLifecycleEvent(
      'incidents.incident.acknowledged',
      eventPayload(ctx, scope, incident.id, { actorUserId, acknowledgedAt: now.toISOString() }),
    )
    await emitTimelineAdded(ctx, scope, timelineEntry)

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      timelineEntryId: readTimelineEntryId(timelineEntry),
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.acknowledge',
    fallback: 'Acknowledge incident',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

const transitionIncidentCommand: CommandHandler<IncidentTransitionInput, IncidentActionResult> = {
  id: 'incidents.incident.transition_status',
  prepare: (input, ctx) => prepareIncidentAction(transitionSchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = transitionSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    if (parsed.status === 'closed') requireCloseFeature(ctx)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident, { allowClosed: true })

    const from = incident.status
    const to = parsed.status
    if (!isAllowedTransition(from, to)) {
      throw new CrudHttpError(400, { error: '[internal] invalid transition' })
    }

    const requiresPostmortemDraft = to === 'resolved' || to === 'closed'
    let postmortem: IncidentPostmortem | null = null
    if (requiresPostmortemDraft) {
      postmortem = await findOneWithDecryption(
        em,
        IncidentPostmortem,
        { incidentId: incident.id, ...scope, deletedAt: null },
        undefined,
        scope,
      )
      const requiredFields = await resolveRequiredFieldsOnResolve(em, incident, scope)
      const errors = requiredFieldErrors(requiredFields, parsed.fields, postmortem)
      if (Object.keys(errors).length > 0) {
        throw new CrudHttpError(400, { error: 'record_invalid', fields: errors })
      }
    }

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    const timelineKind: TimelineKind = to === 'open' && (from === 'resolved' || from === 'closed')
      ? 'reopened'
      : 'status_change'
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        incident.status = to
        if (to === 'resolved') {
          incident.resolvedAt = now
          incident.closedAt = null
          incident.nextEscalationAt = null
          incident.snoozedUntil = null
          clearIncidentUpdateCadence(incident)
          escalationService.clearEscalationForResolveClose(incident)
        } else if (to === 'closed') {
          applyIncidentCloseCascade(incident, now)
        } else if (to === 'open') {
          incident.resolvedAt = null
          incident.closedAt = null
        }
        if (requiresPostmortemDraft) {
          if (!postmortem) {
            postmortem = em.create(IncidentPostmortem, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              incidentId: incident.id,
              status: 'draft',
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            })
            em.persist(postmortem)
          }
          applyPostmortemFields(postmortem, parsed.fields, now)
        }
        incident.updatedAt = now
        timelineEntry = appendTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: timelineKind,
          actorUserId,
          metadata: { from, to },
          now,
        })
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    const statusPayload = eventPayload(ctx, scope, incident.id, { actorUserId, from, to, status: to })
    await emitLifecycleEvent('incidents.incident.status_changed', statusPayload)
    if (to === 'resolved') await emitLifecycleEvent('incidents.incident.resolved', statusPayload)
    if (to === 'closed') await emitLifecycleEvent('incidents.incident.closed', statusPayload)
    if (to === 'open' && (from === 'resolved' || from === 'closed')) {
      await emitLifecycleEvent('incidents.incident.reopened', statusPayload)
    }
    const accountTargetIds = await resolveIncidentAccountTargetIds(em, scope, incident.id)
    if (accountTargetIds.length > 0) {
      await emitIncidentCustomerUpdated(ctx, incident, accountTargetIds)
    }
    await emitTimelineAdded(ctx, scope, timelineEntry)

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      timelineEntryId: readTimelineEntryId(timelineEntry),
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.transition_status',
    fallback: 'Transition incident status',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

const changeSeverityIncidentCommand: CommandHandler<IncidentChangeSeverityInput, IncidentActionResult> = {
  id: 'incidents.incident.change_severity',
  prepare: (input, ctx) => prepareIncidentAction(changeSeveritySchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = changeSeveritySchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    const severity = await incidentFindOne(em, IncidentSeverity, { id: parsed.severityId, ...scope, deletedAt: null })
    if (!severity) throw new CrudHttpError(400, { error: '[internal] incident severity not found' })

    const from = incident.severityId
    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        incident.severityId = parsed.severityId
        incident.updatedAt = now
        timelineEntry = appendTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: 'severity_change',
          actorUserId,
          metadata: { from, to: parsed.severityId },
          now,
        })
      },
      async () => {
        await applyIncidentUpdateCadence(em, scope, incident, now)
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitLifecycleEvent(
      'incidents.incident.severity_changed',
      eventPayload(ctx, scope, incident.id, { actorUserId, fromSeverityId: from, toSeverityId: parsed.severityId }),
    )
    await emitTimelineAdded(ctx, scope, timelineEntry)

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      timelineEntryId: readTimelineEntryId(timelineEntry),
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.change_severity',
    fallback: 'Change incident severity',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

const assignIncidentCommand: CommandHandler<IncidentAssignInput, IncidentActionResult> = {
  id: 'incidents.incident.assign',
  prepare: (input, ctx) => prepareIncidentAction(assignSchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = assignSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    const previousOwnerUserId = incident.ownerUserId ?? null
    const previousOwningTeamId = incident.owningTeamId ?? null
    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        if (parsed.ownerUserId !== undefined) incident.ownerUserId = parsed.ownerUserId ?? null
        if (parsed.owningTeamId !== undefined) incident.owningTeamId = parsed.owningTeamId ?? null
        incident.updatedAt = now
        timelineEntry = appendTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: 'assignment',
          actorUserId,
          metadata: {
            from: { ownerUserId: previousOwnerUserId, owningTeamId: previousOwningTeamId },
            to: { ownerUserId: incident.ownerUserId ?? null, owningTeamId: incident.owningTeamId ?? null },
          },
          now,
        })
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitLifecycleEvent(
      'incidents.incident.assigned',
      eventPayload(ctx, scope, incident.id, {
        actorUserId,
        ownerUserId: incident.ownerUserId ?? null,
        owningTeamId: incident.owningTeamId ?? null,
        previousOwnerUserId,
        previousOwningTeamId,
      }),
    )
    await emitTimelineAdded(ctx, scope, timelineEntry)

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      timelineEntryId: readTimelineEntryId(timelineEntry),
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.assign',
    fallback: 'Assign incident',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

const escalateIncidentCommand: CommandHandler<IncidentEscalateInput, IncidentActionResult> = {
  id: 'incidents.incident.escalate',
  prepare: (input, ctx) => prepareIncidentAction(escalateSchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = escalateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let escalationResult: Awaited<ReturnType<typeof escalationService.manualEscalate>> | null = null
    await withAtomicFlush(em, [
      async () => {
        escalationResult = await escalationService.manualEscalate(em, scope, incident, {
          actorUserId,
          now,
          container: ctx.container,
        })
      },
    ], { transaction: true })
    const resolvedEscalationResult = escalationResult as Awaited<ReturnType<typeof escalationService.manualEscalate>> | null
    if (!resolvedEscalationResult) {
      throw new CrudHttpError(500, { error: '[internal] escalation failed' })
    }

    await emitIncidentSideEffects(ctx, 'updated', incident)
    for (const event of resolvedEscalationResult.pendingEvents) {
      await emitLifecycleEvent(event.id, event.payload)
    }

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      escalationLevel: resolvedEscalationResult.escalationLevel,
      escalationStepCount: resolvedEscalationResult.escalationStepCount,
      escalationStatus: resolvedEscalationResult.escalationStatus,
      nextEscalationAt: resolvedEscalationResult.nextEscalationAt,
      pagedTargets: resolvedEscalationResult.pagedTargets,
      recipients: resolvedEscalationResult.recipients,
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.escalate',
    fallback: 'Escalate incident',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

const snoozeIncidentCommand: CommandHandler<IncidentSnoozeInput, IncidentActionResult> = {
  id: 'incidents.incident.snooze',
  prepare: (input, ctx) => prepareIncidentAction(snoozeSchema, input, ctx),
  async execute(rawInput, ctx) {
    const parsed = snoozeSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForAction(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentNotMerged(incident)
    assertIncidentMutable(incident)

    const until = new Date(parsed.until)
    const previousSnoozedUntil = incident.snoozedUntil?.toISOString() ?? null
    const now = new Date()
    const actorUserId = resolveActorUserId(ctx)
    let timelineEntry: IncidentTimelineEntry | null = null
    await withAtomicFlush(em, [
      () => {
        incident.snoozedUntil = until
        incident.nextEscalationAt = null
        incident.updatedAt = now
        timelineEntry = appendTimelineEntry({
          em,
          scope,
          incidentId: incident.id,
          kind: 'system',
          actorUserId,
          metadata: { from: previousSnoozedUntil, until: until.toISOString() },
          now,
        })
      },
    ], { transaction: true })

    await emitIncidentSideEffects(ctx, 'updated', incident)
    await emitLifecycleEvent(
      'incidents.incident.snoozed',
      eventPayload(ctx, scope, incident.id, { actorUserId, snoozedUntil: until.toISOString() }),
    )
    await emitTimelineAdded(ctx, scope, timelineEntry)

    return {
      incidentId: incident.id,
      organizationId: incident.organizationId,
      tenantId: incident.tenantId,
      updatedAt: incident.updatedAt,
      timelineEntryId: readTimelineEntryId(timelineEntry),
    }
  },
  captureAfter: (_input, result, ctx) => captureIncidentAfter(result, ctx),
  buildLog: ({ snapshots }) => buildIncidentActionLog(snapshots, {
    key: 'incidents.audit.incident.snooze',
    fallback: 'Snooze incident',
  }),
  undo: ({ logEntry, ctx }) => undoIncidentAction(logEntry, ctx),
}

registerCommand(acknowledgeIncidentCommand)
registerCommand(transitionIncidentCommand)
registerCommand(changeSeverityIncidentCommand)
registerCommand(assignIncidentCommand)
registerCommand(escalateIncidentCommand)
registerCommand(snoozeIncidentCommand)
