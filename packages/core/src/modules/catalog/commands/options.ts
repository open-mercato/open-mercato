import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  CatalogProduct,
  CatalogProductOption,
  CatalogProductOptionValue,
  CatalogVariantOptionValue,
} from '../data/entities'
import {
  optionCreateSchema,
  optionUpdateSchema,
  optionValueCreateSchema,
  optionValueUpdateSchema,
  type OptionCreateInput,
  type OptionUpdateInput,
  type OptionValueCreateInput,
  type OptionValueUpdateInput,
} from '../data/validators'
import {
  cloneJson,
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireOption,
  requireProduct,
} from './shared'

type OptionSnapshot = {
  id: string
  productId: string
  organizationId: string
  tenantId: string
  code: string
  label: string
  description: string | null
  position: number
  isRequired: boolean
  isMultiple: boolean
  metadata: Record<string, unknown> | null
}

type OptionValueSnapshot = {
  id: string
  optionId: string
  productId: string
  organizationId: string
  tenantId: string
  code: string
  label: string
  description: string | null
  position: number
  metadata: Record<string, unknown> | null
}

type OptionUndoPayload = {
  before?: OptionSnapshot | null
  after?: OptionSnapshot | null
}

type OptionValueUndoPayload = {
  before?: OptionValueSnapshot | null
  after?: OptionValueSnapshot | null
}

async function loadOptionSnapshot(
  em: EntityManager,
  id: string
): Promise<OptionSnapshot | null> {
  const record = await em.findOne(CatalogProductOption, { id })
  if (!record) return null
  const productId = typeof record.product === 'string' ? record.product : record.product.id
  return {
    id: record.id,
    productId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    code: record.code,
    label: record.label,
    description: record.description ?? null,
    position: record.position,
    isRequired: record.isRequired,
    isMultiple: record.isMultiple,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
  }
}

async function loadOptionValueSnapshot(
  em: EntityManager,
  id: string
): Promise<OptionValueSnapshot | null> {
  const record = await em.findOne(CatalogProductOptionValue, { id })
  if (!record) return null
  const option = record.option as CatalogProductOption | string
  const optionEntity =
    typeof option === 'string' ? await em.findOne(CatalogProductOption, { id: option }) : option
  if (!optionEntity) return null
  const productId =
    typeof optionEntity.product === 'string' ? optionEntity.product : optionEntity.product.id
  return {
    id: record.id,
    optionId: typeof record.option === 'string' ? record.option : record.option.id,
    productId,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    code: record.code,
    label: record.label,
    description: record.description ?? null,
    position: record.position,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
  }
}

function applyOptionSnapshot(record: CatalogProductOption, snapshot: OptionSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.code = snapshot.code
  record.label = snapshot.label
  record.description = snapshot.description ?? null
  record.position = snapshot.position
  record.isRequired = snapshot.isRequired
  record.isMultiple = snapshot.isMultiple
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
}

function applyOptionValueSnapshot(
  record: CatalogProductOptionValue,
  snapshot: OptionValueSnapshot
): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.code = snapshot.code
  record.label = snapshot.label
  record.description = snapshot.description ?? null
  record.position = snapshot.position
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
}

const createOptionCommand: CommandHandler<OptionCreateInput, { optionId: string }> = {
  id: 'catalog.options.create',
  async execute(rawInput, ctx) {
    const parsed = optionCreateSchema.parse(rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const product = await requireProduct(em, parsed.productId)
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    const record = em.create(CatalogProductOption, {
      organizationId: product.organizationId,
      tenantId: product.tenantId,
      product,
      code: parsed.code,
      label: parsed.label,
      description: parsed.description ?? null,
      position: parsed.position ?? 0,
      isRequired: parsed.isRequired ?? false,
      isMultiple: parsed.isMultiple ?? false,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
    })
    em.persist(record)
    await em.flush()
    return { optionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadOptionSnapshot(em, result.optionId)
  },
  buildLog: async ({ result, snapshots }) => {
    const after = snapshots.after as OptionSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.options.create', 'Create product option'),
      resourceKind: 'catalog.option',
      resourceId: result.optionId,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: {
          after,
        } satisfies OptionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductOption, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
  },
}

const updateOptionCommand: CommandHandler<OptionUpdateInput, { optionId: string }> = {
  id: 'catalog.options.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadOptionSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = optionUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductOption, { id: parsed.id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog option not found' })
    const product = record.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.label !== undefined) record.label = parsed.label
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.position !== undefined) record.position = parsed.position ?? 0
    if (parsed.isRequired !== undefined) record.isRequired = parsed.isRequired
    if (parsed.isMultiple !== undefined) record.isMultiple = parsed.isMultiple
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    await em.flush()
    return { optionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    return loadOptionSnapshot(em, result.optionId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OptionSnapshot | undefined
    const after = snapshots.after as OptionSnapshot | undefined
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.options.update', 'Update product option'),
      resourceKind: 'catalog.option',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
      payload: {
        undo: {
          before,
          after,
        } satisfies OptionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(CatalogProductOption, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductOption, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSnapshot(record, before)
    await em.flush()
  },
}

const deleteOptionCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { optionId: string }
> = {
  id: 'catalog.options.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadOptionSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductOption, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog option not found' })
    const product = record.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

    const optionValueCount = await em.count(CatalogProductOptionValue, { option: record })
    if (optionValueCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove option values before deleting the option.' })
    }
    const existingVariantMappings = await em.count(CatalogVariantOptionValue, {
      optionValue: { option: record },
    } as any)
    if (existingVariantMappings > 0) {
      throw new CrudHttpError(400, {
        error: 'Remove variant option assignments before deleting the option.',
      })
    }
    em.remove(record)
    await em.flush()
    return { optionId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OptionSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.options.delete', 'Delete product option'),
      resourceKind: 'catalog.option',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies OptionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(CatalogProductOption, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductOption, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSnapshot(record, before)
    await em.flush()
  },
}

const createOptionValueCommand: CommandHandler<OptionValueCreateInput, { optionValueId: string }> =
  {
    id: 'catalog.option-values.create',
    async execute(rawInput, ctx) {
      const parsed = optionValueCreateSchema.parse(rawInput)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const option = await requireOption(em, parsed.optionId)
      const product = option.product as CatalogProduct | string
      const productEntity =
        typeof product === 'string' ? await requireProduct(em, product) : product
      ensureTenantScope(ctx, productEntity.tenantId)
      ensureOrganizationScope(ctx, productEntity.organizationId)

      const record = em.create(CatalogProductOptionValue, {
        organizationId: option.organizationId,
        tenantId: option.tenantId,
        option,
        code: parsed.code,
        label: parsed.label,
        description: parsed.description ?? null,
        position: parsed.position ?? 0,
        metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      })
      em.persist(record)
      await em.flush()
      return { optionValueId: record.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadOptionValueSnapshot(em, result.optionValueId)
    },
    buildLog: async ({ result, snapshots }) => {
      const after = snapshots.after as OptionValueSnapshot | undefined
      if (!after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('catalog.audit.option-values.create', 'Create option value'),
        resourceKind: 'catalog.option-value',
        resourceId: result.optionValueId,
        tenantId: after.tenantId,
        organizationId: after.organizationId,
        snapshotAfter: after,
        payload: {
          undo: {
            after,
          } satisfies OptionValueUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<OptionValueUndoPayload>(logEntry)
      const after = payload?.after
      if (!after) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const record = await em.findOne(CatalogProductOptionValue, { id: after.id })
      if (!record) return
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      await em.nativeDelete(CatalogVariantOptionValue, { optionValue: after.id })
      em.remove(record)
      await em.flush()
    },
  }

const updateOptionValueCommand: CommandHandler<OptionValueUpdateInput, { optionValueId: string }> =
  {
    id: 'catalog.option-values.update',
    async prepare(input, ctx) {
      const id = requireId(input, 'Option value id is required')
      const em = ctx.container.resolve<EntityManager>('em')
      const snapshot = await loadOptionValueSnapshot(em, id)
      if (snapshot) {
        ensureTenantScope(ctx, snapshot.tenantId)
        ensureOrganizationScope(ctx, snapshot.organizationId)
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const parsed = optionValueUpdateSchema.parse(rawInput)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const record = await em.findOne(CatalogProductOptionValue, { id: parsed.id })
      if (!record) throw new CrudHttpError(404, { error: 'Option value not found' })
      const option = record.option as CatalogProductOption | string
      const optionEntity =
        typeof option === 'string' ? await requireOption(em, option) : option
      const product = optionEntity.product as CatalogProduct | string
      const productEntity =
        typeof product === 'string' ? await requireProduct(em, product) : product
      ensureTenantScope(ctx, productEntity.tenantId)
      ensureOrganizationScope(ctx, productEntity.organizationId)

      if (parsed.code !== undefined) record.code = parsed.code
      if (parsed.label !== undefined) record.label = parsed.label
      if (parsed.description !== undefined) record.description = parsed.description ?? null
      if (parsed.position !== undefined) record.position = parsed.position ?? 0
      if (parsed.metadata !== undefined) {
        record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
      }
      await em.flush()
      return { optionValueId: record.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      return loadOptionValueSnapshot(em, result.optionValueId)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as OptionValueSnapshot | undefined
      const after = snapshots.after as OptionValueSnapshot | undefined
      if (!before || !after) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('catalog.audit.option-values.update', 'Update option value'),
        resourceKind: 'catalog.option-value',
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>),
        payload: {
          undo: {
            before,
            after,
          } satisfies OptionValueUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<OptionValueUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = ctx.container.resolve<EntityManager>('em').fork()
      let record = await em.findOne(CatalogProductOptionValue, { id: before.id })
      if (!record) {
        const option = await requireOption(em, before.optionId)
        record = em.create(CatalogProductOptionValue, {
          id: before.id,
          option,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
        })
        em.persist(record)
      }
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      applyOptionValueSnapshot(record, before)
      await em.flush()
    },
  }

const deleteOptionValueCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { optionValueId: string }
> = {
  id: 'catalog.option-values.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option value id is required')
    const em = ctx.container.resolve<EntityManager>('em')
    const snapshot = await loadOptionValueSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Option value id is required')
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOne(CatalogProductOptionValue, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Option value not found' })
    const option = record.option as CatalogProductOption | string
    const optionEntity =
      typeof option === 'string' ? await requireOption(em, option) : option
    const product = optionEntity.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

    const usageCount = await em.count(CatalogVariantOptionValue, { optionValue: record })
    if (usageCount > 0) {
      throw new CrudHttpError(400, {
        error: 'Remove variant option assignments before deleting the value.',
      })
    }
    em.remove(record)
    await em.flush()
    return { optionValueId: id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as OptionValueSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.option-values.delete', 'Delete option value'),
      resourceKind: 'catalog.option-value',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies OptionValueUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OptionValueUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = ctx.container.resolve<EntityManager>('em').fork()
    let record = await em.findOne(CatalogProductOptionValue, { id: before.id })
    if (!record) {
      const option = await requireOption(em, before.optionId)
      record = em.create(CatalogProductOptionValue, {
        id: before.id,
        option,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionValueSnapshot(record, before)
    await em.flush()
  },
}

registerCommand(createOptionCommand)
registerCommand(updateOptionCommand)
registerCommand(deleteOptionCommand)

registerCommand(createOptionValueCommand)
registerCommand(updateOptionValueCommand)
registerCommand(deleteOptionValueCommand)
