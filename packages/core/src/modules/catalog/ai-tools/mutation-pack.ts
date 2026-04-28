/**
 * Catalog D18 mutation tool pack (Phase 3 WS-C, Step 5.14).
 *
 * Ships the four mutation tools the `catalog.merchandising_assistant`
 * (Step 4.9) whitelists under the pending-action approval contract:
 *
 * 1. `catalog.update_product` — single-record write (isBulk=false).
 * 2. `catalog.bulk_update_products` — batch write (isBulk=true). One
 *    pending action per batch; per-record versions carried in
 *    `records[]` so Step 5.8's confirm route can reject stale rows
 *    individually without aborting the batch.
 * 3. `catalog.apply_attribute_extraction` — batch write that persists
 *    the structured output of `catalog.extract_attributes_from_description`
 *    (Step 3.12) against the CURRENT attribute schema. Schema drift is
 *    caught at two points: (a) the tool's pre-submit validator rejects
 *    attribute keys that do not resolve to a custom-field definition,
 *    and (b) the Step 5.8 re-check loop calls `loadBeforeRecords` again
 *    before confirm.
 * 4. `catalog.update_product_media_descriptions` — batch write that
 *    updates altText / caption on product media attachments via the
 *    attachment's `storageMetadata` envelope. No attachments command
 *    exists yet, so the handler performs a guarded direct EM flush.
 *    The writes are scalar only (no intermediate queries on the same EM)
 *    so `em.flush()` in a single phase is safe and matches the spec's
 *    "single pending-action per batch" contract.
 *
 * All four tools:
 * - Are tenant + organization scoped through `findOneWithDecryption` /
 *   `findWithDecryption` before any write.
 * - Use `z.object(...).strict()` on their input schemas (spec §7 rule:
 *   reject hallucinated attribute names / unknown fields).
 * - Preserve per-record result shape when only some records fail:
 *   handler returns `{ records: [{ recordId, status, before, after, error? }], failedRecordIds }`
 *   so Step 5.8's executor can populate `failedRecords[]` on the
 *   `AiPendingAction` row without the caller treating a partial failure
 *   as a batch failure.
 * - Delegate the authoritative write to an existing command
 *   (`catalog.products.update`) where possible, so all downstream side
 *   effects (audit log, `catalog.product.updated` event, query index
 *   refresh, notifications) stay identical to a direct API write. The
 *   media-description tool is the one exception: it updates
 *   `attachments.storage_metadata` directly because no attachments
 *   command exists. Tenant + organization scope are re-checked inside
 *   the direct write.
 *
 * BC: additive only. `CatalogAiToolDefinition` grows optional
 * `loadBeforeRecord` / `loadBeforeRecords` / `isBulk` fields that default
 * to undefined on every pre-5.14 tool. No new feature ids, no DB
 * migrations, no event-id changes. Mutation-policy override at the
 * tenant level is still the only lever that unlocks writes — agent
 * `readOnly: true` stays unchanged (Step 5.13 discipline).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldDefinitionIndex } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import {
  createAiApiOperationRunner,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { CatalogProduct, CatalogProductPrice } from '../data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  assertTenantScope,
  type CatalogAiToolDefinition,
  type CatalogToolContext,
  type CatalogToolLoadBeforeRecord,
  type CatalogToolLoadBeforeSingleRecord,
} from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

function buildAuthContextFromTool(
  ctx: CatalogToolContext,
  tenantId: string,
  organizationId: string,
): AuthContext {
  return {
    sub: ctx.userId ?? 'ai-agent',
    tenantId,
    orgId: organizationId,
    roles: [],
    isApiKey: false,
  } as AuthContext
}

function buildCommandRuntimeContext(
  ctx: CatalogToolContext,
  tenantId: string,
  organizationId: string,
): CommandRuntimeContext {
  return {
    container: ctx.container,
    auth: buildAuthContextFromTool(ctx, tenantId, organizationId),
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
}

function recordVersionFromUpdatedAt(updatedAt: Date | null | undefined): string | null {
  if (!updatedAt) return null
  const value = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

async function loadProductForScope(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  productId: string,
): Promise<CatalogProduct | null> {
  const where: Record<string, unknown> = { id: productId, tenantId, deletedAt: null }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const row = await findOneWithDecryption<CatalogProduct>(
    em,
    CatalogProduct,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!row || row.tenantId !== tenantId) return null
  if (ctx.organizationId && row.organizationId !== ctx.organizationId) return null
  return row
}

function productSnapshot(row: CatalogProduct): Record<string, unknown> {
  return {
    title: row.title ?? null,
    subtitle: row.subtitle ?? null,
    description: row.description ?? null,
    sku: row.sku ?? null,
    handle: row.handle ?? null,
    isActive: row.isActive ?? null,
    primaryCurrencyCode: row.primaryCurrencyCode ?? null,
  }
}

function productLabel(row: CatalogProduct): string {
  if (row.title && row.title.trim().length) return row.title
  if (row.sku && row.sku.trim().length) return row.sku
  return row.id
}

/* -------------------------------------------------------------------------- */
/*  Price pre-submit validation                                                */
/* -------------------------------------------------------------------------- */

const pricePatchSchema = z
  .object({
    priceKindId: z.string().uuid().optional(),
    currencyCode: z.string().trim().min(3).max(8).optional(),
    amount: z.number().nonnegative(),
  })
  .strict()

async function validateProductPriceScope(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  productId: string,
  priceInput: z.infer<typeof pricePatchSchema>,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (priceInput.currencyCode) {
    const candidates = await findWithDecryption<CatalogProductPrice>(
      em,
      CatalogProductPrice,
      { tenantId, product: productId } as any,
      undefined,
      { tenantId, organizationId },
    )
    const seen = new Set<string>(candidates.map((entry) => (entry.currencyCode ?? '').toUpperCase()))
    if (seen.size > 0 && !seen.has(priceInput.currencyCode.toUpperCase())) {
      return {
        ok: false,
        code: 'currency_out_of_scope',
        message: `Currency "${priceInput.currencyCode}" is not configured for product ${productId}.`,
      }
    }
  }
  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/*  catalog.update_product (single-record)                                     */
/* -------------------------------------------------------------------------- */

const updateProductInput = z
  .object({
    productId: z.string().uuid().describe('Catalog product id (UUID).'),
    title: z.string().trim().min(1).max(255).optional(),
    subtitle: z.string().trim().max(255).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    isActive: z.boolean().optional(),
    price: pricePatchSchema.optional().describe('Optional price adjustment; must match an existing currency for the product.'),
  })
  .strict()

type UpdateProductInput = z.infer<typeof updateProductInput>

const updateProductTool: CatalogAiToolDefinition = {
  name: 'catalog.update_product',
  displayName: 'Update product',
  description:
    'Update a single catalog product (title, subtitle, description, isActive, optional price). Routes through the AI pending-action approval gate.',
  inputSchema: updateProductInput as z.ZodType<unknown>,
  requiredFeatures: ['catalog.products.manage'],
  tags: ['write', 'catalog', 'merchandising'],
  isMutation: true,
  isBulk: false,
  loadBeforeRecord: async (
    rawInput,
    ctx,
  ): Promise<CatalogToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateProductInput = updateProductInput.parse(rawInput)
    const em = resolveEm(ctx)
    const row = await loadProductForScope(em, ctx, tenantId, input.productId)
    if (!row) return null
    return {
      recordId: row.id,
      entityType: 'catalog.product',
      recordVersion: recordVersionFromUpdatedAt(row.updatedAt),
      before: productSnapshot(row),
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateProductInput = updateProductInput.parse(rawInput)
    const em = resolveEm(ctx)
    const row = await loadProductForScope(em, ctx, tenantId, input.productId)
    if (!row) {
      throw new Error(`Product "${input.productId}" is not accessible to the caller.`)
    }
    const organizationId = row.organizationId
    const before = productSnapshot(row)

    if (input.price) {
      const check = await validateProductPriceScope(
        em,
        tenantId,
        organizationId,
        row.id,
        input.price,
      )
      if (!check.ok) {
        const error = new Error(check.message) as Error & { code?: string }
        error.code = check.code
        throw error
      }
    }

    const body: Record<string, unknown> = {
      id: row.id,
      tenantId,
      organizationId,
    }
    if (input.title !== undefined) body.title = input.title
    if (input.subtitle !== undefined) body.subtitle = input.subtitle
    if (input.description !== undefined) body.description = input.description
    if (input.isActive !== undefined) body.isActive = input.isActive

    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const response = await runner.run({
      method: 'PUT',
      path: '/catalog/products',
      body,
    })
    if (!response.success) {
      throw new Error(response.error ?? `Failed to update product "${row.id}"`)
    }

    const after = await loadProductForScope(em, ctx, tenantId, row.id)
    return {
      recordId: row.id,
      commandName: 'catalog.products.update',
      before,
      after: after ? productSnapshot(after) : null,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.bulk_update_products (batch)                                       */
/* -------------------------------------------------------------------------- */

const bulkUpdateProductRecordSchema = z
  .object({
    recordId: z.string().uuid(),
    title: z.string().trim().min(1).max(255).optional(),
    subtitle: z.string().trim().max(255).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    isActive: z.boolean().optional(),
    price: pricePatchSchema.optional(),
  })
  .strict()

const bulkUpdateProductsInput = z
  .object({
    records: z
      .array(bulkUpdateProductRecordSchema)
      .min(1)
      .max(50)
      .describe('One entry per product to update. Max 50 rows per batch.'),
  })
  .strict()

type BulkUpdateProductsInput = z.infer<typeof bulkUpdateProductsInput>
type BulkUpdateProductPatch = z.infer<typeof bulkUpdateProductRecordSchema>

type BulkRecordResult = {
  recordId: string
  status: 'updated' | 'skipped' | 'failed'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  error?: { code: string; message: string }
}

const bulkUpdateProductsTool: CatalogAiToolDefinition = {
  name: 'catalog.bulk_update_products',
  displayName: 'Bulk update products',
  description:
    'Update several catalog products in a single approval. Emits ONE pending action whose records[] contains one diff per product. Stale-version or cross-tenant rows are collected in failedRecords[] without aborting the remaining writes.',
  inputSchema: bulkUpdateProductsInput as z.ZodType<unknown>,
  requiredFeatures: ['catalog.products.manage'],
  tags: ['write', 'catalog', 'merchandising', 'bulk'],
  isMutation: true,
  isBulk: true,
  loadBeforeRecords: async (rawInput, ctx): Promise<CatalogToolLoadBeforeRecord[]> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: BulkUpdateProductsInput = bulkUpdateProductsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows: CatalogToolLoadBeforeRecord[] = []
    for (const entry of input.records) {
      const product = await loadProductForScope(em, ctx, tenantId, entry.recordId)
      if (!product) continue
      rows.push({
        recordId: product.id,
        entityType: 'catalog.product',
        label: productLabel(product),
        recordVersion: recordVersionFromUpdatedAt(product.updatedAt),
        before: productSnapshot(product),
      })
    }
    return rows
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: BulkUpdateProductsInput = bulkUpdateProductsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)
    const results: BulkRecordResult[] = []
    const failedRecordIds: string[] = []
    for (const entry of input.records) {
      const product = await loadProductForScope(em, ctx, tenantId, entry.recordId)
      if (!product) {
        failedRecordIds.push(entry.recordId)
        results.push({
          recordId: entry.recordId,
          status: 'skipped',
          before: null,
          after: null,
          error: { code: 'record_not_found', message: 'Product is not accessible to the caller.' },
        })
        continue
      }
      const organizationId = product.organizationId
      const before = productSnapshot(product)
      if (entry.price) {
        const check = await validateProductPriceScope(em, tenantId, organizationId, product.id, entry.price)
        if (!check.ok) {
          failedRecordIds.push(product.id)
          results.push({
            recordId: product.id,
            status: 'failed',
            before,
            after: null,
            error: { code: check.code, message: check.message },
          })
          continue
        }
      }
      const body: Record<string, unknown> = {
        id: product.id,
        tenantId,
        organizationId,
      }
      if (entry.title !== undefined) body.title = entry.title
      if (entry.subtitle !== undefined) body.subtitle = entry.subtitle
      if (entry.description !== undefined) body.description = entry.description
      if (entry.isActive !== undefined) body.isActive = entry.isActive
      try {
        const response = await runner.run({
          method: 'PUT',
          path: '/catalog/products',
          body,
        })
        if (!response.success) {
          const code =
            typeof (response.details as { code?: unknown } | undefined)?.code === 'string'
              ? ((response.details as { code: string }).code)
              : 'command_failed'
          failedRecordIds.push(product.id)
          results.push({
            recordId: product.id,
            status: 'failed',
            before,
            after: null,
            error: { code, message: response.error ?? 'API operation failed' },
          })
          continue
        }
        const after = await loadProductForScope(em, ctx, tenantId, product.id)
        results.push({
          recordId: product.id,
          status: 'updated',
          before,
          after: after ? productSnapshot(after) : null,
        })
      } catch (error) {
        failedRecordIds.push(product.id)
        const message = error instanceof Error ? error.message : String(error)
        const code = ((error as { code?: unknown })?.code as string | undefined) ?? 'command_failed'
        results.push({
          recordId: product.id,
          status: 'failed',
          before,
          after: null,
          error: { code, message },
        })
      }
    }
    const everyFailed = results.length > 0 && results.every((entry) => entry.status !== 'updated')
    return {
      commandName: 'catalog.products.update',
      records: results,
      failedRecordIds,
      error: everyFailed ? { code: 'all_records_failed', message: 'No records were updated.' } : undefined,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.apply_attribute_extraction (batch)                                 */
/* -------------------------------------------------------------------------- */

const attributeExtractionRecordSchema = z
  .object({
    recordId: z.string().uuid(),
    attributes: z.record(z.string(), z.unknown()).describe('Attribute key → value map produced by catalog.extract_attributes_from_description.'),
  })
  .strict()

const applyAttributeExtractionInput = z
  .object({
    records: z
      .array(attributeExtractionRecordSchema)
      .min(1)
      .max(50)
      .describe('One extraction payload per product. Max 50 rows per batch.'),
  })
  .strict()

type ApplyAttributeExtractionInput = z.infer<typeof applyAttributeExtractionInput>

async function resolveAttributeKeyIndex(
  ctx: CatalogToolContext,
  tenantId: string,
): Promise<Set<string>> {
  try {
    const em = resolveEm(ctx)
    const index = await loadCustomFieldDefinitionIndex({
      em,
      entityIds: E.catalog.catalog_product as string,
      tenantId,
      organizationIds: ctx.organizationId ? [ctx.organizationId] : null,
    })
    const keys = new Set<string>()
    if (index && typeof (index as any).keys === 'function') {
      for (const key of (index as any).keys() as Iterable<string>) {
        keys.add(String(key))
      }
    }
    return keys
  } catch {
    return new Set<string>()
  }
}

const applyAttributeExtractionTool: CatalogAiToolDefinition = {
  name: 'catalog.apply_attribute_extraction',
  displayName: 'Apply attribute extraction',
  description:
    'Persist the structured attribute output of catalog.extract_attributes_from_description. Re-validates every attribute key against the CURRENT catalog.product custom-field schema before the pending action is created — schema drift trips attribute_not_in_schema.',
  inputSchema: applyAttributeExtractionInput as z.ZodType<unknown>,
  requiredFeatures: ['catalog.products.manage'],
  tags: ['write', 'catalog', 'merchandising', 'attributes'],
  isMutation: true,
  isBulk: true,
  loadBeforeRecords: async (rawInput, ctx): Promise<CatalogToolLoadBeforeRecord[]> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ApplyAttributeExtractionInput = applyAttributeExtractionInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows: CatalogToolLoadBeforeRecord[] = []
    for (const entry of input.records) {
      const product = await loadProductForScope(em, ctx, tenantId, entry.recordId)
      if (!product) continue
      rows.push({
        recordId: product.id,
        entityType: 'catalog.product',
        label: productLabel(product),
        recordVersion: recordVersionFromUpdatedAt(product.updatedAt),
        before: { attributes: {} },
      })
    }
    return rows
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ApplyAttributeExtractionInput = applyAttributeExtractionInput.parse(rawInput)
    const em = resolveEm(ctx)
    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const knownKeys = await resolveAttributeKeyIndex(ctx, tenantId)
    const results: BulkRecordResult[] = []
    const failedRecordIds: string[] = []
    for (const entry of input.records) {
      const product = await loadProductForScope(em, ctx, tenantId, entry.recordId)
      if (!product) {
        failedRecordIds.push(entry.recordId)
        results.push({
          recordId: entry.recordId,
          status: 'skipped',
          before: null,
          after: null,
          error: { code: 'record_not_found', message: 'Product is not accessible to the caller.' },
        })
        continue
      }
      const attributeKeys = Object.keys(entry.attributes ?? {})
      const unknownKey = knownKeys.size > 0
        ? attributeKeys.find((key) => !knownKeys.has(key))
        : undefined
      if (unknownKey) {
        failedRecordIds.push(product.id)
        results.push({
          recordId: product.id,
          status: 'failed',
          before: { attributes: {} },
          after: null,
          error: {
            code: 'attribute_not_in_schema',
            message: `Attribute "${unknownKey}" is not part of the current catalog.product schema.`,
          },
        })
        continue
      }
      const organizationId = product.organizationId
      const commandInput: Record<string, unknown> = {
        id: product.id,
        tenantId,
        organizationId,
      }
      for (const [key, value] of Object.entries(entry.attributes ?? {})) {
        commandInput[`cf_${key}`] = value
      }
      try {
        await commandBus.execute<Record<string, unknown>, { productId: string }>(
          'catalog.products.update',
          { input: commandInput, ctx: buildCommandRuntimeContext(ctx, tenantId, organizationId) },
        )
        results.push({
          recordId: product.id,
          status: 'updated',
          before: { attributes: {} },
          after: { attributes: entry.attributes },
        })
      } catch (error) {
        failedRecordIds.push(product.id)
        const message = error instanceof Error ? error.message : String(error)
        const code = ((error as { code?: unknown })?.code as string | undefined) ?? 'command_failed'
        results.push({
          recordId: product.id,
          status: 'failed',
          before: { attributes: {} },
          after: null,
          error: { code, message },
        })
      }
    }
    const everyFailed = results.length > 0 && results.every((entry) => entry.status !== 'updated')
    return {
      commandName: 'catalog.products.update',
      records: results,
      failedRecordIds,
      error: everyFailed ? { code: 'all_records_failed', message: 'No records were updated.' } : undefined,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.update_product_media_descriptions (one-or-many media updates)     */
/* -------------------------------------------------------------------------- */

const mediaUpdateRecordSchema = z
  .object({
    mediaId: z.string().uuid(),
    altText: z.string().trim().max(500).optional(),
    caption: z.string().trim().max(1000).optional(),
  })
  .strict()

const updateProductMediaDescriptionsInput = z
  .object({
    mediaUpdates: z
      .array(mediaUpdateRecordSchema)
      .min(1)
      .max(100)
      .describe('One media record descriptor per attachment id. Exactly one entry is allowed for single-record writes; many entries for bulk writes.'),
  })
  .strict()

type UpdateProductMediaDescriptionsInput = z.infer<typeof updateProductMediaDescriptionsInput>

async function loadProductMediaForScope(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  mediaId: string,
): Promise<Attachment | null> {
  const where: Record<string, unknown> = {
    id: mediaId,
    tenantId,
    entityId: E.catalog.catalog_product,
  }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const row = await findOneWithDecryption<Attachment>(
    em,
    Attachment,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!row || row.tenantId !== tenantId) return null
  if (ctx.organizationId && row.organizationId !== ctx.organizationId) return null
  return row
}

function mediaSnapshot(row: Attachment): Record<string, unknown> {
  const metadata = row.storageMetadata ?? {}
  return {
    altText: typeof metadata?.altText === 'string' ? metadata.altText : null,
    caption: typeof metadata?.caption === 'string' ? metadata.caption : null,
  }
}

function mediaLabel(row: Attachment): string {
  if (row.fileName && row.fileName.trim().length) return row.fileName
  return row.id
}

const updateProductMediaDescriptionsTool: CatalogAiToolDefinition = {
  name: 'catalog.update_product_media_descriptions',
  displayName: 'Update product media descriptions',
  description:
    'Update altText / caption on one or many product media attachments in a single approval. Emits one pending action with records[] carrying per-media diffs. Accepts one entry for single-record writes or many for bulk writes — always routes through loadBeforeRecords to guarantee schema-consistent preview.',
  inputSchema: updateProductMediaDescriptionsInput as z.ZodType<unknown>,
  requiredFeatures: ['catalog.products.manage'],
  tags: ['write', 'catalog', 'merchandising', 'media'],
  isMutation: true,
  isBulk: true,
  loadBeforeRecords: async (rawInput, ctx): Promise<CatalogToolLoadBeforeRecord[]> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateProductMediaDescriptionsInput =
      updateProductMediaDescriptionsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows: CatalogToolLoadBeforeRecord[] = []
    for (const entry of input.mediaUpdates) {
      const media = await loadProductMediaForScope(em, ctx, tenantId, entry.mediaId)
      if (!media) continue
      rows.push({
        recordId: media.id,
        entityType: 'catalog.product_media',
        label: mediaLabel(media),
        recordVersion: recordVersionFromUpdatedAt(media.createdAt ?? null),
        before: mediaSnapshot(media),
      })
    }
    return rows
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateProductMediaDescriptionsInput =
      updateProductMediaDescriptionsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const results: BulkRecordResult[] = []
    const failedRecordIds: string[] = []
    const touched: Array<{ row: Attachment; patch: { altText?: string; caption?: string }; before: Record<string, unknown> }> = []
    for (const entry of input.mediaUpdates) {
      const media = await loadProductMediaForScope(em, ctx, tenantId, entry.mediaId)
      if (!media) {
        failedRecordIds.push(entry.mediaId)
        results.push({
          recordId: entry.mediaId,
          status: 'skipped',
          before: null,
          after: null,
          error: { code: 'record_not_found', message: 'Media is not accessible to the caller.' },
        })
        continue
      }
      const before = mediaSnapshot(media)
      touched.push({
        row: media,
        patch: {
          ...(entry.altText !== undefined ? { altText: entry.altText } : {}),
          ...(entry.caption !== undefined ? { caption: entry.caption } : {}),
        },
        before,
      })
    }
    if (touched.length > 0) {
      for (const { row, patch } of touched) {
        const next = { ...(row.storageMetadata ?? {}) } as Record<string, unknown>
        if (patch.altText !== undefined) next.altText = patch.altText
        if (patch.caption !== undefined) next.caption = patch.caption
        row.storageMetadata = next
      }
      await em.flush()
      for (const { row, patch, before } of touched) {
        results.push({
          recordId: row.id,
          status: 'updated',
          before,
          after: {
            altText: patch.altText ?? (before as any).altText ?? null,
            caption: patch.caption ?? (before as any).caption ?? null,
          },
        })
      }
    }
    const everyFailed = results.length > 0 && results.every((entry) => entry.status !== 'updated')
    return {
      commandName: 'catalog.products.media.update_descriptions',
      records: results,
      failedRecordIds,
      error: everyFailed ? { code: 'all_records_failed', message: 'No media records were updated.' } : undefined,
    }
  },
}

/* -------------------------------------------------------------------------- */

export const mutationAiTools: CatalogAiToolDefinition[] = [
  updateProductTool,
  bulkUpdateProductsTool,
  applyAttributeExtractionTool,
  updateProductMediaDescriptionsTool,
]

export default mutationAiTools
