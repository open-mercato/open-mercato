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
  filterResults: (ctx: SearchResultVisibilityContext) => unknown,
  overrides: { userId?: string | null } = {},
) {
  const mockQuery = jest.fn().mockResolvedValue({ items, total: items.length })
  const filterSpy = jest.fn(filterResults)
  const sectionConfig = {
    aclFeatures: ['attachments.view'],
    fieldPolicy: { searchable: ['number_label', 'heading', 'text'], excluded: [] },
    filterResults: filterSpy,
  }
  const searchIndexer = {
    getEntityConfig: (entityId: string) => (entityId === SECTION_ENTITY ? sectionConfig : undefined),
    getAllEntityConfigs: () => [{ entityId: SECTION_ENTITY, ...sectionConfig }],
  }
  const ctx = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: overrides.userId !== undefined ? overrides.userId : 'user-1',
    userFeatures: ['search.view', 'attachments.view'],
    isSuperAdmin: false,
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
})
