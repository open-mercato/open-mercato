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
import { CustomerInteraction, CustomerEntity } from '../data/entities'
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
  requireTimelineParentEntity,
  extractUndoPayload,
  emitQueryIndexUpsertEvents,
  requireDealInScope,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceRecordGoneIsConflict, enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CrudIndexerConfig, CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { recomputeNextInteraction } from '../lib/interactionProjection'
import {
  INTERACTION_STATUS_CANCELED,
  INTERACTION_STATUS_COMPLETED,
  INTERACTION_STATUS_PLANNED,
} from '../lib/interactionStatus'
import { canChangeEmailVisibility } from '../lib/visibilityFilter'

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
    entityId:
      ctx.entity && typeof ctx.entity === 'object' && 'entity' in (ctx.entity as Record<string, unknown>)
        ? (() => {
            const entityRef = (ctx.entity as CustomerInteraction).entity
            return typeof entityRef === 'string' ? entityRef : entityRef?.id ?? null
          })()
        : null,
    interactionType:
      ctx.entity && typeof ctx.entity === 'object' && 'interactionType' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerInteraction).interactionType
        : null,
    status:
      ctx.entity && typeof ctx.entity === 'object' && 'status' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerInteraction).status
        : null,
    source:
      ctx.entity && typeof ctx.entity === 'object' && 'source' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerInteraction).source ?? null
        : null,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
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
    durationMinutes: number | null
    location: string | null
    allDay: boolean | null
    recurrenceRule: string | null
    recurrenceEnd: Date | null
    participants: Array<{ userId: string; name?: string; email?: string; status?: string }> | null
    reminderMinutes: number | null
    visibility: string | null
    linkedEntities: Array<{ id: string; type: string; label: string }> | null
    guestPermissions: { canInviteOthers?: boolean; canModify?: boolean; canSeeList?: boolean } | null
  }
  custom?: Record<string, unknown>
}

type InteractionUndoPayload = {
  before?: InteractionSnapshot | null
  after?: InteractionSnapshot | null
}

async function loadInteractionSnapshot(em: EntityManager, id: string): Promise<InteractionSnapshot | null> {
  const interaction = await findOneWithDecryption(em, CustomerInteraction, { id }, { populate: ['entity'] })
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
      durationMinutes: interaction.durationMinutes ?? null,
      location: interaction.location ?? null,
      allDay: interaction.allDay ?? null,
      recurrenceRule: interaction.recurrenceRule ?? null,
      recurrenceEnd: interaction.recurrenceEnd ?? null,
      participants: interaction.participants ?? null,
      reminderMinutes: interaction.reminderMinutes ?? null,
      visibility: interaction.visibility ?? null,
      linkedEntities: interaction.linkedEntities ?? null,
      guestPermissions: interaction.guestPermissions ?? null,
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
  } catch (err) {
    console.warn('[customers.commands.interactions] eventBus resolve failed; skipping emit', eventId, err)
    bus = null
  }
  if (!bus) return
  await bus
    .emitEvent(eventId, payload, { persistent: true })
    .catch((err) => {
      console.warn('[customers.commands.interactions] emit failed', eventId, err)
      return undefined
    })
}

async function emitInteractionRevertedEvent(
  ctx: CommandRuntimeContext,
  interaction: InteractionSnapshot['interaction'],
): Promise<void> {
  await emitLifecycleEvent(ctx, 'customers.interaction.reverted', {
    id: interaction.id,
    organizationId: interaction.organizationId,
    tenantId: interaction.tenantId,
    entityId: interaction.entityId,
    interactionType: interaction.interactionType,
    source: interaction.source ?? null,
    status: interaction.status,
    occurredAt: interaction.occurredAt?.toISOString() ?? null,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
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
  // Mirrors the SPEC-018 fix applied to withAtomicFlush: use explicit begin/commit/rollback
  // so the outer EntityManager stays bound to the transaction, and closures over `em` inside
  // `operation` participate in the same transaction. This avoids the em.transactional(cb)
  // hazard where the callback receives a child EM whose flushes can silently race against
  // subsequent queries on the original `em`.
  const supportsBegin =
    typeof (em as unknown as { begin?: () => Promise<void> }).begin === 'function' &&
    typeof (em as unknown as { commit?: () => Promise<void> }).commit === 'function' &&
    typeof (em as unknown as { rollback?: () => Promise<void> }).rollback === 'function'
  if (!supportsBegin) {
    return operation(em)
  }
  await em.begin()
  try {
    const result = await operation(em)
    await em.commit()
    return result
  } catch (err) {
    try {
      await em.rollback()
    } catch {
      // rollback failure should not mask the original error; intentionally swallowed
    }
    throw err
  }
}

async function emitNextInteractionUpdatedEvent(
  ctx: CommandRuntimeContext,
  projection: InteractionProjectionMutation,
  identifiers: InteractionIdentifiers,
): Promise<void> {
  await emitQueryIndexUpsertEvents(ctx, [{
    entityType: 'customers:customer_entity',
    recordId: projection.entityId,
    organizationId: identifiers.organizationId,
    tenantId: identifiers.tenantId,
  }])
  await emitLifecycleEvent(ctx, 'customers.next_interaction.updated', {
    id: projection.entityId,
    entityId: projection.entityId,
    nextInteractionId: projection.nextInteractionId,
    organizationId: identifiers.organizationId,
    tenantId: identifiers.tenantId,
  })
}

// ─── Create ─────────────────────────────────────────────────────────

type InteractionGraphValues = {
  id?: string
  organizationId: string
  tenantId: string
  entity: CustomerEntity
  interactionType: string
  title: string | null
  body: string | null
  status: string
  scheduledAt: Date | null
  occurredAt: Date | null
  priority: number | null
  authorUserId: string | null
  ownerUserId: string | null
  dealId: string | null
  source: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  durationMinutes: number | null
  location: string | null
  allDay: boolean | null
  recurrenceRule: string | null
  recurrenceEnd: Date | null
  participants: InteractionSnapshot['interaction']['participants']
  reminderMinutes: number | null
  visibility: string | null
  linkedEntities: InteractionSnapshot['interaction']['linkedEntities']
  guestPermissions: InteractionSnapshot['interaction']['guestPermissions']
}

// Single source of truth for the interaction row mapping, shared by `execute`
// (values from validated input) and `redo` (values from the after-snapshot,
// carrying the original id). Keeps create and id-preserving redo from drifting
// field-by-field. Caller owns the surrounding transaction, persist, projection
// recompute, and custom-field handling.
function buildInteractionGraph(em: EntityManager, values: InteractionGraphValues): CustomerInteraction {
  return em.create(CustomerInteraction, {
    ...(values.id ? { id: values.id } : {}),
    organizationId: values.organizationId,
    tenantId: values.tenantId,
    entity: values.entity,
    interactionType: values.interactionType,
    title: values.title,
    body: values.body,
    status: values.status,
    scheduledAt: values.scheduledAt,
    occurredAt: values.occurredAt,
    priority: values.priority,
    authorUserId: values.authorUserId,
    ownerUserId: values.ownerUserId,
    dealId: values.dealId,
    source: values.source,
    appearanceIcon: values.appearanceIcon,
    appearanceColor: values.appearanceColor,
    durationMinutes: values.durationMinutes,
    location: values.location,
    allDay: values.allDay,
    recurrenceRule: values.recurrenceRule,
    recurrenceEnd: values.recurrenceEnd,
    participants: values.participants,
    reminderMinutes: values.reminderMinutes,
    visibility: values.visibility,
    linkedEntities: values.linkedEntities,
    guestPermissions: values.guestPermissions,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

const createInteractionCommand: CommandHandler<InteractionCreateInput, { interactionId: string; entityId: string }> = {
  id: 'customers.interactions.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(interactionCreateSchema, rawInput)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const normalizedAuthor = normalizeAuthorUserId(parsed.authorUserId ?? null, ctx.auth)
    const { interaction, entityId, nextInteractionId } = await runInTransaction(em, async (trx) => {
      const entity = await requireTimelineParentEntity(trx, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId })
      ensureTenantScope(ctx, entity.tenantId)
      ensureOrganizationScope(ctx, entity.organizationId)

      if (parsed.dealId) {
        await requireDealInScope(trx, parsed.dealId, entity.tenantId, entity.organizationId)
      }

      const interaction = buildInteractionGraph(trx, {
        ...(parsed.id ? { id: parsed.id } : {}),
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
        entity,
        interactionType: parsed.interactionType,
        title: parsed.title ?? null,
        body: parsed.body ?? null,
        status: parsed.status ?? INTERACTION_STATUS_PLANNED,
        scheduledAt: parsed.scheduledAt ?? null,
        occurredAt: parsed.occurredAt ?? null,
        priority: parsed.priority ?? null,
        authorUserId: normalizedAuthor,
        ownerUserId: parsed.ownerUserId ?? null,
        dealId: parsed.dealId ?? null,
        source: parsed.source ?? null,
        appearanceIcon: parsed.appearanceIcon ?? null,
        appearanceColor: parsed.appearanceColor ?? null,
        durationMinutes: parsed.durationMinutes ?? null,
        location: parsed.location ?? null,
        allDay: parsed.allDay ?? null,
        recurrenceRule: parsed.recurrenceRule ?? null,
        recurrenceEnd: parsed.recurrenceEnd ?? null,
        participants: parsed.participants ?? null,
        reminderMinutes: parsed.reminderMinutes ?? null,
        visibility: parsed.visibility ?? null,
        linkedEntities: parsed.linkedEntities ?? null,
        guestPermissions: parsed.guestPermissions ?? null,
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

      const projection = await recomputeNextInteraction(trx, entity.id)

      return {
        interaction,
        entityId: entity.id,
        nextInteractionId: projection.nextInteractionId,
      }
    })

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
      syncOrigin: ctx.syncOrigin,
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
      const record = await findOneWithDecryption(trx, CustomerInteraction, { id: interactionId })
      if (!record) return null
      const entityId = typeof record.entity === 'string' ? record.entity : record.entity.id
      trx.remove(record)
      await trx.flush()
      const projection = await recomputeNextInteraction(trx, entityId)
      return {
        entityId,
        nextInteractionId: projection.nextInteractionId,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }
    })
    if (!result) return
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: result.entityId,
      nextInteractionId: result.nextInteractionId,
    }, result.identifiers)
  },
  redo: async ({ logEntry, ctx }) => {
    const after = resolveRedoSnapshot<InteractionSnapshot>(logEntry)
    if (!after) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for interaction create' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, nextInteractionId } = await runInTransaction(em, async (trx) => {
      const entity = await requireTimelineParentEntity(trx, after.interaction.entityId, { tenantId: after.interaction.tenantId, organizationId: after.interaction.organizationId })
      let interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: after.interaction.id })
      if (!interaction) {
        interaction = buildInteractionGraph(trx, {
          id: after.interaction.id,
          organizationId: after.interaction.organizationId,
          tenantId: after.interaction.tenantId,
          entity,
          interactionType: after.interaction.interactionType,
          title: after.interaction.title,
          body: after.interaction.body,
          status: after.interaction.status,
          scheduledAt: after.interaction.scheduledAt,
          occurredAt: after.interaction.occurredAt,
          priority: after.interaction.priority,
          authorUserId: after.interaction.authorUserId,
          ownerUserId: after.interaction.ownerUserId,
          dealId: after.interaction.dealId,
          source: after.interaction.source,
          appearanceIcon: after.interaction.appearanceIcon,
          appearanceColor: after.interaction.appearanceColor,
          durationMinutes: after.interaction.durationMinutes,
          location: after.interaction.location,
          allDay: after.interaction.allDay,
          recurrenceRule: after.interaction.recurrenceRule,
          recurrenceEnd: after.interaction.recurrenceEnd,
          participants: after.interaction.participants,
          reminderMinutes: after.interaction.reminderMinutes,
          visibility: after.interaction.visibility,
          linkedEntities: after.interaction.linkedEntities,
          guestPermissions: after.interaction.guestPermissions,
        })
        trx.persist(interaction)
      } else {
        interaction.deletedAt = null
        interaction.entity = entity
        interaction.interactionType = after.interaction.interactionType
        interaction.title = after.interaction.title
        interaction.body = after.interaction.body
        interaction.status = after.interaction.status
        interaction.scheduledAt = after.interaction.scheduledAt
        interaction.occurredAt = after.interaction.occurredAt
        interaction.priority = after.interaction.priority
        interaction.authorUserId = after.interaction.authorUserId
        interaction.ownerUserId = after.interaction.ownerUserId
        interaction.dealId = after.interaction.dealId
        interaction.source = after.interaction.source
        interaction.appearanceIcon = after.interaction.appearanceIcon
        interaction.appearanceColor = after.interaction.appearanceColor
        interaction.durationMinutes = after.interaction.durationMinutes
        interaction.location = after.interaction.location
        interaction.allDay = after.interaction.allDay
        interaction.recurrenceRule = after.interaction.recurrenceRule
        interaction.recurrenceEnd = after.interaction.recurrenceEnd
        interaction.participants = after.interaction.participants
        interaction.reminderMinutes = after.interaction.reminderMinutes
        interaction.visibility = after.interaction.visibility
        interaction.linkedEntities = after.interaction.linkedEntities
        interaction.guestPermissions = after.interaction.guestPermissions
      }
      await trx.flush()

      const projection = await recomputeNextInteraction(trx, after.interaction.entityId)

      const restoreValues = buildCustomFieldResetMap(after.custom, undefined)
      if (Object.keys(restoreValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: createTransactionalDataEngine(ctx, trx),
          entityId: INTERACTION_ENTITY_ID,
          recordId: interaction.id,
          organizationId: interaction.organizationId,
          tenantId: interaction.tenantId,
          values: restoreValues,
          notify: false,
        })
      }

      return { interaction, nextInteractionId: projection.nextInteractionId }
    })

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
      syncOrigin: ctx.syncOrigin,
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitNextInteractionUpdatedEvent(ctx, {
      entityId: after.interaction.entityId,
      nextInteractionId,
    }, {
      id: interaction.id,
      organizationId: interaction.organizationId,
      tenantId: interaction.tenantId,
    })

    return { interactionId: interaction.id, entityId: after.interaction.entityId }
  },
}

// ─── Update ─────────────────────────────────────────────────────────

const updateInteractionCommand: CommandHandler<InteractionUpdateInput, { interactionId: string }> = {
  id: 'customers.interactions.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(interactionUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(interactionUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId, nextInteractionId } = await runInTransaction(em, async (trx) => {
      const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) {
        enforceRecordGoneIsConflict({ resourceKind: 'customers.interaction', resourceId: parsed.id, request: ctx.request ?? null })
        throw new CrudHttpError(404, { error: 'Interaction not found' })
      }
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      // Concurrent-edit guard for command-driven callers (e.g. the legacy
      // /api/customers/todos route, which bypasses the makeCrudRoute lock guard):
      // when the client opted into optimistic locking, a stale edit fails with the
      // unified 409 instead of silently overwriting (#2055). Strictly additive —
      // no-op when no expected-version header is present.
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'customers.interaction',
        resourceId: interaction.id,
        current: interaction.updatedAt,
        request: ctx.request ?? null,
      })

      // Email visibility is an access-controlled field: only the interaction's
      // author may change a
      // private email's visibility (mirrors the dedicated PATCH .../visibility
      // route). Enforce it here — the single persistence path — so the generic
      // update route (PUT /api/interactions) cannot bypass the gate. Evaluated
      // against the row's pre-mutation author/type. 404 (not 403) keeps the
      // existence-masking consistent with the dedicated route.
      if (
        parsed.visibility !== undefined &&
        interaction.interactionType === 'email' &&
        (parsed.visibility ?? null) !== (interaction.visibility ?? null)
      ) {
        const actorUserId = (ctx.auth as { sub?: string | null } | null)?.sub ?? null
        if (
          !canChangeEmailVisibility({
            interactionType: interaction.interactionType,
            currentVisibility: interaction.visibility,
            nextVisibility: parsed.visibility,
            authorUserId: interaction.authorUserId,
            actorUserId,
            // v1 strict owner-only: only the author may flip visibility; no admin
            // bypass (canChangeEmailVisibility ignores caller features in v1).
            userFeatures: undefined,
          })
        ) {
          throw new CrudHttpError(404, { error: 'Email not found' })
        }
      }

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
      if (parsed.pinned !== undefined) interaction.pinned = parsed.pinned
      if (parsed.durationMinutes !== undefined) interaction.durationMinutes = parsed.durationMinutes ?? null
      if (parsed.location !== undefined) interaction.location = parsed.location ?? null
      if (parsed.allDay !== undefined) interaction.allDay = parsed.allDay ?? null
      if (parsed.recurrenceRule !== undefined) interaction.recurrenceRule = parsed.recurrenceRule ?? null
      if (parsed.recurrenceEnd !== undefined) interaction.recurrenceEnd = parsed.recurrenceEnd ?? null
      if (parsed.participants !== undefined) interaction.participants = parsed.participants ?? null
      if (parsed.reminderMinutes !== undefined) interaction.reminderMinutes = parsed.reminderMinutes ?? null
      if (parsed.visibility !== undefined) interaction.visibility = parsed.visibility ?? null
      if (parsed.linkedEntities !== undefined) interaction.linkedEntities = parsed.linkedEntities ?? null
      if (parsed.guestPermissions !== undefined) interaction.guestPermissions = parsed.guestPermissions ?? null

      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      await setInteractionCustomFields(
        createTransactionalDataEngine(ctx, trx),
        interaction.id,
        interaction.organizationId,
        interaction.tenantId,
        custom,
      )

      const projection = await recomputeNextInteraction(trx, entityId)

      return { interaction, entityId, nextInteractionId: projection.nextInteractionId }
    })

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
      syncOrigin: ctx.syncOrigin,
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
      let interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: before.interaction.id })
      const entity = await requireTimelineParentEntity(trx, before.interaction.entityId, { tenantId: before.interaction.tenantId, organizationId: before.interaction.organizationId })

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
          durationMinutes: before.interaction.durationMinutes,
          location: before.interaction.location,
          allDay: before.interaction.allDay,
          recurrenceRule: before.interaction.recurrenceRule,
          recurrenceEnd: before.interaction.recurrenceEnd,
          participants: before.interaction.participants,
          reminderMinutes: before.interaction.reminderMinutes,
          visibility: before.interaction.visibility,
          linkedEntities: before.interaction.linkedEntities,
          guestPermissions: before.interaction.guestPermissions,
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
        interaction.durationMinutes = before.interaction.durationMinutes
        interaction.location = before.interaction.location
        interaction.allDay = before.interaction.allDay
        interaction.recurrenceRule = before.interaction.recurrenceRule
        interaction.recurrenceEnd = before.interaction.recurrenceEnd
        interaction.participants = before.interaction.participants
        interaction.reminderMinutes = before.interaction.reminderMinutes
        interaction.visibility = before.interaction.visibility
        interaction.linkedEntities = before.interaction.linkedEntities
        interaction.guestPermissions = before.interaction.guestPermissions
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
      syncOrigin: ctx.syncOrigin,
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = interactionCompleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId, nextInteractionId } = await runInTransaction(em, async (trx) => {
      const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) {
        enforceRecordGoneIsConflict({ resourceKind: 'customers.interaction', resourceId: parsed.id, request: ctx.request ?? null })
        throw new CrudHttpError(404, { error: 'Interaction not found' })
      }
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'customers.interaction',
        resourceId: interaction.id,
        current: interaction.updatedAt,
        request: ctx.request ?? null,
      })

      interaction.status = INTERACTION_STATUS_COMPLETED
      interaction.occurredAt = parsed.occurredAt ?? new Date()
      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      const projection = await recomputeNextInteraction(trx, entityId)
      return { interaction, entityId, nextInteractionId: projection.nextInteractionId }
    })

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
      syncOrigin: ctx.syncOrigin,
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitLifecycleEvent(ctx, 'customers.interaction.completed', {
      ...identifiers,
      entityId,
      interactionType: interaction.interactionType,
      status: interaction.status,
      source: interaction.source ?? null,
      occurredAt: interaction.occurredAt?.toISOString() ?? null,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    })
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
      const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: before.interaction.id })
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
      syncOrigin: ctx.syncOrigin,
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadInteractionSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = interactionCancelSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { interaction, entityId, nextInteractionId } = await runInTransaction(em, async (trx) => {
      const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: parsed.id, deletedAt: null })
      if (!interaction) {
        enforceRecordGoneIsConflict({ resourceKind: 'customers.interaction', resourceId: parsed.id, request: ctx.request ?? null })
        throw new CrudHttpError(404, { error: 'Interaction not found' })
      }
      ensureTenantScope(ctx, interaction.tenantId)
      ensureOrganizationScope(ctx, interaction.organizationId)

      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: 'customers.interaction',
        resourceId: interaction.id,
        current: interaction.updatedAt,
        request: ctx.request ?? null,
      })

      interaction.status = INTERACTION_STATUS_CANCELED
      await trx.flush()

      const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
      const projection = await recomputeNextInteraction(trx, entityId)
      return { interaction, entityId, nextInteractionId: projection.nextInteractionId }
    })

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
      syncOrigin: ctx.syncOrigin,
      indexer: interactionCrudIndexer,
      events: interactionCrudEvents,
    })
    await emitLifecycleEvent(ctx, 'customers.interaction.canceled', {
      ...identifiers,
      entityId,
      interactionType: interaction.interactionType,
      status: interaction.status,
      source: interaction.source ?? null,
      ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
    })
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
      const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: before.interaction.id })
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
      syncOrigin: ctx.syncOrigin,
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
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const snapshot = await loadInteractionSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Interaction id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const { interaction, entityId, nextInteractionId } = await runInTransaction(em, async (trx) => {
        const interaction = await findOneWithDecryption(trx, CustomerInteraction, { id, deletedAt: null })
        if (!interaction) {
          enforceRecordGoneIsConflict({ resourceKind: 'customers.interaction', resourceId: id, request: ctx.request ?? null })
          throw new CrudHttpError(404, { error: 'Interaction not found' })
        }
        ensureTenantScope(ctx, interaction.tenantId)
        ensureOrganizationScope(ctx, interaction.organizationId)

        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: 'customers.interaction',
          resourceId: interaction.id,
          current: interaction.updatedAt,
          request: ctx.request ?? null,
        })

        const entityId = typeof interaction.entity === 'string' ? interaction.entity : interaction.entity.id
        interaction.deletedAt = new Date()
        await trx.flush()

        const projection = await recomputeNextInteraction(trx, entityId)
        return { interaction, entityId, nextInteractionId: projection.nextInteractionId }
      })

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
        syncOrigin: ctx.syncOrigin,
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
        const entity = await requireTimelineParentEntity(trx, before.interaction.entityId, { tenantId: before.interaction.tenantId, organizationId: before.interaction.organizationId })
        let interaction = await findOneWithDecryption(trx, CustomerInteraction, { id: before.interaction.id })
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
            durationMinutes: before.interaction.durationMinutes,
            location: before.interaction.location,
            allDay: before.interaction.allDay,
            recurrenceRule: before.interaction.recurrenceRule,
            recurrenceEnd: before.interaction.recurrenceEnd,
            participants: before.interaction.participants,
            reminderMinutes: before.interaction.reminderMinutes,
            visibility: before.interaction.visibility,
            linkedEntities: before.interaction.linkedEntities,
            guestPermissions: before.interaction.guestPermissions,
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
          interaction.durationMinutes = before.interaction.durationMinutes
          interaction.location = before.interaction.location
          interaction.allDay = before.interaction.allDay
          interaction.recurrenceRule = before.interaction.recurrenceRule
          interaction.recurrenceEnd = before.interaction.recurrenceEnd
          interaction.participants = before.interaction.participants
          interaction.reminderMinutes = before.interaction.reminderMinutes
          interaction.visibility = before.interaction.visibility
          interaction.linkedEntities = before.interaction.linkedEntities
          interaction.guestPermissions = before.interaction.guestPermissions
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
        syncOrigin: ctx.syncOrigin,
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
    const entity = await requireTimelineParentEntity(em, parsed.entityId, {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? '',
    })
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
