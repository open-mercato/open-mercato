import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentShare } from '../data/entities'
import { loadDocumentShareCounts } from '../lib/shareCounts'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const otherDocumentId = '44444444-4444-4444-8444-444444444444'
const scope = { tenantId, organizationId }

function buildQueryBuilderHarness(rows: unknown[]) {
  const builder = {
    select: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    execute: jest.fn(async () => rows),
  }
  builder.select.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.groupBy.mockReturnValue(builder)
  const em = {
    createQueryBuilder: jest.fn(() => builder),
  } as unknown as EntityManager
  return { em, builder }
}

describe('loadDocumentShareCounts', () => {
  it('returns an empty map without querying when no document ids are given', async () => {
    const { em } = buildQueryBuilderHarness([])

    await expect(loadDocumentShareCounts(em, scope, [])).resolves.toEqual(new Map())
    expect(em.createQueryBuilder).not.toHaveBeenCalled()
  })

  it('pins tenant, organization, and active-row predicates inside the grouped query', async () => {
    const { em, builder } = buildQueryBuilderHarness([{ documentId, shareCount: '2' }])

    const counts = await loadDocumentShareCounts(em, scope, [documentId, otherDocumentId])

    expect(counts).toEqual(new Map([[documentId, 2]]))
    expect(em.createQueryBuilder).toHaveBeenCalledWith(DocumentShare, 'document_share')
    expect(builder.where).toHaveBeenCalledWith({
      documentId: { $in: [documentId, otherDocumentId] },
      tenantId,
      organizationId,
      deletedAt: null,
    })
    expect(builder.groupBy).toHaveBeenCalledWith('document_share.documentId')
    expect(builder.execute).toHaveBeenCalledWith('all', false)
  })

  it('reads camelCase and snake_case row shapes and skips malformed rows', async () => {
    const { em } = buildQueryBuilderHarness([
      { documentId, shareCount: '3' },
      { document_id: otherDocumentId, share_count: 5 },
      { documentId: 42, shareCount: '1' },
      { documentId: '55555555-5555-4555-8555-555555555555', shareCount: 'not-a-number' },
    ])

    const counts = await loadDocumentShareCounts(em, scope, [documentId, otherDocumentId])

    expect(counts).toEqual(new Map([
      [documentId, 3],
      [otherDocumentId, 5],
    ]))
  })
})
