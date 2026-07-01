import { registerCommand, type CommandHandler, type CommandLogMetadata, type CommandRuntimeContext, type CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { buildChanges, emitCrudSideEffects, snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import { Incident, IncidentParticipant, IncidentRole } from '../data/entities'
import {
  participantAddSchema,
  participantRemoveSchema,
  participantUpdateSchema,
  type ParticipantAddInput,
  type ParticipantRemoveInput,
  type ParticipantUpdateInput,
} from '../data/collab-validators'
import {
  emitIncidentSideEffects,
  resolveCommandScope,
  type IncidentScope,
} from './incident'
import { assertIncidentMutable } from './actions'

type ParticipantCommandResult = {
  participantId: string
  incidentId: string
  organizationId: string
  tenantId: string
  updatedAt: Date
}

type ParticipantSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  incidentId: string
  userId: string
  kind: string
  roleId: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type ParticipantUndoPayload = UndoPayload<ParticipantSnapshot>

const PARTICIPANT_CHANGE_KEYS = ['userId', 'kind', 'roleId', 'deletedAt'] as const

const participantIndexer: CrudIndexerConfig<IncidentParticipant> = {
  entityType: E.incidents.incident_participant,
}

function optionalIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null
}

function parseOptionalDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function snapshotParticipant(participant: IncidentParticipant): ParticipantSnapshot {
  return {
    id: participant.id,
    organizationId: participant.organizationId,
    tenantId: participant.tenantId,
    incidentId: participant.incidentId,
    userId: participant.userId,
    kind: participant.kind,
    roleId: participant.roleId ?? null,
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
    deletedAt: optionalIso(participant.deletedAt),
  }
}

async function loadParticipantSnapshot(
  em: EntityManager,
  id: string,
  scope: IncidentScope,
): Promise<ParticipantSnapshot | null> {
  const participant = await em.findOne(IncidentParticipant, {
    id,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  return participant ? snapshotParticipant(participant) : null
}

function applyParticipantSnapshot(participant: IncidentParticipant, snapshot: ParticipantSnapshot): void {
  participant.organizationId = snapshot.organizationId
  participant.tenantId = snapshot.tenantId
  participant.incidentId = snapshot.incidentId
  participant.userId = snapshot.userId
  participant.kind = snapshot.kind
  participant.roleId = snapshot.roleId
  participant.createdAt = new Date(snapshot.createdAt)
  participant.updatedAt = new Date(snapshot.updatedAt)
  participant.deletedAt = parseOptionalDate(snapshot.deletedAt)
}

function createParticipantFromSnapshot(
  em: EntityManager,
  snapshot: ParticipantSnapshot,
): IncidentParticipant {
  const participant = em.create(IncidentParticipant, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    incidentId: snapshot.incidentId,
    userId: snapshot.userId,
    kind: snapshot.kind,
    roleId: snapshot.roleId,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: parseOptionalDate(snapshot.deletedAt),
  })
  em.persist(participant)
  return participant
}

async function loadIncidentForParticipant(
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

async function loadActiveParticipant(
  em: EntityManager,
  id: string,
  incidentId: string,
  scope: IncidentScope,
): Promise<IncidentParticipant> {
  const participant = await em.findOne(IncidentParticipant, {
    id,
    incidentId,
    ...scope,
    deletedAt: null,
  })
  if (!participant) throw new CrudHttpError(404, { error: '[internal] incident participant not found' })
  return participant
}

async function requireRoleInScope(
  em: EntityManager,
  roleId: string | null | undefined,
  scope: IncidentScope,
): Promise<void> {
  if (!roleId) return
  const role = await em.findOne(IncidentRole, { id: roleId, ...scope, deletedAt: null })
  if (!role) throw new CrudHttpError(400, { error: '[internal] incident role not found' })
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

async function emitParticipantSideEffects(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  participant: IncidentParticipant,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: participant,
    identifiers: {
      id: participant.id,
      organizationId: participant.organizationId,
      tenantId: participant.tenantId,
    },
    indexer: participantIndexer,
  })
}

async function captureParticipantAfter(
  result: ParticipantCommandResult,
  ctx: CommandRuntimeContext,
): Promise<ParticipantSnapshot | null> {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  return loadParticipantSnapshot(em, result.participantId, result)
}

async function buildParticipantLog(
  snapshots: { before?: unknown; after?: unknown },
  result: ParticipantCommandResult,
  label: { key: string; fallback: string },
): Promise<CommandLogMetadata | null> {
  const before = snapshots.before as ParticipantSnapshot | undefined
  const after = snapshots.after as ParticipantSnapshot | undefined
  if (!before && !after) return null
  if (before && after && snapshotsEqual(before, after)) return { skipLog: true }
  const snapshot = after ?? before
  if (!snapshot) return null
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(label.key, label.fallback),
    resourceKind: 'incidents.participant',
    resourceId: snapshot.id,
    parentResourceKind: 'incidents.incident',
    parentResourceId: result.incidentId,
    tenantId: result.tenantId,
    organizationId: result.organizationId,
    snapshotBefore: before,
    snapshotAfter: after,
    changes: after ? buildChanges(before ? { ...before } : null, { ...after }, PARTICIPANT_CHANGE_KEYS) : null,
    payload: {
      undo: { before, after } satisfies ParticipantUndoPayload,
    },
  }
}

async function restoreParticipantSnapshot(
  em: EntityManager,
  snapshot: ParticipantSnapshot,
): Promise<IncidentParticipant> {
  const participant = await em.findOne(IncidentParticipant, {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
  })
  if (!participant) return createParticipantFromSnapshot(em, snapshot)
  applyParticipantSnapshot(participant, snapshot)
  em.persist(participant)
  return participant
}

async function undoToSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: ParticipantSnapshot | null | undefined,
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
  let participant!: IncidentParticipant
  const now = new Date()
  await withAtomicFlush(em, [
    async () => {
      participant = await restoreParticipantSnapshot(em, snapshot)
      participant.updatedAt = now
      if (action === 'created') participant.deletedAt = null
      if (incident) {
        incident.updatedAt = now
        em.persist(incident)
      }
    },
  ], { transaction: true })
  await emitParticipantSideEffects(ctx, action, participant)
  if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
}

const addParticipantCommand: CommandHandler<ParticipantAddInput, ParticipantCommandResult> = {
  id: 'incidents.participants.add',
  async execute(rawInput, ctx) {
    const parsed = participantAddSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForParticipant(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    await requireRoleInScope(em, parsed.roleId, scope)

    const existing = await em.findOne(IncidentParticipant, {
      incidentId: incident.id,
      userId: parsed.userId,
      kind: parsed.kind,
      ...scope,
      deletedAt: null,
    })
    if (existing) throw new CrudHttpError(409, { error: '[internal] incident participant already exists' })

    const now = new Date()
    let participant!: IncidentParticipant
    await withAtomicFlush(em, [
      () => {
        participant = em.create(IncidentParticipant, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          incidentId: incident.id,
          userId: parsed.userId,
          kind: parsed.kind,
          roleId: parsed.roleId ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        em.persist(participant)
        incident.updatedAt = now
        em.persist(incident)
      },
    ], { transaction: true })

    await emitParticipantSideEffects(ctx, 'created', participant)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      participantId: participant.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureParticipantAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildParticipantLog(snapshots, result, {
    key: 'incidents.audit.participants.add',
    fallback: 'Add incident participant',
  }),
  undo: async ({ logEntry, ctx }) => {
    const after = extractUndoPayload<ParticipantUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = { organizationId: after.organizationId, tenantId: after.tenantId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const participant = await em.findOne(IncidentParticipant, { id: after.id, ...scope })
    const incident = await findOneWithDecryption(
      em,
      Incident,
      { id: after.incidentId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    if (!participant) return
    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        participant.deletedAt = now
        participant.updatedAt = now
        if (incident) {
          incident.updatedAt = now
          em.persist(incident)
        }
      },
    ], { transaction: true })
    await emitParticipantSideEffects(ctx, 'deleted', participant)
    if (incident) await emitIncidentSideEffects(ctx, 'updated', incident)
  },
}

const updateParticipantRoleCommand: CommandHandler<ParticipantUpdateInput, ParticipantCommandResult> = {
  id: 'incidents.participants.update_role',
  async prepare(rawInput, ctx) {
    const parsed = participantUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadParticipantSnapshot(em, parsed.pid, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = participantUpdateSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForParticipant(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    await requireRoleInScope(em, parsed.roleId, scope)
    const participant = await loadActiveParticipant(em, parsed.pid, incident.id, scope)

    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        participant.roleId = parsed.roleId
        participant.updatedAt = now
        incident.updatedAt = now
        em.persist(participant)
        em.persist(incident)
      },
    ], { transaction: true })

    await emitParticipantSideEffects(ctx, 'updated', participant)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      participantId: participant.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureParticipantAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildParticipantLog(snapshots, result, {
    key: 'incidents.audit.participants.update_role',
    fallback: 'Update incident participant role',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ParticipantUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'updated')
  },
}

const removeParticipantCommand: CommandHandler<ParticipantRemoveInput, ParticipantCommandResult> = {
  id: 'incidents.participants.remove',
  async prepare(rawInput, ctx) {
    const parsed = participantRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadParticipantSnapshot(em, parsed.pid, scope)
    return before ? { before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = participantRemoveSchema.parse(rawInput)
    const scope = resolveCommandScope(ctx, parsed)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const incident = await loadIncidentForParticipant(em, parsed.id, scope)
    await enforceIncidentOptimisticLock(ctx, incident)
    assertIncidentMutable(incident)
    const participant = await loadActiveParticipant(em, parsed.pid, incident.id, scope)

    const now = new Date()
    await withAtomicFlush(em, [
      () => {
        participant.deletedAt = now
        participant.updatedAt = now
        incident.updatedAt = now
        em.persist(participant)
        em.persist(incident)
      },
    ], { transaction: true })

    await emitParticipantSideEffects(ctx, 'deleted', participant)
    await emitIncidentSideEffects(ctx, 'updated', incident)
    return {
      participantId: participant.id,
      incidentId: incident.id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      updatedAt: incident.updatedAt,
    }
  },
  captureAfter: (_input, result, ctx) => captureParticipantAfter(result, ctx),
  buildLog: ({ snapshots, result }) => buildParticipantLog(snapshots, result, {
    key: 'incidents.audit.participants.remove',
    fallback: 'Remove incident participant',
  }),
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<ParticipantUndoPayload>(logEntry)?.before
    await undoToSnapshot(ctx, before, 'created')
  },
}

registerCommand(addParticipantCommand)
registerCommand(updateParticipantRoleCommand)
registerCommand(removeParticipantCommand)
