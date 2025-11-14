import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  attributeSchemaTemplateCreateSchema,
  attributeSchemaTemplateUpdateSchema,
  type AttributeSchemaTemplateCreateInput,
  type AttributeSchemaTemplateUpdateInput,
} from '../data/validators'
import { CatalogAttributeSchemaTemplate, CatalogProduct } from '../data/entities'
import type { CatalogAttributeSchema } from '../data/types'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
} from './shared'

type AttributeSchemaSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  code: string
  description: string | null
  schema: CatalogAttributeSchema
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type AttributeSchemaUndoPayload = {
  before?: AttributeSchemaSnapshot | null
  after?: AttributeSchemaSnapshot | null
}

async function loadSchemaSnapshot(
  em: EntityManager,
  id: string
): Promise<AttributeSchemaSnapshot | null> {
  const record = await em.findOne(CatalogAttributeSchemaTemplate, { id, deletedAt: null })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code,
    description: record.description ?? null,
    schema: cloneJson(record.schema),
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

function applySchemaSnapshot(
  record: CatalogAttributeSchemaTemplate,
  snapshot: AttributeSchemaSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.name = snapshot.name
  record.code = snapshot.code
  record.description = snapshot.description ?? null
  record.schema = cloneJson(snapshot.schema)
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

const createAttributeSchemaCommand: CommandHandler<
  AttributeSchemaTemplateCreateInput,
  { schemaId: string }
> = {
  id: 'catalog.attributeSchemas.create',
  async execute(input, ctx) {
    const parsed = attributeSchemaTemplateCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(CatalogAttributeSchemaTemplate, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      code: parsed.code,
      description: parsed.description ?? null,
      schema: cloneJson(parsed.schema),
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
    return loadSchemaSnapshot(em, result.schemaId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const after = await loadSchemaSnapshot(em, result.schemaId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate(
        'catalog.audit.attributeSchemas.create',
        'Create catalog attribute schema'
      ),
      resourceKind: 'catalog.attributeSchema',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies AttributeSchemaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttributeSchemaUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogAttributeSchemaTemplate, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
  },
}

const updateAttributeSchemaCommand: CommandHandler<
  AttributeSchemaTemplateUpdateInput,
  { schemaId: string }
> = {
  id: 'catalog.attributeSchemas.update',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSchemaSnapshot(em, input.id as string)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = attributeSchemaTemplateUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogAttributeSchemaTemplate, {
      id: parsed.id,
      deletedAt: null,
    })
    if (!record) throw new CrudHttpError(404, { error: 'Attribute schema not found' })
    const organizationId = parsed.organizationId ?? record.organizationId
    const tenantId = parsed.tenantId ?? record.tenantId
    ensureTenantScope(ctx, tenantId)
    ensureOrganizationScope(ctx, organizationId)
    ensureSameScope(record, organizationId, tenantId)
    record.organizationId = organizationId
    record.tenantId = tenantId
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.schema !== undefined) record.schema = cloneJson(parsed.schema)
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    await em.flush()
    return { schemaId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadSchemaSnapshot(em, result.schemaId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const em = ctx.container.resolve('em') as EntityManager
    const before = snapshots.before as AttributeSchemaSnapshot | undefined
    const after = await loadSchemaSnapshot(em, result.schemaId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate(
        'catalog.audit.attributeSchemas.update',
        'Update catalog attribute schema'
      ),
      resourceKind: 'catalog.attributeSchema',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies AttributeSchemaUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttributeSchemaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogAttributeSchemaTemplate, { id: before.id })
    if (!record) {
      record = em.create(CatalogAttributeSchemaTemplate, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        code: before.code,
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
    applySchemaSnapshot(record, before)
    await em.flush()
  },
}

const deleteAttributeSchemaCommand: CommandHandler<{ id: string }, { schemaId: string }> = {
  id: 'catalog.attributeSchemas.delete',
  async prepare(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSchemaSnapshot(em, input.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogAttributeSchemaTemplate, { id: input.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Attribute schema not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const assigned = await em.count(CatalogProduct, { attributeSchemaTemplate: record, deletedAt: null })
    if (assigned > 0) {
      throw new CrudHttpError(400, { error: 'Detach products from this schema before deleting it.' })
    }
    record.deletedAt = new Date()
    await em.flush()
    return { schemaId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AttributeSchemaSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate(
        'catalog.audit.attributeSchemas.delete',
        'Delete catalog attribute schema'
      ),
      resourceKind: 'catalog.attributeSchema',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies AttributeSchemaUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AttributeSchemaUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogAttributeSchemaTemplate, { id: before.id })
    if (!record) {
      record = em.create(CatalogAttributeSchemaTemplate, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        code: before.code,
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
    applySchemaSnapshot(record, before)
    record.deletedAt = null
    await em.flush()
  },
}

registerCommand(createAttributeSchemaCommand)
registerCommand(updateAttributeSchemaCommand)
registerCommand(deleteAttributeSchemaCommand)
