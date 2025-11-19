import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  optionSchemaTemplateCreateSchema,
  optionSchemaTemplateUpdateSchema,
  type OptionSchemaTemplateCreateInput,
  type OptionSchemaTemplateUpdateInput,
} from '../data/validators'
import { CatalogOptionSchemaTemplate, CatalogProduct } from '../data/entities'
import type { CatalogProductOptionSchema } from '../data/types'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'

type OptionSchemaSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  description: string | null
  schema: CatalogProductOptionSchema
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type OptionSchemaUndoPayload = {
  before?: OptionSchemaSnapshot | null
  after?: OptionSchemaSnapshot | null
}

async function loadOptionSchemaSnapshot(
  em: EntityManager,
  id: string,
): Promise<OptionSchemaSnapshot | null> {
  const record = await em.findOne(CatalogOptionSchemaTemplate, { id, deletedAt: null })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    description: record.description ?? null,
    schema: cloneJson(record.schema),
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function applyOptionSchemaSnapshot(
  record: CatalogOptionSchemaTemplate,
  snapshot: OptionSchemaSnapshot,
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.description = snapshot.description ?? null
  record.schema = cloneJson(snapshot.schema)
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

const createOptionSchemaCommand: CommandHandler<
  OptionSchemaTemplateCreateInput,
  { schemaId: string }
> = {
  id: 'catalog.optionSchemas.create',
  async execute(input, ctx) {
    const parsed = optionSchemaTemplateCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(CatalogOptionSchemaTemplate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      description: parsed.description ?? null,
      schema: cloneJson(parsed.schema) as CatalogProductOptionSchema,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { schemaId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadOptionSchemaSnapshot(em, result.schemaId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadOptionSchemaSnapshot(em, result.schemaId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.optionSchemas.create', 'Create option schema'),
      resourceKind: 'catalog.optionSchema',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies OptionSchemaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionSchemaUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogOptionSchemaTemplate, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
  },
}

const updateOptionSchemaCommand: CommandHandler<
  OptionSchemaTemplateUpdateInput,
  { schemaId: string }
> = {
  id: 'catalog.optionSchemas.update',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOptionSchemaSnapshot(em, input.id as string)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = optionSchemaTemplateUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogOptionSchemaTemplate, {
      id: parsed.id,
      deletedAt: null,
    })
    if (!record) throw new CrudHttpError(404, { error: 'Option schema not found' })
    const organizationId = parsed.organizationId ?? record.organizationId
    const tenantId = parsed.tenantId ?? record.tenantId
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)
    ensureSameScope(record, organizationId, tenantId)
    record.organizationId = organizationId
    record.tenantId = tenantId
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.schema !== undefined) {
      record.schema = cloneJson(parsed.schema) as CatalogProductOptionSchema
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await em.flush()
    return { schemaId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadOptionSchemaSnapshot(em, result.schemaId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const before = snapshots.before as OptionSchemaSnapshot | undefined
    const after = await loadOptionSchemaSnapshot(em, result.schemaId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.optionSchemas.update', 'Update option schema'),
      resourceKind: 'catalog.optionSchema',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies OptionSchemaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionSchemaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogOptionSchemaTemplate, { id: before.id })
    if (!record) {
      record = em.create(CatalogOptionSchemaTemplate, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        description: before.description ?? null,
        schema: cloneJson(before.schema),
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSchemaSnapshot(record, before)
    await em.flush()
  },
}

const deleteOptionSchemaCommand: CommandHandler<{ id: string }, { schemaId: string }> = {
  id: 'catalog.optionSchemas.delete',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadOptionSchemaSnapshot(em, input.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogOptionSchemaTemplate, { id: input.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Option schema not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const assigned = await em.count(CatalogProduct, { optionSchemaTemplate: record, deletedAt: null })
    if (assigned > 0) {
      throw new CrudHttpError(400, { error: 'Detach products from this schema before deleting it.' })
    }
    record.deletedAt = new Date()
    await em.flush()
    return { schemaId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OptionSchemaSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.optionSchemas.delete', 'Delete option schema'),
      resourceKind: 'catalog.optionSchema',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies OptionSchemaUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionSchemaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogOptionSchemaTemplate, { id: before.id })
    if (!record) {
      record = em.create(CatalogOptionSchemaTemplate, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        description: before.description ?? null,
        schema: cloneJson(before.schema),
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSchemaSnapshot(record, before)
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createOptionSchemaCommand)
registerCommand(updateOptionSchemaCommand)
registerCommand(deleteOptionSchemaCommand)
