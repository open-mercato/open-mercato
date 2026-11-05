/** @jest-environment node */

import { attachResourceTypeCounts } from '../resourceTypeCounts'

type ChainableBuilder = {
  selectFrom: jest.Mock
  select: jest.Mock
  where: jest.Mock
  groupBy: jest.Mock
  execute: jest.Mock
}

function buildKysely(rows: Array<{ resource_type_id: string | null; count: string | number }>): ChainableBuilder {
  const builder = {} as ChainableBuilder
  const chain = () => builder
  builder.selectFrom = jest.fn(chain)
  builder.select = jest.fn(chain)
  builder.where = jest.fn(chain)
  builder.groupBy = jest.fn(chain)
  builder.execute = jest.fn().mockResolvedValue(rows)
  return builder
}

function buildCtx(builder: ChainableBuilder, withResourceCounts: unknown) {
  const getKysely = jest.fn(() => builder)
  const em = { getKysely }
  const container = { resolve: jest.fn((name: string) => (name === 'em' ? em : {})) }
  const ctx = {
    container: container as never,
    auth: { tenantId: 'tenant-1' } as never,
    organizationScope: null,
    organizationIds: ['org-1'],
    selectedOrganizationId: 'org-1',
    query: { withResourceCounts },
  }
  return { ctx, getKysely }
}

describe('attachResourceTypeCounts', () => {
  test('does not scan resources when counts are not requested', async () => {
    const builder = buildKysely([])
    const { ctx, getKysely } = buildCtx(builder, undefined)
    const items: Array<Record<string, unknown>> = [{ id: 'type-a' }, { id: 'type-b' }]

    await attachResourceTypeCounts({ items }, ctx)

    expect(getKysely).not.toHaveBeenCalled()
    expect(builder.selectFrom).not.toHaveBeenCalled()
    expect('resourceCount' in items[0]).toBe(false)
    expect('resourceCount' in items[1]).toBe(false)
  })

  test('attaches accurate scoped counts with zero-fill when requested', async () => {
    const builder = buildKysely([{ resource_type_id: 'type-a', count: '3' }])
    const { ctx, getKysely } = buildCtx(builder, 'true')
    const items: Array<Record<string, unknown>> = [{ id: 'type-a' }, { id: 'type-b' }]

    await attachResourceTypeCounts({ items }, ctx)

    expect(getKysely).toHaveBeenCalledTimes(1)
    expect(builder.selectFrom).toHaveBeenCalledWith('resources_resources')
    expect(builder.groupBy).toHaveBeenCalledWith('resource_type_id')
    expect(builder.execute).toHaveBeenCalledTimes(1)
    expect(items[0].resourceCount).toBe(3)
    expect(items[1].resourceCount).toBe(0)
  })

  test('skips the query entirely when there are no items even if requested', async () => {
    const builder = buildKysely([])
    const { ctx, getKysely } = buildCtx(builder, 'true')

    await attachResourceTypeCounts({ items: [] }, ctx)

    expect(getKysely).not.toHaveBeenCalled()
  })
})
