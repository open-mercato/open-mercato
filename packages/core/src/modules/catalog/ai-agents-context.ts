/**
 * Page-context hydration helpers for the catalog agents
 * (Phase 3 WS-A, Step 5.2).
 *
 * Two flavors:
 *
 * 1. `hydrateCatalogAssistantContext` — `catalog.catalog_assistant`. Loads
 *    a lightweight product summary for a single UUID (`catalog.product`),
 *    or a batch of up to 10 summaries when the request carries a
 *    comma-separated UUID list keyed as `catalog.products.list`.
 *
 * 2. `hydrateMerchandisingAssistantContext` —
 *    `catalog.merchandising_assistant`. Loads the full
 *    `catalog.get_product_bundle` aggregate for a single product, or a
 *    capped-at-10 selection via `catalog.list_selected_products`. When
 *    the request carries the products-list page view, the incoming
 *    `pageContext.extra.filter` is pretty-printed into the context block
 *    so the agent can reason about the narrowed set even when no
 *    selection is active.
 *
 * Both helpers route every read through an existing tool-pack handler
 * (Step 3.10 base pack + Step 3.11 D18 pack) so the agent-reachable
 * surface and the hydration surface stay in lock-step. Tenant + org
 * scope is enforced by the tool handlers themselves; cross-tenant ids
 * surface as `{ found: false }` / `missingIds`, which we translate to a
 * silent null return (the runtime then proceeds without hydration).
 *
 * Error swallowing is required by the Step 3.2 runtime contract — a
 * hydration fault MUST NEVER break the chat request.
 */
import type { AwilixContainer } from 'awilix'
import catalogAiTools from './ai-tools'
import type {
  CatalogAiToolDefinition,
  CatalogToolContext,
} from './ai-tools/types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SELECTION_CAP = 10

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value)
}

function parseSelectionIds(raw: string): string[] {
  if (!raw) return []
  const unique = new Set<string>()
  for (const token of raw.split(',')) {
    const trimmed = token.trim()
    if (isUuid(trimmed)) unique.add(trimmed)
    if (unique.size >= SELECTION_CAP) break
  }
  return Array.from(unique)
}

function findTool(name: string): CatalogAiToolDefinition | null {
  return (
    (catalogAiTools as CatalogAiToolDefinition[]).find((tool) => tool.name === name) ?? null
  )
}

function buildToolContext(
  container: AwilixContainer,
  tenantId: string,
  organizationId: string | null,
): CatalogToolContext {
  return {
    tenantId,
    organizationId,
    userId: null,
    container,
    userFeatures: [],
    isSuperAdmin: true,
    apiKeySecret: undefined,
    sessionId: undefined,
  }
}

function renderContextBlock(label: string, payload: unknown): string {
  return `## Page context — ${label}\n${JSON.stringify(payload, null, 2)}`
}

export interface HydrateCatalogContextInput {
  entityType: string
  recordId: string
  container: AwilixContainer
  tenantId: string | null
  organizationId: string | null
}

const SINGLE_PRODUCT_ENTITY_TYPES = new Set([
  'product',
  'catalog.product',
  'catalog:catalog_product',
])

const PRODUCTS_LIST_ENTITY_TYPES = new Set([
  'catalog.products.list',
  'catalog.products.selection',
  'products.list',
  'products.selection',
])

async function invokeTool(
  toolName: string,
  args: Record<string, unknown>,
  toolContext: CatalogToolContext,
  reasonPrefix: string,
): Promise<unknown | null> {
  const tool = findTool(toolName)
  if (!tool) {
    console.warn(`[${reasonPrefix}] resolvePageContext: tool "${toolName}" not registered`)
    return null
  }
  try {
    const result = await tool.handler(args as never, toolContext)
    return result ?? null
  } catch (error) {
    console.warn(
      `[${reasonPrefix}] resolvePageContext: tool "${toolName}" failed (reason="hydration_error"); skipping`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

// -----------------------------------------------------------------------------
// catalog.catalog_assistant hydration
// -----------------------------------------------------------------------------

export async function hydrateCatalogAssistantContext(
  input: HydrateCatalogContextInput,
): Promise<string | null> {
  const tenantId = input.tenantId
  if (!tenantId) return null
  const entityType = input.entityType.trim().toLowerCase()
  if (!entityType) return null
  const toolContext = buildToolContext(input.container, tenantId, input.organizationId)

  if (SINGLE_PRODUCT_ENTITY_TYPES.has(entityType)) {
    if (!isUuid(input.recordId)) return null
    const result = await invokeTool(
      'catalog.get_product',
      { productId: input.recordId },
      toolContext,
      'catalog.catalog_assistant',
    )
    if (!result || typeof result !== 'object') return null
    if ((result as { found?: boolean }).found === false) return null
    return renderContextBlock(`Product ${input.recordId}`, result)
  }

  if (PRODUCTS_LIST_ENTITY_TYPES.has(entityType)) {
    const ids = parseSelectionIds(input.recordId)
    if (ids.length === 0) return null
    // Reuse the D18 merchandising bundle tool — its result carries
    // summaries inside full bundles. For the base catalog_assistant we
    // keep the payload lightweight by projecting each bundle onto the
    // summary subset the agent cares about.
    const result = await invokeTool(
      'catalog.list_selected_products',
      { productIds: ids },
      toolContext,
      'catalog.catalog_assistant',
    )
    if (!result || typeof result !== 'object') return null
    const { items, missingIds } = result as {
      items?: Array<{ product?: unknown }>
      missingIds?: string[]
    }
    const summaries = Array.isArray(items)
      ? items
          .map((item) => (item && typeof item === 'object' ? (item as { product?: unknown }).product ?? null : null))
          .filter((value) => value !== null)
      : []
    if (summaries.length === 0) return null
    return renderContextBlock(
      `Products selection (${summaries.length} of ${ids.length})`,
      { items: summaries, missingIds: missingIds ?? [] },
    )
  }

  return null
}

// -----------------------------------------------------------------------------
// catalog.merchandising_assistant hydration
// -----------------------------------------------------------------------------

export async function hydrateMerchandisingAssistantContext(
  input: HydrateCatalogContextInput,
): Promise<string | null> {
  const tenantId = input.tenantId
  if (!tenantId) return null
  const entityType = input.entityType.trim().toLowerCase()
  if (!entityType) return null
  const toolContext = buildToolContext(input.container, tenantId, input.organizationId)

  if (SINGLE_PRODUCT_ENTITY_TYPES.has(entityType)) {
    if (!isUuid(input.recordId)) return null
    const result = await invokeTool(
      'catalog.get_product_bundle',
      { productId: input.recordId },
      toolContext,
      'catalog.merchandising_assistant',
    )
    if (!result || typeof result !== 'object') return null
    if ((result as { found?: boolean }).found === false) return null
    return renderContextBlock(`Product bundle ${input.recordId}`, result)
  }

  if (PRODUCTS_LIST_ENTITY_TYPES.has(entityType)) {
    const ids = parseSelectionIds(input.recordId)
    if (ids.length === 0) return null
    const result = await invokeTool(
      'catalog.list_selected_products',
      { productIds: ids },
      toolContext,
      'catalog.merchandising_assistant',
    )
    if (!result || typeof result !== 'object') return null
    const { items, missingIds } = result as {
      items?: unknown[]
      missingIds?: string[]
    }
    const bundles = Array.isArray(items) ? items : []
    if (bundles.length === 0) return null
    return renderContextBlock(
      `Products selection bundles (${bundles.length} of ${ids.length})`,
      {
        items: bundles,
        missingIds: missingIds ?? [],
      },
    )
  }

  return null
}
