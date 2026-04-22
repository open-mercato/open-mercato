import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import {
  CustomerEntity,
  CustomerLabel,
  CustomerLabelAssignment,
} from '../data/entities'
import {
  labelAssignCommandSchema,
  labelCreateCommandSchema,
  labelUnassignCommandSchema,
  type LabelAssignCommandInput,
  type LabelCreateCommandInput,
  type LabelUnassignCommandInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  resolveParentResourceKind,
} from './shared'

type LabelAssignmentSnapshot = {
  id: string
  labelId: string
  entityId: string
  userId: string
  tenantId: string
  organizationId: string
  createdAt: string
  entityKind: 'person' | 'company' | null
}

type LabelAssignmentUndoPayload = {
  before?: LabelAssignmentSnapshot | null
  after?: LabelAssignmentSnapshot | null
}

type LabelSnapshot = {
  id: string
  slug: string
  label: string
  userId: string
  tenantId: string
  organizationId: string
  createdAt: string
}

type LabelUndoPayload = {
  before?: LabelSnapshot | null
  after?: LabelSnapshot | null
}

const labelAssignmentCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'label_assignment',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

const labelCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'label',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function getLabelIdentifiers(label: CustomerLabel) {
  return {
    id: label.id,
    organizationId: label.organizationId,
    tenantId: label.tenantId,
  }
}

function toLabelSnapshot(label: CustomerLabel): LabelSnapshot {
  return {
    id: label.id,
    slug: label.slug,
    label: label.label,
    userId: label.userId,
    tenantId: label.tenantId,
    organizationId: label.organizationId,
    createdAt: label.createdAt.toISOString(),
  }
}

function resolveActorUserId(ctx: { auth: { sub?: string | null; userId?: string | null; keyId?: string | null; isApiKey?: boolean } | null }): string | null {
  const auth = ctx.auth
  if (!auth) return null
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return null
}

async function resolveEntityKind(
  em: EntityManager,
  entityId: string,
  tenantId: string,
  organizationId: string,
): Promise<'person' | 'company' | null> {
  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: entityId, tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!entity) return null
  return entity.kind === 'person' || entity.kind === 'company' ? entity.kind : null
}

function getAssignmentIdentifiers(assignment: CustomerLabelAssignment) {
  return {
    id: assignment.id,
    organizationId: assignment.organizationId,
    tenantId: assignment.tenantId,
  }
}

const createLabelCommand: CommandHandler<LabelCreateCommandInput, { labelId: string; slug: string; label: string }> = {
  id: 'customers.labels.create',
  async execute(rawInput, ctx) {
    const parsed = labelCreateCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const duplicate = await findOneWithDecryption(
      em,
      CustomerLabel,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        userId: parsed.userId,
        slug: parsed.slug,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (duplicate) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate('customers.errors.label_duplicate', 'A label with this slug already exists'),
      })
    }

    const label = em.create(CustomerLabel, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      slug: parsed.slug,
      label: parsed.label.trim(),
    })
    em.persist(label)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: label,
      identifiers: getLabelIdentifiers(label),
      syncOrigin: ctx.syncOrigin,
      events: labelCrudEvents,
      indexer: { entityType: 'customers:customer_label' },
    })

    return { labelId: label.id, slug: label.slug, label: label.label }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      { id: result.labelId },
      undefined,
      {
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      },
    )
    return label ? toLabelSnapshot(label) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = snapshots.after as LabelSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.labels.create', 'Create label'),
      resourceKind: 'customers.label',
      resourceId: result.labelId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: { after: after ?? null } satisfies LabelUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LabelUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!label) return

    em.remove(label)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: label,
      identifiers: getLabelIdentifiers(label),
      syncOrigin: ctx.syncOrigin,
      events: labelCrudEvents,
      indexer: { entityType: 'customers:customer_label' },
    })
  },
}

const assignLabelCommand: CommandHandler<LabelAssignCommandInput, { assignmentId: string; created: boolean; entityKind: 'person' | 'company' | null }> = {
  id: 'customers.labels.assign',
  async execute(rawInput, ctx) {
    const parsed = labelAssignCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      {
        id: parsed.labelId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        userId: actorUserId,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!label) {
      throw new CrudHttpError(404, { error: 'Label not found' })
    }

    const entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: parsed.entityId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!entity) {
      throw new CrudHttpError(404, { error: 'Entity not found' })
    }

    const existing = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        userId: actorUserId,
        label,
        entity,
      } as FilterQuery<CustomerLabelAssignment>,
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (existing) {
      return {
        assignmentId: existing.id,
        created: false,
        entityKind: entity.kind === 'person' || entity.kind === 'company' ? entity.kind : null,
      }
    }

    const assignment = em.create(CustomerLabelAssignment, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      userId: actorUserId,
      label,
      entity,
    })
    em.persist(assignment)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: assignment,
      identifiers: getAssignmentIdentifiers(assignment),
      syncOrigin: ctx.syncOrigin,
      events: labelAssignmentCrudEvents,
      indexer: { entityType: 'customers:customer_label_assignment' },
    })

    return {
      assignmentId: assignment.id,
      created: true,
      entityKind: entity.kind === 'person' || entity.kind === 'company' ? entity.kind : null,
    }
  },
  captureAfter: async (_input, result, ctx) => {
    if (!result.created) return null
    const em = ctx.container.resolve('em') as EntityManager
    const assignment = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      { id: result.assignmentId },
      { populate: ['label', 'entity'] },
      {
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      },
    )
    if (!assignment) return null
    const labelId = typeof assignment.label === 'string' ? assignment.label : assignment.label.id
    const entityId = typeof assignment.entity === 'string' ? assignment.entity : assignment.entity.id
    return {
      id: assignment.id,
      labelId,
      entityId,
      userId: assignment.userId,
      tenantId: assignment.tenantId,
      organizationId: assignment.organizationId,
      createdAt: assignment.createdAt.toISOString(),
      entityKind: result.entityKind,
    } satisfies LabelAssignmentSnapshot
  },
  buildLog: async ({ result, snapshots }) => {
    if (!result.created) {
      return { skipLog: true }
    }
    const { translate } = await resolveTranslations()
    const after = snapshots.after as LabelAssignmentSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.labels.assign', 'Assign label'),
      resourceKind: 'customers.labelAssignment',
      resourceId: result.assignmentId,
      parentResourceKind: resolveParentResourceKind(after?.entityKind),
      parentResourceId: after?.entityId ?? null,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          after: after ?? null,
        } satisfies LabelAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LabelAssignmentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const assignment = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      { id: after.id },
      undefined,
      { tenantId: after.tenantId, organizationId: after.organizationId },
    )
    if (!assignment) return

    em.remove(assignment)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: assignment,
      identifiers: getAssignmentIdentifiers(assignment),
      syncOrigin: ctx.syncOrigin,
      events: labelAssignmentCrudEvents,
      indexer: { entityType: 'customers:customer_label_assignment' },
    })
  },
}

const unassignLabelCommand: CommandHandler<LabelUnassignCommandInput, { assignmentId: string | null; entityKind: 'person' | 'company' | null }> = {
  id: 'customers.labels.unassign',
  async prepare(rawInput, ctx) {
    const parsed = labelUnassignCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) return {}

    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      { id: parsed.labelId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, userId: actorUserId },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    const entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: parsed.entityId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!label || !entity) return {}

    const existing = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        userId: actorUserId,
        label,
        entity,
      } as FilterQuery<CustomerLabelAssignment>,
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!existing) return {}

    const entityKind = entity.kind === 'person' || entity.kind === 'company' ? entity.kind : null
    const snapshot: LabelAssignmentSnapshot = {
      id: existing.id,
      labelId: parsed.labelId,
      entityId: parsed.entityId,
      userId: existing.userId,
      tenantId: existing.tenantId,
      organizationId: existing.organizationId,
      createdAt: existing.createdAt.toISOString(),
      entityKind,
    }
    return { before: snapshot }
  },
  async execute(rawInput, ctx) {
    const parsed = labelUnassignCommandSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const actorUserId = resolveActorUserId(ctx)
    if (!actorUserId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      { id: parsed.labelId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, userId: actorUserId },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!label) {
      throw new CrudHttpError(404, { error: 'Label not found' })
    }

    const entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: parsed.entityId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!entity) {
      throw new CrudHttpError(404, { error: 'Entity not found' })
    }

    const existing = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      {
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        userId: actorUserId,
        label,
        entity,
      } as FilterQuery<CustomerLabelAssignment>,
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )

    const entityKind = entity.kind === 'person' || entity.kind === 'company' ? entity.kind : null

    if (!existing) {
      return { assignmentId: null, entityKind }
    }

    const removedId = existing.id
    em.remove(existing)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: existing,
      identifiers: getAssignmentIdentifiers(existing),
      syncOrigin: ctx.syncOrigin,
      events: labelAssignmentCrudEvents,
      indexer: { entityType: 'customers:customer_label_assignment' },
    })

    return { assignmentId: removedId, entityKind }
  },
  buildLog: async ({ result, snapshots }) => {
    if (!result.assignmentId) {
      return { skipLog: true }
    }
    const { translate } = await resolveTranslations()
    const before = snapshots.before as LabelAssignmentSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.labels.unassign', 'Unassign label'),
      resourceKind: 'customers.labelAssignment',
      resourceId: result.assignmentId,
      parentResourceKind: resolveParentResourceKind(before?.entityKind ?? result.entityKind),
      parentResourceId: before?.entityId ?? null,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies LabelAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LabelAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const label = await findOneWithDecryption(
      em,
      CustomerLabel,
      { id: before.labelId, tenantId: before.tenantId, organizationId: before.organizationId },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!label) return

    const entity = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: before.entityId, tenantId: before.tenantId, organizationId: before.organizationId, deletedAt: null },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!entity) return

    const existing = await findOneWithDecryption(
      em,
      CustomerLabelAssignment,
      {
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        userId: before.userId,
        label,
        entity,
      } as FilterQuery<CustomerLabelAssignment>,
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (existing) return

    const restored = em.create(CustomerLabelAssignment, {
      id: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      userId: before.userId,
      label,
      entity,
    })
    em.persist(restored)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: restored,
      identifiers: getAssignmentIdentifiers(restored),
      syncOrigin: ctx.syncOrigin,
      events: labelAssignmentCrudEvents,
      indexer: { entityType: 'customers:customer_label_assignment' },
    })
  },
}

registerCommand(createLabelCommand)
registerCommand(assignLabelCommand)
registerCommand(unassignLabelCommand)
