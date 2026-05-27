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

  it('parseIdsParam accepts RFC 9562 UUID v6, v7, v8', () => {
    const v6 = '1ec9414c-232a-6b00-b3c8-9e6bdeced846'
    const v7 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
    const v8 = '320c3d4d-cc00-875b-8ec9-32363a3c8c4f'
    expect(parseIdsParam(`${v6},${v7},${v8}`)).toEqual([v6, v7, v8])
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

  it('mergeIdFilter intersects existing plain-array narrowing', () => {
    expect(mergeIdFilter({ id: [idA, idC] as any }, [idA, idB])).toEqual({
      id: { $in: [idA] },
    })
    expect(mergeIdFilter({ id: [idC] as any }, [idA, idB])).toEqual({
      id: { $in: [] },
    })
  })

  it('mergeIdFilter intersects existing $eq with UUID v6/v7/v8', () => {
    const v6 = '1ec9414c-232a-6b00-b3c8-9e6bdeced846'
    const v7 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f'
    const v8 = '320c3d4d-cc00-875b-8ec9-32363a3c8c4f'
    expect(mergeIdFilter({ id: { $eq: v6 } as any }, [v6, idA])).toEqual({
      id: { $in: [v6] },
    })
    expect(mergeIdFilter({ id: { $eq: v7 } as any }, [idA])).toEqual({
      id: { $in: [] },
    })
    expect(mergeIdFilter({ id: { $in: [v7, v8] } as any }, [v7, idB])).toEqual({
      id: { $in: [v7] },
    })
  })

  it('mergeIdFilter preserves existing filter for unknown filter shape (fail closed)', () => {
    // Regression: previously the unrecognised shape was silently discarded and
    // replaced with `{ id: { $in: parsedIds } }`, widening access. The contract
    // is "intersect with existing id filters — never widen" — so unknown shapes
    // must degrade closed.
    expect(
      mergeIdFilter({ id: { $ne: idA } as any }, [idA, idB]),
    ).toEqual({ id: { $ne: idA } })
  })

  it('mergeIdFilter preserves existing $eq with unsupported value (fail closed)', () => {
    // An `$eq` with a non-UUID payload is also an unrecognised narrowing — we
    // must not drop it and substitute `parsedIds`.
    expect(
      mergeIdFilter({ id: { $eq: 'not-a-uuid' } as any }, [idA]),
    ).toEqual({ id: { $eq: 'not-a-uuid' } })
  })

  it('mergeIdFilter treats undefined/null id as no existing narrowing', () => {
    expect(mergeIdFilter({ id: undefined } as any, [idA])).toEqual({
      id: { $in: [idA] },
    })
    expect(mergeIdFilter({ id: null } as any, [idA])).toEqual({
      id: { $in: [idA] },
    })
  })
})
