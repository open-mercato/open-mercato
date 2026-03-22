import { z } from 'zod'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  normalizeAuthorUserId,
} from '@open-mercato/shared/lib/commands/helpers'
import { DefaultDataEngine, type DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerInteraction } from '../data/entities'
import {
  interactionCreateSchema,
  interactionUpdateSchema,
  interactionCompleteSchema,
  interactionCancelSchema,
  type InteractionCreateInput,
  type InteractionUpdateInput,
  type InteractionCompleteInput,
  type InteractionCancelInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  requireCustomerEntity,
  extractUndoPayload,
  requireDealInScope,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { recomputeNextInteraction } from '../lib/interactionProjection'

const INTERACTION_ENTITY_ID = 'customers:customer_interaction'
const interactionCrudIndexer: CrudIndexerConfig<CustomerInteraction> = {
  entityType: 'customers:customer_interaction' as const,
}

const interactionCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'interaction',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type InteractionSnapshot = {
  interaction: {
    id: string
    organizationId: string
    tenantId: string
    entityId: string
    entityKind: string | null
    dealId: string | null
    interactionType: string
    title: string | null
    body: string | null
    status: string
    scheduledAt: Date | null
    occurredAt: Date | null
    priority: number | null
    authorUserId: string | null
    ownerUserId: string | null
    appearanceIcon: string | null
    appearanceColor: string | null
    source: string | null
  }
  custom?: Record<string, unknown>
}

type InteractionUndoPayload = {
  before?: InteractionSnapshot | null
  after?: InteractionSnapshot | null
}

async function loadInteractionSnapshot(em: EntityManager, id: string): Promise<InteractionSnapshot | null> {
  const interaction = await em.findOne(CustomerInteraction, { id }, { populate: ['entity'] })
  if (!interaction) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: INTERACTION_ENTITY_ID,
    recordId: interaction.id,
    tenantId: interaction.tenantId,
    organizationId: interaction.organizationId,
  })
  const entityRef = interaction.entity
  const entityKind = (typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef)
    ? (entityRef as { kind: string }).kind
    : null
  return {
    interaction: {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
      entityId: typeof entityRef === 'string' ? entityRef : entityRef.id,
      entityKind,
      dealId: interaction.dealId ?? null,
      interactionType: interaction.interactionType,
      title: interaction.title ?? null,
      body: interaction.body ?? null,
      status: interaction.status,
      scheduledAt: interaction.scheduledAt ?? null,
      occurredAt: interaction.occurredAt ?? null,
      priority: interaction.priority ?? null,
      authorUserId: interaction.authorUserId ?? null,
      ownerUserId: interaction.ownerUserId ?? null,
      appearanceIcon: interaction.appearanceIcon ?? null,
      appearanceColor: interaction.appearanceColor ?? null,
      source: interaction.source ?? null,
    },
    custom,
  }
}

async function setInteractionCustomFields(
  dataEngine: DataEngine,
  interactionId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>
) {
  if (!values || !Object.keys(values).length) return
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: INTERACTION_ENTITY_ID,
    recordId: interactionId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

async function emitLifecycleEvent(
  ctx: CommandRuntimeContext,
  eventId: string,
  payload: Record<string, unknown>
): Promise<void> {
  let bus: { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> } | null = null
  try {
    bus = ctx.container.resolve('eventBus')
  } catch {
    bus = null
  }
  if (!bus) return
  await bus
    .emitEvent(eventId, payload, { persistent: true })
    .catch(() => undefined)
}

async function emitInteractionRevertedEvent(
  ctx: CommandRuntimeContext,
  interaction: InteractionSnapshot['interaction'],
): Promise<void> {
  await emitLifecycleEvent(ctx, 'customers.interaction.reverted', {
    id: interaction.id,
    organizationId: interaction.organizationId,
    tenantId: interaction.tenantId,
    status: interaction.status,
    occurredAt: interaction.occurredAt?.toISOString() ?? null,
  })
}

type InteractionIdentifiers = {
  id: string
  organizationId: string
  tenantId: string
}

type InteractionProjectionMutation = {
  entityId: string
  nextInteractionId: string | null
}

function createTransactionalDataEngine(ctx: CommandRuntimeContext, em: EntityManager): DataEngine {
  const emWithConnection = em as EntityManager & { getConnection?: () => unknown }
  if (typeof emWithConnection.getConnection !== 'function') {
    return ctx.container.resolve('dataEngine') as DataEngine
  }
  return new DefaultDataEngine(em, ctx.container)
}

async function runInTransaction<TResult>(
  em: EntityManager,
  operation: (trx: EntityManager) => Promise<TResult>,
): Promise<TResult> {
  const transactionalEm = em as EntityManager & {
    transactional?: (callback: (trx: EntityManager) => Promise<TResult>) => Promise<TResult>
  }
  if (typeof transactionalEm.transactional === 'function') {
    return transactionalEm.transactional((trx) => operation(trx))
  }
  return operation(em)
}

async function emitNextInteractionUpdatedEvent(
  ctx: CommandRuntimeContext,
  projection: InteractionProjectionMutation,
  identifiers: InteractionIdentifiers,
): Promise<void> {
  await emitLifecycleEvent(ctx, 'customers.next_interaction.updated', {
    id: projection.entityId,
    entityId: projection.entityId,
    nextInteractionId: projection.nextInteractionId,
    organizationId: identifiers.organizationId,
    tenantId: identifiers.tenantId,
  })
}

// ─── Create ─────────────────────────────────────────────────────────

const createInteractionCommand: CommandHandler<InteractionCreateInput, { interactionId: string; entityId: string }> = {
  id: 'customers.interactions.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(interactionCreateSchema, rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const normalizedAuthor = normalizeAuthorUserId(parsed.authorUserId ?? null, ctx.auth)
    const { interaction, entityId } = await runInTransaction(em, async (trx) => {
      const entity = await requireCustomerEntity(trx, parsed.entityId, undefined, 'Customer not found')
      ensureTenantScope(ctx, entity.tenantId)
      ensureOrganizationScope(ctx, entity.organizationId)

      if (parsed.dealId) {
        await requireDealInScope(trx, parsed.dealId, entity.tenantId, entity.organizationId)
      }

      const interaction = trx.create(CustomerInteraction, {
        ...(parsed.id ? { id: parsed.id } : {}),
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
        entity,
        interactionType: parsed.interactionType,
        title: parsed.title ?? null,
        body: parsed.body ?? null,
        status: parsed.status ?? 'planned',
        scheduledAt: parsed.scheduledAt ?? null,
        occurredAt: parsed.occurredAt ?? null,
        priority: parsed.priority ?? null,
        authorUserId: normalizedAuthor,
        ownerUserId: parsed.ownerUserId ?? null,
        dealId: parsed.dealId ?? null,
        source: parsed.source ?? null,
        appearanceIcon: parsed.appearanceIcon ?? null,
        appearanceColor: parsed.appearanceColor ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      trx.persist(interaction)
      await trx.flush()

      await setInteractionCustomFields(
        createTransactionalDataEngine(ctx, trx),
        interaction.id,
        entity.organizationId,
        entity.tenantId,
        custom,
      )

      return {
        interaction,
        entityId: entity.id,
      }
    })

    const projection = await recomputeNextInteraction(em, entityId)
    const nextInteractionId = projection.nextInteractionId

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: interaction,
      identifiers: {
        id: interaction.id,
        organizationId: interaction.organizationId,
        tenantId: interaction.tenantId,
      },
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitNextInteractionUpdatedEvent(ctx, { entityId, nextInteractionId }, {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    })

    return { interactionId: interaction.id, entityId }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadInteractionSnapshot(em, result.interactionId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.interactions.create', 'Create interaction'),
      resourceKind: 'customers.interaction',
      resourceId: result.interactionId,
      parentResourceKind: resolveParentResourceKind(snapshot?.interaction?.entityKind),
      parentResourceId: snapshot?.interaction?.entityId ?? null,
      tenantId: snapshot?.interaction.tenantId ?? null,
      organizationId: snapshot?.interaction.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const interactionId = logEntry?.resourceId
    if (!interactionId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await runInTransaction(em, async (trx) => {
      const record = await trx.findOne(CustomerInteraction, { id: interactionId })
      if (!record) return null
      const entityId = typeof record.entity === 'string' ? record.entity : record.entity.id
      trx.remove(record)
      await trx.flush()
      return {
        entityId,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }
    })
    if (!result) return
    const projection = await recomputeNextInteraction(em, result.entityId)
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: result.entityId,
      nextInteractionId: projection.nextInteractionId,
    }, result.identifiers)
  },
}

// ─── Update ─────────────────────────────────────────────────────────

const updateInteractionCommand: CommandHandler<InteractionUpdateInput, { interactionId: string }> = {
  id: 'customers.interactions.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(interactionUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(interactionUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId } = await runInTransaction(em, async (trx) => {
      const interaction = await trx.findOne(CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) throw new CrudHttpError(404, { error: 'Interaction not found' })
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      if (parsed.dealId !== undefined) {
        if (parsed.dealId) {
          await requireDealInScope(trx, parsed.dealId, interaction.tenantId, interaction.organizationId)
        }
        interaction.dealId = parsed.dealId ?? null
      }
      if (parsed.interactionType !== undefined) interaction.interactionType = parsed.interactionType
      if (parsed.title !== undefined) interaction.title = parsed.title ?? null
      if (parsed.body !== undefined) interaction.body = parsed.body ?? null
      if (parsed.status !== undefined) interaction.status = parsed.status
      if (parsed.scheduledAt !== undefined) interaction.scheduledAt = parsed.scheduledAt ?? null
      if (parsed.occurredAt !== undefined) interaction.occurredAt = parsed.occurredAt ?? null
      if (parsed.priority !== undefined) interaction.priority = parsed.priority ?? null
      if (parsed.authorUserId !== undefined) interaction.authorUserId = parsed.authorUserId ?? null
      if (parsed.ownerUserId !== undefined) interaction.ownerUserId = parsed.ownerUserId ?? null
      if (parsed.appearanceIcon !== undefined) interaction.appearanceIcon = parsed.appearanceIcon ?? null
      if (parsed.appearanceColor !== undefined) interaction.appearanceColor = parsed.appearanceColor ?? null

      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      await setInteractionCustomFields(
        createTransactionalDataEngine(ctx, trx),
        interaction.id,
        interaction.organizationId,
        interaction.tenantId,
        custom,
      )

      return { interaction, entityId }
    })

    const projection = await recomputeNextInteraction(em, entityId)
    const nextInteractionId = projection.nextInteractionId

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: interaction,
      identifiers: {
        id: interaction.id,
        organizationId: interaction.organizationId,
        tenantId: interaction.tenantId,
      },
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitNextInteractionUpdatedEvent(ctx, { entityId, nextInteractionId }, {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    })

    return { interactionId: interaction.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadInteractionSnapshot(em, result.interactionId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as InteractionSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.interactions.update', 'Update interaction'),
      resourceKind: 'customers.interaction',
      resourceId: before.interaction.id,
      parentResourceKind: resolveParentResourceKind(before.interaction.entityKind),
      parentResourceId: before.interaction.entityId ?? null,
      tenantId: before.interaction.tenantId,
      organizationId: before.interaction.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, nextInteractionId } = await runInTransaction(em, async (trx) => {
      let interaction = await trx.findOne(CustomerInteraction, { id: before.interaction.id })
      const entity = await requireCustomerEntity(trx, before.interaction.entityId, undefined, 'Customer not found')

      if (!interaction) {
        interaction = trx.create(CustomerInteraction, {
          id: before.interaction.id,
          organizationId: before.interaction.organizationId,
          tenantId: before.interaction.tenantId,
          entity,
          interactionType: before.interaction.interactionType,
          title: before.interaction.title,
          body: before.interaction.body,
          status: before.interaction.status,
          scheduledAt: before.interaction.scheduledAt,
          occurredAt: before.interaction.occurredAt,
          priority: before.interaction.priority,
          authorUserId: before.interaction.authorUserId,
          ownerUserId: before.interaction.ownerUserId,
          dealId: before.interaction.dealId,
          source: before.interaction.source,
          appearanceIcon: before.interaction.appearanceIcon,
          appearanceColor: before.interaction.appearanceColor,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        trx.persist(interaction)
      } else {
        interaction.entity = entity
        interaction.interactionType = before.interaction.interactionType
        interaction.title = before.interaction.title
        interaction.body = before.interaction.body
        interaction.status = before.interaction.status
        interaction.scheduledAt = before.interaction.scheduledAt
        interaction.occurredAt = before.interaction.occurredAt
        interaction.priority = before.interaction.priority
        interaction.authorUserId = before.interaction.authorUserId
        interaction.ownerUserId = before.interaction.ownerUserId
        interaction.dealId = before.interaction.dealId
        interaction.source = before.interaction.source
        interaction.appearanceIcon = before.interaction.appearanceIcon
        interaction.appearanceColor = before.interaction.appearanceColor
      }

      await trx.flush()
      const projection = await recomputeNextInteraction(trx, before.interaction.entityId)

      const resetValues = buildCustomFieldResetMap(before.custom, payload?.after?.custom)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: createTransactionalDataEngine(ctx, trx),
          entityId: INTERACTION_ENTITY_ID,
          recordId: interaction.id,
          organizationId: interaction.organizationId,
          tenantId: interaction.tenantId,
          values: resetValues,
          notify: false,
        })
      }

      return {
        interaction,
        nextInteractionId: projection.nextInteractionId,
      }
    })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: interaction,
      identifiers: {
        id: interaction.id,
        organizationId: interaction.organizationId,
        tenantId: interaction.tenantId,
      },
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: before.interaction.entityId,
      nextInteractionId,
    }, {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    })
  },
}

// ─── Complete ───────────────────────────────────────────────────────

const completeInteractionCommand: CommandHandler<InteractionCompleteInput, { interactionId: string }> = {
  id: 'customers.interactions.complete',
  async prepare(rawInput, ctx) {
    const parsed = interactionCompleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = interactionCompleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId } = await runInTransaction(em, async (trx) => {
      const interaction = await trx.findOne(CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) throw new CrudHttpError(404, { error: 'Interaction not found' })
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      interaction.status = 'done'
      interaction.occurredAt = parsed.occurredAt ?? new Date()
      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      return { interaction, entityId }
    })

    const projection = await recomputeNextInteraction(em, entityId)
    const nextInteractionId = projection.nextInteractionId

    const identifiers = {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    }
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: interaction,
      identifiers,
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitLifecycleEvent(ctx, 'customers.interaction.completed', identifiers)
    await emitNextInteractionUpdatedEvent(ctx, { entityId, nextInteractionId }, identifiers)

    return { interactionId: interaction.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadInteractionSnapshot(em, result.interactionId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as InteractionSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.interactions.complete', 'Complete interaction'),
      resourceKind: 'customers.interaction',
      resourceId: before.interaction.id,
      parentResourceKind: resolveParentResourceKind(before.interaction.entityKind),
      parentResourceId: before.interaction.entityId ?? null,
      tenantId: before.interaction.tenantId,
      organizationId: before.interaction.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await runInTransaction(em, async (trx) => {
      const interaction = await trx.findOne(CustomerInteraction, { id: before.interaction.id })
      if (!interaction) return null

      interaction.status = before.interaction.status
      interaction.occurredAt = before.interaction.occurredAt
      await trx.flush()

      const projection = await recomputeNextInteraction(trx, before.interaction.entityId)
      return {
        interaction,
        nextInteractionId: projection.nextInteractionId,
      }
    })
    if (!result) return

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: result.interaction,
      identifiers: {
        id: result.interaction.id,
        organizationId: result.interaction.organizationId,
        tenantId: result.interaction.tenantId,
      },
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitInteractionRevertedEvent(ctx, before.interaction)
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: before.interaction.entityId,
      nextInteractionId: result.nextInteractionId,
    }, {
      id: result.interaction.id,
      organizationId: result.interaction.organizationId,
      tenantId: result.interaction.tenantId,
    })
  },
}

// ─── Cancel ─────────────────────────────────────────────────────────

const cancelInteractionCommand: CommandHandler<InteractionCancelInput, { interactionId: string }> = {
  id: 'customers.interactions.cancel',
  async prepare(rawInput, ctx) {
    const parsed = interactionCancelSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = interactionCancelSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId } = await runInTransaction(em, async (trx) => {
      const interaction = await trx.findOne(CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) throw new CrudHttpError(404, { error: 'Interaction not found' })
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      interaction.status = 'canceled'
      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      return { interaction, entityId }
    })

    const projection = await recomputeNextInteraction(em, entityId)
    const nextInteractionId = projection.nextInteractionId

    const identifiers = {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    }
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: interaction,
      identifiers,
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitLifecycleEvent(ctx, 'customers.interaction.canceled', identifiers)
    await emitNextInteractionUpdatedEvent(ctx, { entityId, nextInteractionId }, identifiers)

    return { interactionId: interaction.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadInteractionSnapshot(em, result.interactionId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as InteractionSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.interactions.cancel', 'Cancel interaction'),
      resourceKind: 'customers.interaction',
      resourceId: before.interaction.id,
      parentResourceKind: resolveParentResourceKind(before.interaction.entityKind),
      parentResourceId: before.interaction.entityId ?? null,
      tenantId: before.interaction.tenantId,
      organizationId: before.interaction.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await runInTransaction(em, async (trx) => {
      const interaction = await trx.findOne(CustomerInteraction, { id: before.interaction.id })
      if (!interaction) return null

      interaction.status = before.interaction.status
      await trx.flush()

      const projection = await recomputeNextInteraction(trx, before.interaction.entityId)
      return {
        interaction,
        nextInteractionId: projection.nextInteractionId,
      }
    })
    if (!result) return

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: result.interaction,
      identifiers: {
        id: result.interaction.id,
        organizationId: result.interaction.organizationId,
        tenantId: result.interaction.tenantId,
      },
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitInteractionRevertedEvent(ctx, before.interaction)
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: before.interaction.entityId,
      nextInteractionId: result.nextInteractionId,
    }, {
      id: result.interaction.id,
      organizationId: result.interaction.organizationId,
      tenantId: result.interaction.tenantId,
    })
  },
}

// ─── Delete ─────────────────────────────────────────────────────────

const deleteInteractionCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { interactionId: string }> =
  {
    id: 'customers.interactions.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Interaction id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadInteractionSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Interaction id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { interaction, entityId } = await runInTransaction(em, async (trx) => {
        const interaction = await trx.findOne(CustomerInteraction, { id, deletedAt: null })
        if (!interaction) throw new CrudHttpError(404, { error: 'Interaction not found' })
        ensureTenantScope(ctx, interaction.tenantId)
        ensureOrganizationScope(ctx, interaction.organizationId)

        const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
        interaction.deletedAt = new Date()
        await trx.flush()

        return { interaction, entityId }
      })

      const projection = await recomputeNextInteraction(em, entityId)
      const nextInteractionId = projection.nextInteractionId

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: interaction,
        identifiers: {
          id: interaction.id,
          organizationId: interaction.organizationId,
          tenantId: interaction.tenantId,
        },
        indexer: interactionCrudIndexer,
        events: interactionCrudEvents,
      })
      await emitNextInteractionUpdatedEvent(ctx, { entityId, nextInteractionId }, {
        id: interaction.id,
        organizationId: interaction.organizationId,
        tenantId: interaction.tenantId,
      })
      return { interactionId: interaction.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as InteractionSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.interactions.delete', 'Delete interaction'),
        resourceKind: 'customers.interaction',
        resourceId: before.interaction.id,
        parentResourceKind: resolveParentResourceKind(before.interaction.entityKind),
        parentResourceId: before.interaction.entityId ?? null,
        tenantId: before.interaction.tenantId,
        organizationId: before.interaction.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies InteractionUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { interaction, nextInteractionId } = await runInTransaction(em, async (trx) => {
        const entity = await requireCustomerEntity(trx, before.interaction.entityId, undefined, 'Customer not found')
        let interaction = await trx.findOne(CustomerInteraction, { id: before.interaction.id })
        if (!interaction) {
          interaction = trx.create(CustomerInteraction, {
            id: before.interaction.id,
            organizationId: before.interaction.organizationId,
            tenantId: before.interaction.tenantId,
            entity,
            interactionType: before.interaction.interactionType,
            title: before.interaction.title,
            body: before.interaction.body,
            status: before.interaction.status,
            scheduledAt: before.interaction.scheduledAt,
            occurredAt: before.interaction.occurredAt,
            priority: before.interaction.priority,
            authorUserId: before.interaction.authorUserId,
            ownerUserId: before.interaction.ownerUserId,
            dealId: before.interaction.dealId,
            source: before.interaction.source,
            appearanceIcon: before.interaction.appearanceIcon,
            appearanceColor: before.interaction.appearanceColor,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          trx.persist(interaction)
        } else {
          interaction.deletedAt = null
          interaction.entity = entity
          interaction.interactionType = before.interaction.interactionType
          interaction.title = before.interaction.title
          interaction.body = before.interaction.body
          interaction.status = before.interaction.status
          interaction.scheduledAt = before.interaction.scheduledAt
          interaction.occurredAt = before.interaction.occurredAt
          interaction.priority = before.interaction.priority
          interaction.authorUserId = before.interaction.authorUserId
          interaction.ownerUserId = before.interaction.ownerUserId
          interaction.dealId = before.interaction.dealId
          interaction.source = before.interaction.source
          interaction.appearanceIcon = before.interaction.appearanceIcon
          interaction.appearanceColor = before.interaction.appearanceColor
        }
        await trx.flush()

        const projection = await recomputeNextInteraction(trx, before.interaction.entityId)

        const resetValues = buildCustomFieldResetMap(before.custom, undefined)
        if (Object.keys(resetValues).length) {
          await setCustomFieldsIfAny({
            dataEngine: createTransactionalDataEngine(ctx, trx),
            entityId: INTERACTION_ENTITY_ID,
            recordId: interaction.id,
            organizationId: interaction.organizationId,
            tenantId: interaction.tenantId,
            values: resetValues,
            notify: false,
          })
        }

        return {
          interaction,
          nextInteractionId: projection.nextInteractionId,
        }
      })

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: interaction,
        identifiers: {
          id: interaction.id,
          organizationId: interaction.organizationId,
          tenantId: interaction.tenantId,
        },
        indexer: interactionCrudIndexer,
        events: interactionCrudEvents,
      })
      await emitNextInteractionUpdatedEvent(ctx, {
        entityId: before.interaction.entityId,
        nextInteractionId,
      }, {
        id: interaction.id,
        organizationId: interaction.organizationId,
        tenantId: interaction.tenantId,
      })
    },
  }

// ─── Recompute Next (internal repair) ────────────────────────────────

const recomputeNextSchema = z.object({ entityId: z.string().min(1) })

const recomputeNextCommand: CommandHandler<{ entityId: string }, { entityId: string }> = {
  id: 'customers.interaction.recompute_next',
  async execute(rawInput, ctx) {
    const parsed = recomputeNextSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const projection = await recomputeNextInteraction(em, parsed.entityId)
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: parsed.entityId,
      nextInteractionId: projection.nextInteractionId,
    }, {
      id: parsed.entityId,
      organizationId: entity.organizationId,
      tenantId: entity.tenantId,
    })
    return { entityId: parsed.entityId }
  },
}

registerCommand(createInteractionCommand)
registerCommand(updateInteractionCommand)
registerCommand(completeInteractionCommand)
registerCommand(cancelInteractionCommand)
registerCommand(deleteInteractionCommand)
registerCommand(recomputeNextCommand)
