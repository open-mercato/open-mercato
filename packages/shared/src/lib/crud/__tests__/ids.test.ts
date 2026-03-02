import { MAX_IDS_PER_REQUEST, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'

describe('crud ids helpers', () => {
  const idA = '550e8400-e29b-41d4-a716-446655440001'
  const idB = '550e8400-e29b-41d4-a716-446655440002'
  const idC = '550e8400-e29b-41d4-a716-446655440003'

  it('parseIdsParam returns deduped valid UUIDs', () => {
    expect(
      parseIdsParam(`${idA}, ${idB},invalid,${idA}`),
    ).toEqual([idA, idB])
  })

  it('parseIdsParam truncates to provided limit', () => {
    expect(parseIdsParam(`${idA},${idB},${idC}`, 2)).toEqual([idA, idB])
  })

  it('parseIdsParam ignores empty values', () => {
    expect(parseIdsParam('')).toEqual([])
    expect(parseIdsParam('invalid')).toEqual([])
    expect(parseIdsParam(null)).toEqual([])
  })

  it('parseIdsParam uses default max limit', () => {
    const ids = Array.from({ length: MAX_IDS_PER_REQUEST + 5 }, (_, idx) =>
      `550e8400-e29b-41d4-a716-44665544${String(idx).padStart(4, '0')}`,
    )
    expect(parseIdsParam(ids.join(','))).toHaveLength(MAX_IDS_PER_REQUEST)
  })

  it('mergeIdFilter adds id filter when none exists', () => {
    expect(mergeIdFilter({}, [idA, idB])).toEqual({
      id: { $in: [idA, idB] },
    })
  })

  it('mergeIdFilter intersects existing direct id value', () => {
    expect(mergeIdFilter({ id: idA }, [idA, idB])).toEqual({
      id: { $in: [idA] },
    })
    expect(mergeIdFilter({ id: idC }, [idA, idB])).toEqual({
      id: { $in: [] },
    })
  })

  it('mergeIdFilter intersects existing $eq and $in filters', () => {
    expect(mergeIdFilter({ id: { $eq: idB } }, [idA, idB])).toEqual({
      id: { $in: [idB] },
    })
    expect(mergeIdFilter({ id: { $in: [idA, idC] } }, [idA, idB])).toEqual({
      id: { $in: [idA] },
    })
  })

  it('mergeIdFilter falls back to parsed ids for unknown filter shape', () => {
    expect(
      mergeIdFilter({ id: { $ne: idA } }, [idA, idB]),
    ).toEqual({
      id: { $in: [idA, idB] },
    })
  })
})
