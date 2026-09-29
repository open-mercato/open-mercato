import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import { warrantyClaimsCompanyEnricher, warrantyClaimsPersonEnricher } from '../data/enrichers'

type ClaimMetricsRow = {
  customer_id: string | null
  lifetime_count: string | number | bigint | null
  open_count: string | number | bigint | null
  last_claim_date: Date | string | null
}

type QueryBuilderMock = {
  select: jest.MockedFunction<(selection: unknown) => QueryBuilderMock>
  where: jest.MockedFunction<(...args: unknown[]) => QueryBuilderMock>
  groupBy: jest.MockedFunction<(column: unknown) => QueryBuilderMock>
  execute: jest.MockedFunction<() => Promise<ClaimMetricsRow[]>>
}

type MockEnricherContext = {
  context: EnricherContext
  selectFrom: jest.MockedFunction<(table: unknown) => QueryBuilderMock | null>
}

function makeQueryBuilder(rows: ClaimMetricsRow[]): QueryBuilderMock {
  const builder: Partial<QueryBuilderMock> = {}
  builder.select = jest.fn(() => builder as QueryBuilderMock)
  builder.where = jest.fn(() => builder as QueryBuilderMock)
  builder.groupBy = jest.fn(() => builder as QueryBuilderMock)
  builder.execute = jest.fn(async () => rows)
  return builder as QueryBuilderMock
}

function makeContext(builder: QueryBuilderMock | null): MockEnricherContext {
  const selectFrom = jest.fn(() => builder)
  return {
    context: {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      em: builder ? { getKysely: () => ({ selectFrom }) } : {},
      container: {},
    },
    selectFrom,
  }
}

describe('warranty claims customer metrics enrichers', () => {
  test('person enrichMany issues one batched query and maps grouped counts by customer id', async () => {
    const builder = makeQueryBuilder([
      {
        customer_id: 'customer-1',
        lifetime_count: '3',
        open_count: '2',
        last_claim_date: new Date('2026-07-04T12:30:00.000Z'),
      },
      {
        customer_id: 'customer-2',
        lifetime_count: 1,
        open_count: 0,
        last_claim_date: '2026-07-03T08:15:00.000Z',
      },
    ])
    const records = [{ id: 'customer-1' }, { id: 'customer-2' }]
    const { context, selectFrom } = makeContext(builder)

    const enriched = await warrantyClaimsPersonEnricher.enrichMany!(records, context)

    expect(selectFrom).toHaveBeenCalledTimes(1)
    expect(selectFrom).toHaveBeenCalledWith('warranty_claims')
    expect(builder.execute).toHaveBeenCalledTimes(1)
    expect(builder.where).toHaveBeenCalledWith('tenant_id', '=', 'tenant-1')
    expect(builder.where).toHaveBeenCalledWith('organization_id', '=', 'org-1')
    expect(builder.where).toHaveBeenCalledWith('deleted_at', 'is', null)
    expect(builder.where).toHaveBeenCalledWith('customer_id', 'in', ['customer-1', 'customer-2'])
    expect(enriched).toEqual([
      {
        id: 'customer-1',
        _warranty_claims: {
          openCount: 2,
          lifetimeCount: 3,
          lastClaimDate: '2026-07-04T12:30:00.000Z',
        },
      },
      {
        id: 'customer-2',
        _warranty_claims: {
          openCount: 0,
          lifetimeCount: 1,
          lastClaimDate: '2026-07-03T08:15:00.000Z',
        },
      },
    ])
  })

  test('customers with no grouped claim row receive the zero payload', async () => {
    const builder = makeQueryBuilder([
      {
        customer_id: 'customer-1',
        lifetime_count: 1,
        open_count: 1,
        last_claim_date: '2026-07-02T00:00:00.000Z',
      },
    ])

    const enriched = await warrantyClaimsCompanyEnricher.enrichMany!(
      [{ id: 'customer-1' }, { id: 'customer-without-claims' }],
      makeContext(builder).context,
    )

    expect(builder.execute).toHaveBeenCalledTimes(1)
    expect(enriched[1]).toEqual({
      id: 'customer-without-claims',
      _warranty_claims: {
        openCount: 0,
        lifetimeCount: 0,
        lastClaimDate: null,
      },
    })
  })

  test('falls back to the zero payload when the Kysely client is unavailable', async () => {
    const enriched = await warrantyClaimsPersonEnricher.enrichMany!(
      [{ id: 'customer-1' }, { id: 'customer-2' }],
      makeContext(null).context,
    )

    expect(enriched).toEqual([
      {
        id: 'customer-1',
        _warranty_claims: {
          openCount: 0,
          lifetimeCount: 0,
          lastClaimDate: null,
        },
      },
      {
        id: 'customer-2',
        _warranty_claims: {
          openCount: 0,
          lifetimeCount: 0,
          lastClaimDate: null,
        },
      },
    ])
  })
})
