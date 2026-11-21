import type { SearchResultVisibilityContext } from '@open-mercato/shared/modules/search'
import { aiTools } from '../ai-tools'

const getTool = aiTools.find((t) => t.name === 'search_get')
const aggregateTool = aiTools.find((t) => t.name === 'search_aggregate')
if (!getTool || !aggregateTool) throw new Error('search_get / search_aggregate tools not found in aiTools')

const SECTION_ENTITY = 'attachments:attachment_document_section'
const VISIBLE_ID = '11111111-1111-4111-8111-111111111111'
const HIDDEN_ID = '22222222-2222-4222-8222-222222222222'

function makeCtx(
  items: Record<string, unknown>[],
  filterResults: ((ctx: SearchResultVisibilityContext) => unknown) | undefined,
  overrides: {
    userId?: string | null
    userFeatures?: string[]
    isSuperAdmin?: boolean
    apiKeyId?: string | null
    aclFeatures?: string[]
    aclFeaturesMode?: 'all' | 'any'
  } = {},
) {
  const mockQuery = jest.fn().mockResolvedValue({ items, total: items.length })
  const filterSpy = filterResults ? jest.fn(filterResults) : undefined
  const sectionConfig = {
    aclFeatures: overrides.aclFeatures ?? ['attachments.view'],
    ...(overrides.aclFeaturesMode ? { aclFeaturesMode: overrides.aclFeaturesMode } : {}),
    fieldPolicy: { searchable: ['number_label', 'heading', 'text'], excluded: [] },
    ...(filterSpy ? { filterResults: filterSpy } : {}),
  }
  const searchIndexer = {
    getEntityConfig: (entityId: string) => (entityId === SECTION_ENTITY ? sectionConfig : undefined),
    getAllEntityConfigs: () => [{ entityId: SECTION_ENTITY, ...sectionConfig }],
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: overrides.userId !== undefined ? overrides.userId : 'user-1',
    userFeatures: overrides.userFeatures ?? ['search.view', 'attachments.view'],
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    ...(overrides.apiKeyId !== undefined ? { apiKeyId: overrides.apiKeyId } : {}),
    container: {
      resolve: (name: string) => {
        if (name === 'searchIndexer') return searchIndexer
        if (name === 'em' || name === 'rbacService') throw new Error(`${name} not mocked`)
        return { query: mockQuery }
      },
    },
  }
  return { ctx, mockQuery, filterSpy }
}

const onlyVisible = (ctx: SearchResultVisibilityContext) =>
  ctx.results.filter((result) => result.recordId === VISIBLE_ID)

describe('search AI tools honor the entity filterResults hook', () => {
  it('search_get reports a section the viewer may not open as not found', async () => {
    const { ctx, filterSpy } = makeCtx([{ id: HIDDEN_ID, text: 'owner-only contract text' }], onlyVisible)

    const result = (await getTool.handler({ entityType: SECTION_ENTITY, recordId: HIDDEN_ID }, ctx)) as Record<string, unknown>

    expect(result.found).toBe(false)
    expect(JSON.stringify(result)).not.toContain('owner-only contract text')
    expect(filterSpy).toHaveBeenCalledTimes(1)
    const visibilityCtx = filterSpy.mock.calls[0][0]
    expect(visibilityCtx.viewer.auth.sub).toBe('user-1')
    expect(visibilityCtx.tenantId).toBe('tenant-1')
  })

  it('search_get returns a section the viewer may open', async () => {
    const { ctx } = makeCtx([{ id: VISIBLE_ID, text: 'shared text' }], onlyVisible)

    const result = (await getTool.handler({ entityType: SECTION_ENTITY, recordId: VISIBLE_ID }, ctx)) as Record<string, unknown>

    expect(result.found).toBe(true)
  })

  it('search_get fails closed when the hook throws', async () => {
    const { ctx } = makeCtx([{ id: VISIBLE_ID, text: 'shared text' }], () => {
      throw new Error('boom')
    })

    const result = (await getTool.handler({ entityType: SECTION_ENTITY, recordId: VISIBLE_ID }, ctx)) as Record<string, unknown>

    expect(result.found).toBe(false)
  })

  it('search_aggregate never buckets text from sections the viewer may not open', async () => {
    const { ctx } = makeCtx(
      [
        { id: VISIBLE_ID, text: 'shared text' },
        { id: HIDDEN_ID, text: 'owner-only contract text' },
      ],
      onlyVisible,
    )

    const result = (await aggregateTool.handler(
      { entityType: SECTION_ENTITY, groupBy: 'text', limit: 20 },
      ctx,
    )) as { total: number; buckets: Array<{ value: string | null }> }

    expect(result.total).toBe(1)
    expect(result.buckets.map((bucket) => bucket.value)).toEqual(['shared text'])
  })

  it('search_get and search_aggregate honor aclFeaturesMode "any" when paired with filterResults', async () => {
    const { ctx } = makeCtx(
      [
        { id: VISIBLE_ID, text: 'quote note' },
        { id: HIDDEN_ID, text: 'order note' },
      ],
      onlyVisible,
      {
        aclFeatures: ['sales.orders.view', 'sales.quotes.view'],
        aclFeaturesMode: 'any',
        userFeatures: ['search.view', 'sales.quotes.view'],
      },
    )

    const getResult = (await getTool.handler({ entityType: SECTION_ENTITY, recordId: VISIBLE_ID }, ctx)) as Record<string, unknown>
    expect(getResult.found).toBe(true)

    const aggResult = (await aggregateTool.handler(
      { entityType: SECTION_ENTITY, groupBy: 'text', limit: 20 },
      ctx,
    )) as { total: number; buckets: Array<{ value: string | null }> }
    expect(aggResult.total).toBe(1)
    expect(aggResult.buckets.map((bucket) => bucket.value)).toEqual(['quote note'])
  })

  it('search_get denies aclFeaturesMode "any" when filterResults is missing', async () => {
    const { ctx } = makeCtx([{ id: VISIBLE_ID, text: 'quote note' }], undefined, {
      aclFeatures: ['sales.orders.view', 'sales.quotes.view'],
      aclFeaturesMode: 'any',
      userFeatures: ['search.view', 'sales.quotes.view'],
    })

    await expect(
      getTool.handler({ entityType: SECTION_ENTITY, recordId: VISIBLE_ID }, ctx),
    ).rejects.toThrow(/aclFeaturesMode "any" without filterResults/)
  })

  it('search_get and search_aggregate still run filterResults for superadmins and API-key callers', async () => {
    const superadminRun = makeCtx(
      [{ id: HIDDEN_ID, text: 'private message' }],
      onlyVisible,
      { isSuperAdmin: true, userFeatures: ['*'] },
    )
    const superGet = (await getTool.handler({ entityType: SECTION_ENTITY, recordId: HIDDEN_ID }, superadminRun.ctx)) as Record<string, unknown>
    expect(superGet.found).toBe(false)
    expect(superadminRun.filterSpy).toHaveBeenCalledTimes(1)

    const apiKeyRun = makeCtx(
      [{ id: VISIBLE_ID, text: 'scoped note' }],
      onlyVisible,
      { apiKeyId: 'key-42', userFeatures: ['search.view', 'attachments.view'] },
    )
    await getTool.handler({ entityType: SECTION_ENTITY, recordId: VISIBLE_ID }, apiKeyRun.ctx)
    expect(apiKeyRun.filterSpy?.mock.calls[0][0].viewer.auth).toMatchObject({
      sub: 'api_key:key-42',
      isApiKey: true,
      keyId: 'key-42',
    })
  })
})
