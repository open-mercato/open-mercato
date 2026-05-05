/**
 * Step 5.16 — Phase 3 WS-D integration tests for the catalog page-context
 * hydration helpers.
 *
 * Exercises both catalog agents:
 *
 *   1. `catalog.catalog_assistant.resolvePageContext` — products-list
 *      selection (comma-separated UUIDs) hydrates lightweight summaries
 *      projected from the Step 3.11 `catalog.list_selected_products` tool,
 *      capped at SELECTION_CAP (10).
 *   2. `catalog.merchandising_assistant.resolvePageContext` — same
 *      selection path yields full product bundles (not summaries), still
 *      capped at 10. Cross-tenant ids are silently dropped by the tool via
 *      `missingIds`; the helper surfaces the remaining hydrated items
 *      without surfacing the missing ones to the agent prompt as records.
 *
 * Mock boundary matches the Step 5.2 convention — the tool pack is mocked
 * at the `../ai-tools` import seam so this stays in-process, no DI, no DB.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

const VALID_UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const VALID_UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const VALID_UUID_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

type HydrateInput = {
  entityType: string
  recordId: string
  container: unknown
  tenantId: string | null
  organizationId: string | null
}

function buildFakeContainer() {
  return {
    resolve: (name: string) => (name === 'em' ? { count: jest.fn() } : null),
  }
}

async function loadHelpers(
  toolName: string,
  handler: jest.Mock,
): Promise<{
  hydrateCatalogAssistantContext: (input: HydrateInput) => Promise<string | null>
  hydrateMerchandisingAssistantContext: (input: HydrateInput) => Promise<string | null>
}> {
  jest.doMock('../ai-tools', () => ({
    __esModule: true,
    default: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
    aiTools: [
      {
        name: toolName,
        description: 'mock',
        inputSchema: { parse: (value: unknown) => value },
        handler,
      },
    ],
  }))
  return (await import('../ai-agents-context')) as unknown as {
    hydrateCatalogAssistantContext: (input: HydrateInput) => Promise<string | null>
    hydrateMerchandisingAssistantContext: (input: HydrateInput) => Promise<string | null>
  }
}

describe('Step 5.16 — catalog.catalog_assistant.resolvePageContext (integration)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('hydrates a products-list selection (comma-separated ids) and projects summaries', async () => {
    const handler = jest.fn(async (args: { productIds: string[] }) => ({
      items: args.productIds.map((productId) => ({
        found: true,
        product: { id: productId, title: `title-${productId.slice(0, 4)}` },
      })),
      missingIds: [],
    }))
    const { hydrateCatalogAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    const result = await hydrateCatalogAssistantContext({
      entityType: 'catalog.products.list',
      recordId: `${VALID_UUID_A},${VALID_UUID_B}`,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({
      productIds: [VALID_UUID_A, VALID_UUID_B],
    })
    expect(result).toContain('Products selection (2 of 2)')
    expect(result).toContain('title-aaaa')
    expect(result).toContain('title-bbbb')
  })

  it('caps the products-list selection at 10 UUIDs (drops the rest)', async () => {
    // Spec §10 + Step 5.2: SELECTION_CAP = 10. Anything beyond the cap is
    // dropped before the tool is invoked, which guarantees the payload
    // feeding the model's system prompt stays bounded regardless of how
    // large the operator's selection is.
    const ids = Array.from({ length: 15 }, (_unused, index) => {
      const hex = index.toString(16).padStart(2, '0')
      return `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${hex}`
    })
    const handler = jest.fn(async (args: { productIds: string[] }) => ({
      items: args.productIds.map((productId) => ({
        found: true,
        product: { id: productId, title: `p-${productId.slice(-4)}` },
      })),
      missingIds: [],
    }))
    const { hydrateCatalogAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    await hydrateCatalogAssistantContext({
      entityType: 'catalog.products.list',
      recordId: ids.join(','),
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].productIds).toHaveLength(10)
  })
})

describe('Step 5.16 — catalog.merchandising_assistant.resolvePageContext (integration)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('hydrates full product bundles for a comma-separated selection', async () => {
    const handler = jest.fn(async (args: { productIds: string[] }) => ({
      items: args.productIds.map((productId) => ({
        found: true,
        product: { id: productId, title: `bundle-${productId.slice(0, 4)}` },
        categories: [{ id: 'cat-1' }],
        prices: { base: [{ kind: 'retail' }] },
        media: [],
      })),
      missingIds: [],
    }))
    const { hydrateMerchandisingAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.products.list',
      recordId: `${VALID_UUID_A},${VALID_UUID_B}`,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toContain('Products selection bundles (2 of 2)')
    expect(result).toContain('bundle-aaaa')
    // Bundle shape preserved (vs. catalog_assistant which projects summaries):
    expect(result).toContain('categories')
    expect(result).toContain('prices')
  })

  it('caps the merchandising selection at 10 UUIDs', async () => {
    const ids = Array.from({ length: 12 }, (_unused, index) => {
      const hex = index.toString(16).padStart(2, '0')
      return `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${hex}`
    })
    const handler = jest.fn(async (args: { productIds: string[] }) => ({
      items: args.productIds.map((productId) => ({
        found: true,
        product: { id: productId },
      })),
      missingIds: [],
    }))
    const { hydrateMerchandisingAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.products.list',
      recordId: ids.join(','),
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].productIds).toHaveLength(10)
  })

  it('silently drops cross-tenant ids returned as missingIds from the tool', async () => {
    // The tool layer enforces tenant isolation through
    // `findOneWithDecryption` + query scoping: cross-tenant ids simply do
    // not appear in the `items` array. The helper renders the surviving
    // bundle count, surfacing the missing-id list on the context payload
    // so the agent can tell the operator which ids were not reachable
    // (without ever exposing their existence / tenant membership).
    const handler = jest.fn(async () => ({
      items: [
        { found: true, product: { id: VALID_UUID_A, title: 'kept' } },
      ],
      missingIds: [VALID_UUID_B, VALID_UUID_C],
    }))
    const { hydrateMerchandisingAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.products.list',
      recordId: `${VALID_UUID_A},${VALID_UUID_B},${VALID_UUID_C}`,
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).not.toBeNull()
    expect(result).toContain('Products selection bundles (1 of 3)')
    expect(result).toContain(VALID_UUID_B)
    expect(result).toContain(VALID_UUID_C)
    expect(result).toContain('kept')
  })

  it('returns null when no UUIDs parse out of the recordId (unknown selection)', async () => {
    const handler = jest.fn()
    const { hydrateMerchandisingAssistantContext } = await loadHelpers(
      'catalog.list_selected_products',
      handler,
    )
    const result = await hydrateMerchandisingAssistantContext({
      entityType: 'catalog.products.list',
      recordId: 'not-a-uuid,also-bad',
      container: buildFakeContainer() as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })
})
