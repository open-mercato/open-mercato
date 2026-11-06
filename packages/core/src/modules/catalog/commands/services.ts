import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  requireId,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  parseWithCustomFields,
  setCustomFieldsIfAny,
} from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { restoreCreatedRow } from '@open-mercato/shared/lib/commands/redo'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogProductCategory,
  CatalogService,
  CatalogServiceMedia,
  CatalogServiceWorkRequirement,
} from '../data/entities'
import {
  serviceCreateSchema,
  serviceUpdateSchema,
  type ServiceCreateInput,
  type ServiceMediaInput,
  type ServiceUpdateInput,
  type ServiceWorkRequirementInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload, toNumericString } from './shared'

type ServiceMediaSnapshot = {
  id: string
  fileId: string | null
  url: string | null
  alt: string | null
  contentType: string | null
  sortOrder: number
  isDefault: boolean
  metadata: Record<string, unknown> | null
}

type ServiceWorkRequirementSnapshot = {
  id: string
  targetType: string
  targetId: string | null
  labelSnapshot: string
  allocationMode: string
  allocationValue: string
  sortOrder: number
  metadata: Record<string, unknown> | null
}

type ServiceSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string
  description: string | null
  scope: string | null
  categoryId: string | null
  defaultPriceAmount: string | null
  defaultPriceCurrencyCode: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  metadata: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  media: ServiceMediaSnapshot[]
  workRequirements: ServiceWorkRequirementSnapshot[]
  custom: Record<string, unknown> | null
}

type ServiceUndoPayload = {
  before?: ServiceSnapshot | null
  after?: ServiceSnapshot | null
}

const serviceCrudEvents: CrudEventsConfig<CatalogService> = {
  module: 'catalog',
  entity: 'service',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    isActive: ctx.entity.isActive,
  }),
}

const serviceCrudIndexer: CrudIndexerConfig<CatalogService> = {
  entityType: E.catalog.catalog_service,
  buildUpsertPayload: (ctx) => ({
    entityType: E.catalog.catalog_service,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.catalog.catalog_service,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

function trimNullable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function cloneMetadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function identifiers(service: CatalogService) {
  return {
    id: service.id,
    organizationId: service.organizationId,
    tenantId: service.tenantId,
  }
}

async function emitServiceChange(ctx: {
  dataEngine: DataEngine
  action: 'created' | 'updated' | 'deleted'
  service: CatalogService
}) {
  await emitCrudSideEffects({
    dataEngine: ctx.dataEngine,
    action: ctx.action,
    entity: ctx.service,
    identifiers: identifiers(ctx.service),
    events: serviceCrudEvents,
    indexer: serviceCrudIndexer,
  })
}

async function emitServiceUndoChange(ctx: {
  dataEngine: DataEngine
  action: 'created' | 'updated' | 'deleted'
  service: CatalogService
}) {
  await emitCrudUndoSideEffects({
    dataEngine: ctx.dataEngine,
    action: ctx.action,
    entity: ctx.service,
    identifiers: identifiers(ctx.service),
    events: serviceCrudEvents,
    indexer: serviceCrudIndexer,
  })
}

async function resolveCategory(
  em: EntityManager,
  categoryId: string | null | undefined,
  scope: { organizationId: string; tenantId: string },
): Promise<CatalogProductCategory | null> {
  if (!categoryId) return null
  const category = await findOneWithDecryption(
    em,
    CatalogProductCategory,
    {
      id: categoryId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!category) {
    throw new CrudHttpError(400, { error: 'Catalog category not found or inaccessible.' })
  }
  return category
}

async function syncServiceMedia(
  em: EntityManager,
  service: CatalogService,
  mediaInput: ServiceMediaInput[] | undefined,
) {
  if (!mediaInput) return
  await em.nativeDelete(CatalogServiceMedia, { service })
  const rows = mediaInput
    .filter((item) => item.fileId || item.url)
    .map((item, index) => em.create(CatalogServiceMedia, {
      service,
      organizationId: service.organizationId,
      tenantId: service.tenantId,
      fileId: item.fileId ?? null,
      url: trimNullable(item.url),
      alt: trimNullable(item.alt),
      contentType: trimNullable(item.contentType),
      sortOrder: item.sortOrder ?? index,
      isDefault: item.isDefault === true,
      metadata: cloneMetadata(item.metadata),
    }))
  for (const row of rows) em.persist(row)
  const defaultItem = rows.find((item) => item.isDefault) ?? rows[0] ?? null
  service.defaultMediaId = service.defaultMediaId ?? defaultItem?.fileId ?? null
  service.defaultMediaUrl = service.defaultMediaUrl ?? defaultItem?.url ?? null
}

async function syncWorkRequirements(
  em: EntityManager,
  service: CatalogService,
  requirementsInput: ServiceWorkRequirementInput[] | undefined,
) {
  if (!requirementsInput) return
  await em.nativeDelete(CatalogServiceWorkRequirement, { service })
  requirementsInput.forEach((item, index) => {
    const row = em.create(CatalogServiceWorkRequirement, {
      service,
      organizationId: service.organizationId,
      tenantId: service.tenantId,
      targetType: item.targetType,
      targetId: item.targetId ?? null,
      labelSnapshot: item.labelSnapshot,
      allocationMode: item.allocationMode,
      allocationValue: toNumericString(item.allocationValue) ?? '0',
      sortOrder: item.sortOrder ?? index,
      metadata: cloneMetadata(item.metadata),
    })
    em.persist(row)
  })
}

async function loadServiceSnapshot(em: EntityManager, id: string): Promise<ServiceSnapshot | null> {
  const record = await findOneWithDecryption(em, CatalogService, { id }, { populate: ['category'] })
  if (!record) return null
  const scope = { organizationId: record.organizationId, tenantId: record.tenantId }
  const [media, requirements, custom] = await Promise.all([
    findWithDecryption(em, CatalogServiceMedia, { service: record }, { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }, scope),
    findWithDecryption(em, CatalogServiceWorkRequirement, { service: record }, { orderBy: { sortOrder: 'asc', createdAt: 'asc' } }, scope),
    loadCustomFieldSnapshot(em, {
      entityId: E.catalog.catalog_service,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
    }),
  ])
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    title: record.title,
    description: record.description ?? null,
    scope: record.scope ?? null,
    categoryId: record.category?.id ?? null,
    defaultPriceAmount: record.defaultPriceAmount ?? null,
    defaultPriceCurrencyCode: record.defaultPriceCurrencyCode ?? null,
    defaultMediaId: record.defaultMediaId ?? null,
    defaultMediaUrl: record.defaultMediaUrl ?? null,
    metadata: cloneMetadata(record.metadata),
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
    media: media.map((item) => ({
      id: item.id,
      fileId: item.fileId ?? null,
      url: item.url ?? null,
      alt: item.alt ?? null,
      contentType: item.contentType ?? null,
      sortOrder: item.sortOrder,
      isDefault: item.isDefault,
      metadata: cloneMetadata(item.metadata),
    })),
    workRequirements: requirements.map((item) => ({
      id: item.id,
      targetType: item.targetType,
      targetId: item.targetId ?? null,
      labelSnapshot: item.labelSnapshot,
      allocationMode: item.allocationMode,
      allocationValue: item.allocationValue,
      sortOrder: item.sortOrder,
      metadata: cloneMetadata(item.metadata),
    })),
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function writeServiceCustomFields(
  dataEngine: DataEngine,
  service: Pick<CatalogService, 'id' | 'organizationId' | 'tenantId'>,
  values: Record<string, unknown>,
) {
  if (!Object.keys(values).length) return
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: E.catalog.catalog_service,
    recordId: service.id,
    organizationId: service.organizationId,
    tenantId: service.tenantId,
    values,
  })
}

async function restoreServiceCustomFields(
  dataEngine: DataEngine,
  target: ServiceSnapshot,
  current: ServiceSnapshot | null | undefined,
) {
  const values = buildCustomFieldResetMap(target.custom ?? undefined, current?.custom ?? undefined)
  await writeServiceCustomFields(dataEngine, target, values)
}

function applyServiceSnapshot(
  em: EntityManager,
  record: CatalogService,
  snapshot: ServiceSnapshot,
) {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.title = snapshot.title
  record.description = snapshot.description
  record.scope = snapshot.scope
  record.category = snapshot.categoryId ? em.getReference(CatalogProductCategory, snapshot.categoryId) : null
  record.defaultPriceAmount = snapshot.defaultPriceAmount
  record.defaultPriceCurrencyCode = snapshot.defaultPriceCurrencyCode
  record.defaultMediaId = snapshot.defaultMediaId
  record.defaultMediaUrl = snapshot.defaultMediaUrl
  record.metadata = cloneMetadata(snapshot.metadata)
  record.isActive = snapshot.isActive
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = snapshot.deletedAt ? new Date(snapshot.deletedAt) : null
}

async function restoreServiceChildren(
  em: EntityManager,
  record: CatalogService,
  snapshot: ServiceSnapshot,
) {
  await em.nativeDelete(CatalogServiceMedia, { service: record })
  await em.nativeDelete(CatalogServiceWorkRequirement, { service: record })
  for (const item of snapshot.media) {
    em.persist(em.create(CatalogServiceMedia, {
      id: item.id,
      service: record,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      fileId: item.fileId,
      url: item.url,
      alt: item.alt,
      contentType: item.contentType,
      sortOrder: item.sortOrder,
      isDefault: item.isDefault,
      metadata: cloneMetadata(item.metadata),
    }))
  }
  for (const item of snapshot.workRequirements) {
    em.persist(em.create(CatalogServiceWorkRequirement, {
      id: item.id,
      service: record,
      organizationId: snapshot.organizationId,
      tenantId: snapshot.tenantId,
      targetType: item.targetType as CatalogServiceWorkRequirement['targetType'],
      targetId: item.targetId,
      labelSnapshot: item.labelSnapshot,
      allocationMode: item.allocationMode as CatalogServiceWorkRequirement['allocationMode'],
      allocationValue: item.allocationValue,
      sortOrder: item.sortOrder,
      metadata: cloneMetadata(item.metadata),
    }))
  }
}

const createServiceCommand: CommandHandler<ServiceCreateInput, { serviceId: string }> = {
  id: 'catalog.services.create',
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(serviceCreateSchema, input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(CatalogService, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      title: parsed.title,
      description: trimNullable(parsed.description),
      scope: trimNullable(parsed.scope),
      category: await resolveCategory(em, parsed.categoryId ?? null, parsed),
      defaultPriceAmount:
        parsed.defaultPriceAmount === null || parsed.defaultPriceAmount === undefined
          ? null
          : (toNumericString(parsed.defaultPriceAmount) ?? null),
      defaultPriceCurrencyCode: parsed.defaultPriceCurrencyCode ?? null,
      defaultMediaId: parsed.defaultMediaId ?? null,
      defaultMediaUrl: trimNullable(parsed.defaultMediaUrl),
      metadata: cloneMetadata(parsed.metadata),
      isActive: parsed.isActive !== false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await withAtomicFlush(
      em,
      [
        () => em.flush(),
        () => syncServiceMedia(em, record, parsed.media),
        () => syncWorkRequirements(em, record, parsed.workRequirements),
        () => em.flush(),
      ],
      { transaction: true },
    )
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await writeServiceCustomFields(dataEngine, record, custom)
    await emitServiceChange({ dataEngine, action: 'created', service: record })
    return { serviceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadServiceSnapshot(em, result.serviceId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ServiceSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.services.create', 'Create catalog service'),
      resourceKind: 'catalog.service',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: { undo: { after } satisfies ServiceUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ServiceUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(em, CatalogService, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await writeServiceCustomFields(dataEngine, after, buildCustomFieldResetMap(undefined, after.custom ?? undefined))
    await emitServiceUndoChange({ dataEngine, action: 'deleted', service: record })
  },
}

const updateServiceCommand: CommandHandler<ServiceUpdateInput, { serviceId: string }> = {
  id: 'catalog.services.update',
  prepare: async (input, ctx) => {
    const id = requireId(input, 'Service id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadServiceSnapshot(em, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(serviceUpdateSchema, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(em, CatalogService, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog service not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const nextCategory =
      parsed.categoryId !== undefined
        ? await resolveCategory(em, parsed.categoryId, {
            organizationId: record.organizationId,
            tenantId: record.tenantId,
          })
        : undefined
    if (parsed.title !== undefined) record.title = parsed.title
    if (parsed.description !== undefined) record.description = trimNullable(parsed.description)
    if (parsed.scope !== undefined) record.scope = trimNullable(parsed.scope)
    if (nextCategory !== undefined) record.category = nextCategory
    if (parsed.defaultPriceAmount !== undefined) {
      record.defaultPriceAmount =
        parsed.defaultPriceAmount === null ? null : (toNumericString(parsed.defaultPriceAmount) ?? null)
    }
    if (parsed.defaultPriceCurrencyCode !== undefined) {
      record.defaultPriceCurrencyCode = parsed.defaultPriceCurrencyCode ?? null
    }
    if (parsed.defaultMediaId !== undefined) record.defaultMediaId = parsed.defaultMediaId ?? null
    if (parsed.defaultMediaUrl !== undefined) record.defaultMediaUrl = trimNullable(parsed.defaultMediaUrl)
    if (parsed.metadata !== undefined) record.metadata = cloneMetadata(parsed.metadata)
    if (parsed.isActive !== undefined) record.isActive = parsed.isActive
    record.updatedAt = new Date()
    await withAtomicFlush(
      em,
      [
        () => em.flush(),
        () => syncServiceMedia(em, record, parsed.media),
        () => syncWorkRequirements(em, record, parsed.workRequirements),
        () => em.flush(),
      ],
      { transaction: true },
    )
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await writeServiceCustomFields(dataEngine, record, custom)
    await emitServiceChange({ dataEngine, action: 'updated', service: record })
    return { serviceId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadServiceSnapshot(em, result.serviceId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ServiceSnapshot | undefined
    const after = snapshots.after as ServiceSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.services.update', 'Update catalog service'),
      resourceKind: 'catalog.service',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: { undo: { before, after } satisfies ServiceUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undoPayload = extractUndoPayload<ServiceUndoPayload>(logEntry)
    const before = undoPayload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findOneWithDecryption(em, CatalogService, { id: before.id })
    if (!record) {
      record = await restoreCreatedRow(em, CatalogService, before.id, () => ({
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title,
      }))
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyServiceSnapshot(em, record, before)
    await withAtomicFlush(
      em,
      [
        () => em.flush(),
        () => restoreServiceChildren(em, record, before),
        () => em.flush(),
      ],
      { transaction: true },
    )
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await restoreServiceCustomFields(dataEngine, before, undoPayload?.after)
    await emitServiceUndoChange({ dataEngine, action: 'updated', service: record })
  },
}

const deleteServiceCommand: CommandHandler<{ id: string }, { serviceId: string }> = {
  id: 'catalog.services.delete',
  prepare: async (input, ctx) => {
    const id = requireId(input, 'Service id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const before = await loadServiceSnapshot(em, id)
    return before ? { before } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Service id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(em, CatalogService, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog service not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitServiceChange({ dataEngine, action: 'deleted', service: record })
    return { serviceId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ServiceSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.services.delete', 'Delete catalog service'),
      resourceKind: 'catalog.service',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: { undo: { before } satisfies ServiceUndoPayload },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undoPayload = extractUndoPayload<ServiceUndoPayload>(logEntry)
    const before = undoPayload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findOneWithDecryption(em, CatalogService, { id: before.id })
    if (!record) {
      record = await restoreCreatedRow(em, CatalogService, before.id, () => ({
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        title: before.title,
      }))
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyServiceSnapshot(em, record, before)
    await withAtomicFlush(
      em,
      [
        () => em.flush(),
        () => restoreServiceChildren(em, record, before),
        () => em.flush(),
      ],
      { transaction: true },
    )
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await restoreServiceCustomFields(dataEngine, before, null)
    await emitServiceUndoChange({ dataEngine, action: 'created', service: record })
  },
}

registerCommand(createServiceCommand)
registerCommand(updateServiceCommand)
registerCommand(deleteServiceCommand)
