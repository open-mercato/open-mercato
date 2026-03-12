import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DataSyncAdapter, DataMapping, ImportBatch, ImportItem, ValidationResult } from '@open-mercato/core/modules/data_sync/lib/adapter'
import { buildListResumeCursor, buildProductResumeCursor, parseCursor } from './cursor'
import { createAkeneoClient } from './client'
import { createAkeneoImporter } from './catalog-importer'
import { loadAkeneoMapping } from './mapping'
import { buildDefaultReconciliationSettings, normalizeAkeneoMapping, type AkeneoEntityType, type AkeneoDataMapping } from './shared'

function assertEntityType(entityType: string): AkeneoEntityType {
  if (entityType === 'categories' || entityType === 'attributes' || entityType === 'products') {
    return entityType
  }
  throw new Error(`Unsupported Akeneo entity type: ${entityType}`)
}

async function resolveMapping(entityType: AkeneoEntityType, scope: { organizationId: string; tenantId: string }): Promise<AkeneoDataMapping> {
  const container = await createRequestContainer()
  const em = container.resolve('em')
  return loadAkeneoMapping(em, entityType, scope)
}

export const akeneoDataSyncAdapter: DataSyncAdapter = {
  providerKey: 'akeneo',
  direction: 'import',
  supportedEntities: ['categories', 'attributes', 'products'],

  async getMapping(input): Promise<DataMapping> {
    const entityType = assertEntityType(input.entityType)
    return resolveMapping(entityType, input.scope)
  },

  async validateConnection(input): Promise<ValidationResult> {
    try {
      const entityType = assertEntityType(input.entityType)
      const client = createAkeneoClient(input.credentials)
      if (entityType === 'products') {
        await client.listProducts({ batchSize: 1 })
      } else if (entityType === 'categories') {
        await client.listCategories(null, 1)
      } else {
        await client.listFamilies(null, 1)
      }

      const discovery = await client.collectDiscoveryData().catch(() => null)
      return {
        ok: true,
        message: 'Akeneo connection validated successfully',
        details: discovery
          ? {
              locales: discovery.locales.length,
              channels: discovery.channels.length,
              attributes: discovery.attributes.length,
              families: discovery.families.length,
              version: discovery.version,
            }
          : undefined,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Akeneo validation failed',
      }
    }
  },

  async *streamImport(input): AsyncIterable<ImportBatch> {
    const entityType = assertEntityType(input.entityType)
    const mapping = normalizeAkeneoMapping(entityType, input.mapping as unknown as Record<string, unknown>)
    const client = createAkeneoClient(input.credentials)
    const importer = await createAkeneoImporter(client, input.scope)

    if (entityType === 'categories') {
      let batchIndex = 0
      let nextUrl = parseCursor(input.cursor)?.nextUrl ?? null
      const safeFullSync = !input.cursor
      const seenCategoryIds = new Set<string>()
      const reconciliation = buildDefaultReconciliationSettings()
      do {
        const page = await client.listCategories(nextUrl, input.batchSize)
        const items: ImportItem[] = []
        const locale = mapping.settings?.categories?.locale ?? 'en_US'
        for (const category of page.items) {
          seenCategoryIds.add(category.code)
          const result = await importer.upsertCategory(category, locale)
          items.push({
            externalId: category.code,
            data: {
              localId: result.localId,
              code: category.code,
              parent: category.parent ?? null,
            },
            action: result.action,
          })
        }
        nextUrl = page.nextUrl
        yield {
          items,
          cursor: buildListResumeCursor(nextUrl),
          hasMore: Boolean(nextUrl),
          totalEstimate: page.totalEstimate ?? undefined,
          processedCount: page.items.length,
          batchIndex,
        }
        batchIndex += 1
      } while (nextUrl)
      if (safeFullSync) {
        const locale = mapping.settings?.categories?.locale ?? 'en_US'
        await importer.reconcileCategories(seenCategoryIds, locale, reconciliation)
      }
      return
    }

    if (entityType === 'attributes') {
      const productMapping = await resolveMapping('products', input.scope)
      let batchIndex = 0
      let nextUrl = parseCursor(input.cursor)?.nextUrl ?? null
      const safeFullSync = !input.cursor
      const seenFamilyIds = new Set<string>()
      const reconciliation = buildDefaultReconciliationSettings()
      const locale = productMapping.settings?.products?.locale
        ?? mapping.settings?.categories?.locale
        ?? 'en_US'
      const customFieldItems = await importer.syncMappedCustomFields(productMapping, locale)
      const currentCustomFieldKeys = new Set(
        customFieldItems
          .map((item) => {
            const key = typeof item.data.key === 'string' ? item.data.key : null
            const target = item.data.target === 'variant' ? 'catalog:catalog_product_variant' : item.data.target === 'product' ? 'catalog:catalog_product' : null
            return key && target ? `${target}:${key}` : null
          })
          .filter((value): value is string => Boolean(value)),
      )
      do {
        const page = await client.listFamilies(nextUrl, input.batchSize)
        const items: ImportItem[] = []
        const includeTextAttributes = mapping.settings?.attributes?.includeTextAttributes ?? true
        const includeNumericAttributes = mapping.settings?.attributes?.includeNumericAttributes ?? true
        const familyFilter = mapping.settings?.attributes?.familyCodeFilter ?? []
        if (batchIndex === 0) {
          customFieldItems.forEach((item) => {
            items.push(item)
          })
        }
        for (const family of page.items) {
          if (familyFilter.length > 0 && !familyFilter.includes(family.code)) continue
          seenFamilyIds.add(family.code)
          const result = await importer.upsertAttributeFamily(
            family,
            locale,
            includeTextAttributes,
            includeNumericAttributes,
          )
          if (!result) continue
          items.push({
            externalId: family.code,
            data: {
              localId: result.localId,
              familyCode: family.code,
            },
            action: result.action,
          })
        }
        nextUrl = page.nextUrl
        yield {
          items,
          cursor: buildListResumeCursor(nextUrl),
          hasMore: Boolean(nextUrl),
          totalEstimate: page.totalEstimate ?? undefined,
          processedCount: page.items.length,
          batchIndex,
        }
        batchIndex += 1
      } while (nextUrl)
      if (safeFullSync) {
        await importer.reconcileMappedCustomFieldFieldsets(productMapping)
        await importer.reconcileAttributes({
          seenFamilyExternalIds: seenFamilyIds,
          currentCustomFieldKeys,
          reconciliation,
        })
      }
      return
    }

    let batchIndex = 0
    const currentCursor = parseCursor(input.cursor)
    let nextUrl = currentCursor?.nextUrl ?? null
    let updatedAfter = currentCursor?.updatedAfter ?? null
    let maxUpdatedAt = currentCursor?.maxUpdatedAt ?? updatedAfter
    const safeFullSync = !input.cursor
    const seenProductExternalIds = new Set<string>()
    const seenVariantExternalIds = new Set<string>()
    const reconciliation = mapping.settings?.products?.reconciliation ?? buildDefaultReconciliationSettings()

    do {
      const productPageSize = Math.min(Math.max(input.batchSize, 1), 10)
      const page = await client.listProducts({
        nextUrl,
        batchSize: productPageSize,
        updatedAfter,
      })

      const items: ImportItem[] = []
      for (const product of page.items) {
        try {
          const imported = await importer.upsertProduct(product, mapping)
          for (const item of imported) {
            if (item.data.localProductId) seenProductExternalIds.add(item.externalId)
            if (item.data.localVariantId) seenVariantExternalIds.add(item.externalId)
            items.push(item)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Akeneo product import failed'
          items.push({
            externalId: product.parent ? `${product.parent}:${product.uuid}` : product.uuid,
            action: 'failed',
            data: {
              errorMessage: message,
              sourceProductUuid: product.uuid,
              sourceIdentifier: product.identifier ?? null,
              sourceParentCode: product.parent ?? null,
              family: product.family ?? null,
            },
          })
        }
        if (typeof product.updated === 'string' && (!maxUpdatedAt || product.updated > maxUpdatedAt)) {
          maxUpdatedAt = product.updated
        }
      }

      nextUrl = page.nextUrl
      const nextCursor = nextUrl
        ? buildProductResumeCursor({
            updatedAfter,
            nextUrl,
            maxUpdatedAt,
          })
        : buildProductResumeCursor({
            updatedAfter: maxUpdatedAt ?? updatedAfter,
            nextUrl: null,
            maxUpdatedAt: null,
          })

      yield {
        items,
        cursor: nextCursor,
        hasMore: Boolean(nextUrl),
        totalEstimate: page.totalEstimate ?? undefined,
        processedCount: page.items.length,
        refreshCoverageEntityTypes: [
          'catalog:catalog_product',
          'catalog:catalog_product_variant',
        ],
        batchIndex,
      }
      batchIndex += 1

      if (!nextUrl && maxUpdatedAt) {
        updatedAfter = maxUpdatedAt
      }
    } while (nextUrl)

    if (safeFullSync) {
      yield {
        items: [],
        cursor: buildProductResumeCursor({
          updatedAfter: maxUpdatedAt ?? updatedAfter,
          nextUrl: null,
          maxUpdatedAt: null,
        }),
        hasMore: false,
        totalEstimate: undefined,
        processedCount: 0,
        message: 'Reconciling imported Akeneo products after the final batch',
        batchIndex,
      }
      await importer.reconcileMappedCustomFieldFieldsets(mapping)
      await importer.reconcileProducts(seenProductExternalIds, seenVariantExternalIds, reconciliation)
    }
  },
}
