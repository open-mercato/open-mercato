import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
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

type OptionInputType = CatalogProductOption['inputType']

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
  inputType: OptionInputType
  inputConfig: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
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
  createdAt: string
  updatedAt: string
  custom: Record<string, unknown> | null
}

type OptionUndoPayload = {
  before?: OptionSnapshot | null
  after?: OptionSnapshot | null
}

type OptionValueUndoPayload = {
  before?: OptionValueSnapshot | null
  after?: OptionValueSnapshot | null
}

const OPTION_CHANGE_KEYS = [
  'code',
  'label',
  'description',
  'position',
  'isRequired',
  'isMultiple',
  'inputType',
  'inputConfig',
  'metadata',
] as const satisfies readonly string[]

const OPTION_VALUE_CHANGE_KEYS = [
  'code',
  'label',
  'description',
  'position',
  'metadata',
] as const satisfies readonly string[]

async function loadOptionSnapshot(
  em: EntityManager,
  id: string
): Promise<OptionSnapshot | null> {
  const record = await em.findOne(CatalogProductOption, { id })
  if (!record) return null
  const productId = typeof record.product === 'string' ? record.product : record.product.id
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_option,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
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
    inputType: record.inputType,
    inputConfig: record.inputConfig ? cloneJson(record.inputConfig) : null,
    metadata: record.metadata ? cloneJson(record.metadata) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
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
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_option_value,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
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
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: Object.keys(custom).length ? custom : null,
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
  record.inputType = snapshot.inputType as any
  record.inputConfig = snapshot.inputConfig ? cloneJson(snapshot.inputConfig) : null
  record.metadata = snapshot.metadata ? cloneJson(snapshot.metadata) : null
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
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
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
}

const createOptionCommand: CommandHandler<OptionCreateInput, { optionId: string }> = {
  id: 'catalog.options.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(optionCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const product = await requireProduct(em, parsed.productId)
    ensureTenantScope(ctx, product.tenantId)
    ensureOrganizationScope(ctx, product.organizationId)

    const now = new Date()
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
      inputType: parsed.inputType ?? 'select',
      inputConfig: parsed.inputConfig ? cloneJson(parsed.inputConfig) : null,
      metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_option,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { optionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductOption, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    em.remove(record)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateOptionCommand: CommandHandler<OptionUpdateInput, { optionId: string }> = {
  id: 'catalog.options.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOptionSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(optionUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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
    if (parsed.inputType !== undefined) record.inputType = parsed.inputType
    if (parsed.inputConfig !== undefined) {
      record.inputConfig = parsed.inputConfig ? cloneJson(parsed.inputConfig) : null
    }
    if (parsed.metadata !== undefined) {
      record.metadata = parsed.metadata ? cloneJson(parsed.metadata) : null
    }
    await em.flush()
    if (custom && Object.keys(custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
    }
    return { optionId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadOptionSnapshot(em, result.optionId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
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
      changes: buildChanges(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
        OPTION_CHANGE_KEYS
      ),
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
    const after = payload?.after
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductOption, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductOption, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        label: before.label,
        description: before.description ?? null,
        position: before.position,
        isRequired: before.isRequired,
        isMultiple: before.isMultiple,
        inputType: before.inputType,
        inputConfig: before.inputConfig ? cloneJson(before.inputConfig) : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(
      before.custom ?? undefined,
      after?.custom ?? undefined
    )
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteOptionCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { optionId: string }
> = {
  id: 'catalog.options.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOptionSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Option id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductOption, { id })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog option not found' })
    const product = record.product as CatalogProduct | string
    const productEntity =
      typeof product === 'string' ? await requireProduct(em, product) : product
    ensureTenantScope(ctx, productEntity.tenantId)
    ensureOrganizationScope(ctx, productEntity.organizationId)

    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOptionSnapshot(baseEm, id)

    const optionValueCount = await em.count(CatalogProductOptionValue, { option: record })
    if (optionValueCount > 0) {
      throw new CrudHttpError(400, { error: 'Remove option values before deleting the option.' })
    }
    const variantFilter: FilterQuery<CatalogVariantOptionValue> = {
      optionValue: { option: record },
    }
    const existingVariantMappings = await em.count(CatalogVariantOptionValue, variantFilter)
    if (existingVariantMappings > 0) {
      throw new CrudHttpError(400, {
        error: 'Remove variant option assignments before deleting the option.',
      })
    }
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_option,
          recordId: id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductOption, { id: before.id })
    if (!record) {
      const product = await requireProduct(em, before.productId)
      record = em.create(CatalogProductOption, {
        id: before.id,
        product,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        label: before.label,
        description: before.description ?? null,
        position: before.position,
        isRequired: before.isRequired,
        isMultiple: before.isMultiple,
        inputType: before.inputType,
        inputConfig: before.inputConfig ? cloneJson(before.inputConfig) : null,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionSnapshot(record, before)
    await em.flush()
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

const createOptionValueCommand: CommandHandler<OptionValueCreateInput, { optionValueId: string }> =
  {
    id: 'catalog.option-values.create',
    async execute(rawInput, ctx) {
      const { parsed, custom } = parseWithCustomFields(optionValueCreateSchema, rawInput)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const option = await requireOption(em, parsed.optionId)
      const product = option.product as CatalogProduct | string
      const productEntity =
        typeof product === 'string' ? await requireProduct(em, product) : product
      ensureTenantScope(ctx, productEntity.tenantId)
      ensureOrganizationScope(ctx, productEntity.organizationId)

      const now = new Date()
      const record = em.create(CatalogProductOptionValue, {
        organizationId: option.organizationId,
        tenantId: option.tenantId,
        option,
        code: parsed.code,
        label: parsed.label,
        description: parsed.description ?? null,
        position: parsed.position ?? 0,
        metadata: parsed.metadata ? cloneJson(parsed.metadata) : null,
        createdAt: now,
        updatedAt: now,
      })
      em.persist(record)
      await em.flush()
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option_value,
        recordId: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
        values: custom,
      })
      return { optionValueId: record.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = (ctx.container.resolve('em') as EntityManager)
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
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const record = await em.findOne(CatalogProductOptionValue, { id: after.id })
      if (!record) return
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      await em.nativeDelete(CatalogVariantOptionValue, { optionValue: after.id })
      em.remove(record)
      await em.flush()
      const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_option_value,
          recordId: after.id,
          organizationId: after.organizationId,
          tenantId: after.tenantId,
          values: resetValues,
        })
      }
    },
  }

const updateOptionValueCommand: CommandHandler<OptionValueUpdateInput, { optionValueId: string }> =
  {
    id: 'catalog.option-values.update',
    async prepare(input, ctx) {
      const id = requireId(input, 'Option value id is required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadOptionValueSnapshot(em, id)
      if (snapshot) {
        ensureTenantScope(ctx, snapshot.tenantId)
        ensureOrganizationScope(ctx, snapshot.organizationId)
      }
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const { parsed, custom } = parseWithCustomFields(optionValueUpdateSchema, rawInput)
      const em = (ctx.container.resolve('em') as EntityManager).fork()
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
      if (custom && Object.keys(custom).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_option_value,
          recordId: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
          values: custom,
        })
      }
      return { optionValueId: record.id }
    },
    captureAfter: async (_input, result, ctx) => {
      const em = (ctx.container.resolve('em') as EntityManager)
      return loadOptionValueSnapshot(em, result.optionValueId)
    },
    buildLog: async ({ result, ctx, snapshots }) => {
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
        changes: buildChanges(
          before as Record<string, unknown>,
          after as Record<string, unknown>,
          OPTION_VALUE_CHANGE_KEYS
        ),
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
      const after = payload?.after
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let record = await em.findOne(CatalogProductOptionValue, { id: before.id })
      if (!record) {
        const option = await requireOption(em, before.optionId)
        record = em.create(CatalogProductOptionValue, {
          id: before.id,
          option,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          code: before.code,
          label: before.label,
          description: before.description ?? null,
          position: before.position,
          metadata: before.metadata ? cloneJson(before.metadata) : null,
          createdAt: new Date(before.createdAt),
          updatedAt: new Date(before.updatedAt),
        })
        em.persist(record)
      }
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      applyOptionValueSnapshot(record, before)
      await em.flush()
      const resetValues = buildCustomFieldResetMap(
        before.custom ?? undefined,
        after?.custom ?? undefined
      )
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_option_value,
          recordId: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          values: resetValues,
        })
      }
    },
  }

const deleteOptionValueCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown> },
  { optionValueId: string }
> = {
  id: 'catalog.option-values.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Option value id is required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOptionValueSnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Option value id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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

    const baseEm = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadOptionValueSnapshot(baseEm, id)

    const usageCount = await em.count(CatalogVariantOptionValue, { optionValue: record })
    if (usageCount > 0) {
      throw new CrudHttpError(400, {
        error: 'Remove variant option assignments before deleting the value.',
      })
    }
    em.remove(record)
    await em.flush()
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_option_value,
          recordId: id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
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
    const after = payload?.after
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductOptionValue, { id: before.id })
    if (!record) {
      const option = await requireOption(em, before.optionId)
      record = em.create(CatalogProductOptionValue, {
        id: before.id,
        option,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        label: before.label,
        description: before.description ?? null,
        position: before.position,
        metadata: before.metadata ? cloneJson(before.metadata) : null,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    }
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    applyOptionValueSnapshot(record, before)
    await em.flush()
    const resetValues = buildCustomFieldResetMap(
      before.custom ?? undefined,
      after?.custom ?? undefined
    )
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_option_value,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

registerCommand(createOptionCommand)
registerCommand(updateOptionCommand)
registerCommand(deleteOptionCommand)

registerCommand(createOptionValueCommand)
registerCommand(updateOptionValueCommand)
registerCommand(deleteOptionValueCommand)
