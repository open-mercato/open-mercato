import { privateEmailCountEnricher } from '../enrichers'

type MockRow = { entity_id: string; count: number }

function makeCtx(rows: MockRow[]) {
  // Build a minimal Kysely-like query builder that returns `rows` from `.execute()`
  const chain: Record<string, unknown> = {}
  const builder: Record<string, unknown> = {
    selectFrom() { return builder },
    select() { return builder },
    where() { return builder },
    groupBy() { return builder },
    execute: () => Promise.resolve(rows),
  }

  return {
    em: {
      getKysely: () => builder,
    } as unknown,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-A',
    userFeatures: [],
  } as any
}

describe('privateEmailCountEnricher', () => {
  it('returns empty array when no records provided', async () => {
    const out = await privateEmailCountEnricher.enrichMany!([], makeCtx([]))
    expect(out).toEqual([])
  })

  it('returns 0 for each record when no private emails exist for other users', async () => {
    const out = await privateEmailCountEnricher.enrichMany!(
      [{ id: 'p-1' }, { id: 'p-2' }],
      makeCtx([]),
    )
    expect(out).toEqual([
      { id: 'p-1', _privateEmailCount: 0 },
      { id: 'p-2', _privateEmailCount: 0 },
    ])
  })

  it('maps counts from the query result to the correct person records', async () => {
    const out = await privateEmailCountEnricher.enrichMany!(
      [{ id: 'p-1' }, { id: 'p-2' }],
      makeCtx([
        { entity_id: 'p-1', count: 3 },
        { entity_id: 'p-2', count: 1 },
      ]),
    )
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 3 })
    expect(out[1]).toMatchObject({ id: 'p-2', _privateEmailCount: 1 })
  })

  it('defaults to 0 for a person not present in query results', async () => {
    const out = await privateEmailCountEnricher.enrichMany!(
      [{ id: 'p-1' }, { id: 'p-2' }],
      makeCtx([{ entity_id: 'p-1', count: 5 }]),
    )
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 5 })
    expect(out[1]).toMatchObject({ id: 'p-2', _privateEmailCount: 0 })
  })

  it('returns 0 when userId is missing (fail-safe)', async () => {
    const ctx = makeCtx([])
    ctx.userId = null
    const out = await privateEmailCountEnricher.enrichMany!([{ id: 'p-1' }], ctx)
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 0 })
  })

  it('returns 0 for API-key principals (no authoring user to exclude — count would otherwise include every private email)', async () => {
    // An API key (`auth.sub = "api_key:<id>"`) is not a person, so the
    // `author_user_id != userId` exclusion would match nothing and count ALL
    // private emails. The enricher must short-circuit to 0 instead.
    const ctx = makeCtx([{ entity_id: 'p-1', count: 9 }])
    ctx.userId = 'api_key:abc123'
    const out = await privateEmailCountEnricher.enrichMany!([{ id: 'p-1' }], ctx)
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 0 })
  })

  it('returns 0 when the EntityManager does not expose getKysely (fail-safe)', async () => {
    const ctx: any = {
      em: {},
      tenantId: 't',
      organizationId: 'o',
      userId: 'u',
      userFeatures: [],
    }
    const out = await privateEmailCountEnricher.enrichMany!([{ id: 'p-1' }], ctx)
    expect(out[0]).toMatchObject({ id: 'p-1', _privateEmailCount: 0 })
  })

  it('delegates to enrichMany when enrichOne is called', async () => {
    const out = await privateEmailCountEnricher.enrichOne!(
      { id: 'p-1' },
      makeCtx([{ entity_id: 'p-1', count: 7 }]),
    )
    expect(out).toMatchObject({ id: 'p-1', _privateEmailCount: 7 })
  })
})
