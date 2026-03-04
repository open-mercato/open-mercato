import type { DataSyncAdapter, DataMapping, ImportBatch, StreamImportInput, ValidationResult } from '../../data_sync/lib/adapter'

function buildDefaultMapping(entityType: string): DataMapping {
  if (entityType === 'catalog.product') {
    return {
      entityType,
      matchStrategy: 'sku',
      matchField: 'sku',
      fields: [
        { externalField: 'title', localField: 'name' },
        { externalField: 'description', localField: 'description' },
        { externalField: 'sku', localField: 'sku' },
      ],
    }
  }

  return {
    entityType,
    matchStrategy: 'externalId',
    fields: [
      { externalField: 'id', localField: 'externalId' },
    ],
  }
}

async function* mockImportStream(input: StreamImportInput): AsyncIterable<ImportBatch> {
  const baseCursor = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0
  const current = baseCursor + input.batchSize

  yield {
    items: [],
    cursor: String(current),
    hasMore: false,
    totalEstimate: 0,
    batchIndex: 1,
  }
}

function alwaysValid(): ValidationResult {
  return { ok: true, message: 'Connection validated' }
}

export const medusaProductsAdapter: DataSyncAdapter = {
  providerKey: 'medusa_products',
  direction: 'bidirectional',
  supportedEntities: ['catalog.product'],
  streamImport: mockImportStream,
  getMapping: async ({ entityType }) => buildDefaultMapping(entityType),
  validateConnection: async () => alwaysValid(),
}

export const medusaOrdersAdapter: DataSyncAdapter = {
  providerKey: 'medusa_orders',
  direction: 'bidirectional',
  supportedEntities: ['sales.order'],
  streamImport: mockImportStream,
  getMapping: async ({ entityType }) => buildDefaultMapping(entityType),
  validateConnection: async () => alwaysValid(),
}
