/**
 * `catalog.list_option_schemas` + `catalog.list_unit_conversions` (Phase 1
 * WS-C, Step 3.10).
 *
 * Product-configuration surface: option schemas (variant axes) and unit
 * conversions (UoM factors).
 *
 * Phase 3c of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * both tools are now API-backed wrappers over the documented CRUD list
 * routes (`GET /api/catalog/option-schemas` and
 * `GET /api/catalog/product-unit-conversions`). Tool names, schemas,
 * requiredFeatures, and output shapes are unchanged.
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type {
  AiApiOperationRequest,
  AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

const listOptionSchemasInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

type ListOptionSchemasInput = z.infer<typeof listOptionSchemasInput>

type ListOptionSchemasApiItem = {
  id?: string
  code?: string | null
  name?: string | null
  description?: string | null
  schema?: unknown
  metadata?: unknown
  is_active?: boolean | null
  isActive?: boolean | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListOptionSchemasApiResponse = {
  items?: ListOptionSchemasApiItem[]
  total?: number
}

type ListOptionSchemasOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listOptionSchemasTool = defineApiBackedAiTool<
  ListOptionSchemasInput,
  ListOptionSchemasApiResponse,
  ListOptionSchemasOutput
>({
  name: 'catalog.list_option_schemas',
  displayName: 'List option schemas',
  description:
    'List product option schemas (variant axes, e.g. size/color definitions) for the caller tenant + organization.',
  inputSchema: listOptionSchemasInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1
    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/option-schemas',
      query: { page, pageSize: limit },
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListOptionSchemasApiResponse
    const rawItems: ListOptionSchemasApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description ?? null,
          schema: row.schema,
          metadata: row.metadata ?? null,
          isActive: !!(row.is_active ?? row.isActive),
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

const listUnitConversionsInput = z
  .object({
    productId: z.string().uuid().optional().describe('Restrict to unit conversions for this product.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

type ListUnitConversionsInput = z.infer<typeof listUnitConversionsInput>

type ListUnitConversionsApiItem = {
  id?: string
  product_id?: string | null
  productId?: string | null
  unit_code?: string | null
  unitCode?: string | null
  to_base_factor?: string | number | null
  toBaseFactor?: string | number | null
  sort_order?: number | null
  sortOrder?: number | null
  is_active?: boolean | null
  isActive?: boolean | null
  metadata?: unknown
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListUnitConversionsApiResponse = {
  items?: ListUnitConversionsApiItem[]
  total?: number
}

type ListUnitConversionsOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listUnitConversionsTool = defineApiBackedAiTool<
  ListUnitConversionsInput,
  ListUnitConversionsApiResponse,
  ListUnitConversionsOutput
>({
  name: 'catalog.list_unit_conversions',
  displayName: 'List unit conversions',
  description:
    'List product unit conversions (alternate units with `toBaseFactor`) for the caller tenant + organization. Optionally narrow by product.',
  inputSchema: listUnitConversionsInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1
    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.productId) query.productId = input.productId
    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/product-unit-conversions',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListUnitConversionsApiResponse
    const rawItems: ListUnitConversionsApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        const toBaseFactor = row.to_base_factor ?? row.toBaseFactor ?? null
        return {
          id: row.id,
          unitCode: row.unit_code ?? row.unitCode ?? null,
          toBaseFactor: toBaseFactor === null ? null : String(toBaseFactor),
          sortOrder: row.sort_order ?? row.sortOrder ?? 0,
          isActive: !!(row.is_active ?? row.isActive),
          productId: row.product_id ?? row.productId ?? null,
          metadata: row.metadata ?? null,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

export const configurationAiTools: CatalogAiToolDefinition[] = [
  listOptionSchemasTool,
  listUnitConversionsTool,
]

export default configurationAiTools
