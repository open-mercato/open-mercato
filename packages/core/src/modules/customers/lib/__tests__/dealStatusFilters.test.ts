import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { expandDealStatusAliases } from '../dealStatus'
import { buildDealStatusSqlFilter, expandDealStatusFilterLiteral, resolveDealStatusFilterVocabulary, restoreDealStatusFilterVariants } from '../dealStatusFilters'

const vocabulary = { won: ['Signed'], lost: ['Declined'], closed: ['Archived'] }

function context(execute: jest.Mock, filterIds: string[] | null = ['org-a']): CrudCtx {
  return {
    auth: { sub: 'user-a', tenantId: 'tenant-a', orgId: 'org-a' },
    organizationScope: { tenantId: 'tenant-a', filterIds },
    organizationIds: filterIds,
    container: { resolve: () => ({ getConnection: () => ({ execute }) }) },
  } as unknown as CrudCtx
}

it('finds scoped historical terminal spellings without changing preferred values or arbitrary filters', async () => {
  const execute = jest.fn().mockResolvedValue([{ status: '  sIgNeD  ' }, { status: 'DECLINED' }])
  const resolved = await resolveDealStatusFilterVocabulary(context(execute), vocabulary)
  expect(resolved.won[0]).toBe('Signed')
  expect(expandDealStatusAliases(['win'], resolved)).toContain('  sIgNeD  ')
  expect(expandDealStatusAliases(['Custom Review'], resolved)).toEqual(['custom review', 'Custom Review'])
  expect(execute).toHaveBeenCalledWith(expect.stringContaining('LOWER(BTRIM(status,'), expect.arrayContaining(['tenant-a', 'org-a', 'signed']))
  expect(execute.mock.calls[0][0]).toContain('deleted_at IS NULL')
  expect(execute.mock.calls[0][1]).not.toContain('org-b')
})

it('resolves unrestricted organizations and keeps empty scope closed', async () => {
  const unrestricted = jest.fn().mockResolvedValueOnce([{ id: 'org-a' }, { id: 'org-b' }]).mockResolvedValueOnce([])
  await resolveDealStatusFilterVocabulary(context(unrestricted, null), vocabulary)
  expect(unrestricted.mock.calls[1][1].slice(0, 3)).toEqual(['tenant-a', 'org-a', 'org-b'])
  const empty = jest.fn().mockResolvedValue([])
  await resolveDealStatusFilterVocabulary(context(empty, []), vocabulary)
  expect(empty.mock.calls[0][1].slice(0, 2)).toEqual(['tenant-a', '00000000-0000-0000-0000-000000000000'])
})

it('propagates lookup failures and retains base aliases when no historical variant exists', async () => {
  const failing = jest.fn().mockRejectedValue(new Error('database unavailable'))
  await expect(resolveDealStatusFilterVocabulary(context(failing), vocabulary)).rejects.toThrow('database unavailable')
  const empty = await resolveDealStatusFilterVocabulary(context(jest.fn().mockResolvedValue([])), vocabulary)
  expect(empty).toEqual(vocabulary)
})

it('normalizes only terminal SQL branches and keeps arbitrary values bound to exact comparisons', () => {
  const result = buildDealStatusSqlFilter(['win', 'Custom Review'], vocabulary)
  expect(result.clause).toContain('LOWER(BTRIM(status,')
  expect(result.clause).toContain(' OR status IN (?,?)')
  expect(result.params).toEqual(['signed', 'win', 'won', 'custom review', 'Custom Review'])
  expect(buildDealStatusSqlFilter(['Custom Review'], vocabulary).clause).not.toContain('LOWER')
})

it('expands one dashboard literal without merging arbitrary statuses or different aliases', () => {
  const resolved = { ...vocabulary, won: ['Signed', '  sIgNeD  ', 'accepted'] }
  expect(expandDealStatusFilterLiteral('Signed', resolved)).toEqual(['Signed', '  sIgNeD  '])
  expect(expandDealStatusFilterLiteral('Custom Review', resolved)).toEqual(['Custom Review'])
})

it('retains nested boolean and text/range semantics while restoring terminal set variants', () => {
  const filters = { $and: [
    { status: { $in: ['Signed'] } },
    { $or: [{ $not: { status: { $nin: ['Signed', 'Custom Review'] } } }, { status: { $ilike: '%Signed%' }, probability: { $gte: 50 } }] },
  ] }
  restoreDealStatusFilterVariants(filters, { ...vocabulary, won: ['Signed', '  sIgNeD  '] })
  expect(filters.$and[0]).toEqual({ status: { $in: ['Signed', '  sIgNeD  ', 'win', 'won'] } })
  expect(filters.$and[1]).toEqual({ $or: [
    { $not: { status: { $nin: ['Signed', '  sIgNeD  ', 'win', 'won', 'Custom Review'] } } },
    { status: { $ilike: '%Signed%' }, probability: { $gte: 50 } },
  ] })
})
