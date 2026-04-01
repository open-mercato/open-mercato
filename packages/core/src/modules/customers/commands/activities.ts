import { commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandLogMetadata } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import {
  activityCreateSchema,
  activityUpdateSchema,
  type ActivityCreateInput,
  type ActivityUpdateInput,
  type InteractionCreateInput,
  type InteractionUpdateInput,
} from '../data/validators'
import { extractUndoPayload, resolveParentResourceKind } from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE } from '../lib/interactionCompatibility'

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

function getRequiredHandler<TInput, TResult>(id: string): CommandHandler<TInput, TResult> {
  const handler = commandRegistry.get(id) as CommandHandler<TInput, TResult> | null
  if (!handler) {
    throw new Error(`Missing command handler: ${id}`)
  }
  return handler
}

function mapActivityCreateInput(
  input: ActivityCreateInput,
  custom: Record<string, unknown>,
): InteractionCreateInput & { customValues?: Record<string, unknown> } {
  return {
    entityId: input.entityId,
    interactionType: input.activityType,
    title: input.subject ?? null,
    body: input.body ?? null,
    occurredAt: input.occurredAt ?? null,
    status: input.occurredAt ? 'done' : 'planned',
    dealId: input.dealId ?? null,
    authorUserId: input.authorUserId ?? null,
    appearanceIcon: input.appearanceIcon ?? null,
    appearanceColor: input.appearanceColor ?? null,
    source: CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE,
    ...(Object.keys(custom).length > 0 ? { customValues: custom } : {}),
  }
}

function mapActivityUpdateInput(
  input: ActivityUpdateInput,
  custom: Record<string, unknown>,
): InteractionUpdateInput & { customValues?: Record<string, unknown> } {
  return {
    id: input.id,
    ...(input.activityType !== undefined ? { interactionType: input.activityType } : {}),
    ...(input.subject !== undefined ? { title: input.subject ?? null } : {}),
    ...(input.body !== undefined ? { body: input.body ?? null } : {}),
    ...(input.occurredAt !== undefined
      ? {
          occurredAt: input.occurredAt ?? null,
          status: input.occurredAt ? 'done' : 'planned',
        }
      : {}),
    ...(input.dealId !== undefined ? { dealId: input.dealId ?? null } : {}),
    ...(input.authorUserId !== undefined ? { authorUserId: input.authorUserId ?? null } : {}),
    ...(input.appearanceIcon !== undefined ? { appearanceIcon: input.appearanceIcon ?? null } : {}),
    ...(input.appearanceColor !== undefined ? { appearanceColor: input.appearanceColor ?? null } : {}),
    ...(Object.keys(custom).length > 0 ? { customValues: custom } : {}),
  }
}

function normalizeUndoCreateLogEntry(
  logEntry: unknown,
  payload: InteractionUndoPayload | null | undefined,
): CommandLogMetadata | Record<string, unknown> {
  const base = logEntry && typeof logEntry === 'object' ? { ...(logEntry as Record<string, unknown>) } : {}
  const resourceId =
    typeof base.resourceId === 'string' && base.resourceId.trim().length > 0
      ? base.resourceId
      : payload?.after?.interaction.id ?? null
  return resourceId ? { ...base, resourceId } : base
}

/** @deprecated Use interaction commands instead. Maintained as a compatibility bridge per SPEC-046b. */
const createActivityCommand: CommandHandler<ActivityCreateInput, { activityId: string }> = {
  id: 'customers.activities.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(activityCreateSchema, rawInput)
    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    const result = await canonicalCreate.execute(mapActivityCreateInput(parsed, custom), ctx)
    return { activityId: result.interactionId }
  },
  captureAfter: async (_input, result, ctx) => {
    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    if (!canonicalCreate.captureAfter) return null
    return canonicalCreate.captureAfter(
      {
        entityId: '00000000-0000-0000-0000-000000000000',
        interactionType: 'compatibility',
        status: 'planned',
      },
      { interactionId: result.activityId },
      ctx,
    )
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.activities.create', 'Create activity'),
      resourceKind: 'customers.activity',
      resourceId: result.activityId,
      parentResourceKind: resolveParentResourceKind(snapshot?.interaction.entityKind),
      parentResourceId: snapshot?.interaction.entityId ?? null,
      tenantId: snapshot?.interaction.tenantId ?? null,
      organizationId: snapshot?.interaction.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    if (!canonicalCreate.undo) return
    await canonicalCreate.undo({
      input: {
        entityId: payload?.after?.interaction.entityId ?? '00000000-0000-0000-0000-000000000000',
        interactionType: payload?.after?.interaction.interactionType ?? 'compatibility',
        status: 'planned',
      },
      ctx,
      logEntry: normalizeUndoCreateLogEntry(logEntry, payload),
    })
  },
}

/** @deprecated Use interaction commands instead. Maintained as a compatibility bridge per SPEC-046b. */
const updateActivityCommand: CommandHandler<ActivityUpdateInput, { activityId: string }> = {
  id: 'customers.activities.update',
  async prepare(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(activityUpdateSchema, rawInput)
    const canonicalUpdate = getRequiredHandler<
      InteractionUpdateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.update')
    return canonicalUpdate.prepare?.(mapActivityUpdateInput(parsed, custom), ctx) ?? {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(activityUpdateSchema, rawInput)
    const canonicalUpdate = getRequiredHandler<
      InteractionUpdateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.update')
    const result = await canonicalUpdate.execute(mapActivityUpdateInput(parsed, custom), ctx)
    return { activityId: result.interactionId }
  },
  captureAfter: async (_input, result, ctx) => {
    const canonicalUpdate = getRequiredHandler<
      InteractionUpdateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.update')
    if (!canonicalUpdate.captureAfter) return null
    return canonicalUpdate.captureAfter(
      { id: result.activityId },
      { interactionId: result.activityId },
      ctx,
    )
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as InteractionSnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.activities.update', 'Update activity'),
      resourceKind: 'customers.activity',
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
    const canonicalUpdate = getRequiredHandler<
      InteractionUpdateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.update')
    if (!canonicalUpdate.undo) return
    await canonicalUpdate.undo({
      input: { id: '' },
      ctx,
      logEntry,
    })
  },
}

/** @deprecated Use interaction commands instead. Maintained as a compatibility bridge per SPEC-046b. */
const deleteActivityCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { activityId: string }> =
  {
    id: 'customers.activities.delete',
    async prepare(input, ctx) {
      const canonicalDelete = getRequiredHandler<
        { body?: Record<string, unknown>; query?: Record<string, unknown> },
        { interactionId: string }
      >('customers.interactions.delete')
      return canonicalDelete.prepare?.(input, ctx) ?? {}
    },
    async execute(input, ctx) {
      const canonicalDelete = getRequiredHandler<
        { body?: Record<string, unknown>; query?: Record<string, unknown> },
        { interactionId: string }
      >('customers.interactions.delete')
      const result = await canonicalDelete.execute(input, ctx)
      return { activityId: result.interactionId }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as InteractionSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.activities.delete', 'Delete activity'),
        resourceKind: 'customers.activity',
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
      const canonicalDelete = getRequiredHandler<
        { body?: Record<string, unknown>; query?: Record<string, unknown> },
        { interactionId: string }
      >('customers.interactions.delete')
      if (!canonicalDelete.undo) return
      await canonicalDelete.undo({
        input: {},
        ctx,
        logEntry,
      })
    },
  }

registerCommand(createActivityCommand)
registerCommand(updateActivityCommand)
registerCommand(deleteActivityCommand)
