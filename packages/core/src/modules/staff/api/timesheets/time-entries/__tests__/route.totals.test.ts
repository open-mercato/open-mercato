/** @jest-environment node */
// `?includeTotals=true` adds totals for the WHOLE filtered set (#6990). They must
// reuse the list's own scoped filters — project access included — and carry money
// only for a caller holding `staff.timesheets.rates.view`.
import {
  Kysely,
  PostgresAdapter,
  PostgresQueryCompiler,
  PostgresIntrospector,
  DummyDriver,
  type CompiledQuery,
} from 'kysely'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

jest.mock('../../../../lib/time-tracking/access', () => ({
  ...jest.requireActual('../../../../lib/time-tracking/access'),
  resolveProjectAccess: jest.fn(),
}))

import { attachTimeEntryTotals } from '../route'
import { resolveProjectAccess } from '../../../../lib/time-tracking/access'

const mockResolveProjectAccess = resolveProjectAccess as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const MEMBER_ID = '44444444-4444-4444-8444-444444444444'
const PROJECT_ID = '55555555-5555-4555-8555-555555555555'
const TAG_ID = '88888888-8888-4888-8888-000000000001'
const TAGGED_ENTRY_ID = '77777777-7777-4777-8777-777777777771'
const OTHER_TAGGED_ENTRY_ID = '77777777-7777-4777-8777-777777777772'

type World = { canSeeRates: boolean; failQueries?: boolean }

function buildCtx(query: Record<string, unknown>, world: World) {
  const queries: CompiledQuery[] = []
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<unknown>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (compiled: CompiledQuery) => Promise<unknown> }
  executor.executeQuery = async (compiled: CompiledQuery) => {
    if (world.failQueries) throw new Error('[internal] database unavailable')
    queries.push(compiled)
    if (compiled.sql.includes('currency_code')) {
      return {
        rows: [{ currency_code: 'PLN', rounded_minutes: '450', rate_override_amount: null, hourly_rate: '120.0000', entry_count: '1' }],
      }
    }
    return { rows: [{ entry_count: '120', duration_minutes: '7200', rounded_minutes: '7230' }] }
  }
  const em = {
    fork: () => em,
    getKysely: () => db,
    find: async () => [{ timeEntryId: TAGGED_ENTRY_ID }, { timeEntryId: OTHER_TAGGED_ENTRY_ID }],
  }
  const ctx = {
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: null,
    query,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') {
          return { userHasAllFeatures: async () => world.canSeeRates }
        }
        throw new Error('[internal] unexpected resolve')
      },
    },
  } as unknown as CrudCtx & { query: never }
  return { ctx, queries }
}

function listPayload() {
  return { items: [{ id: 'row-1' }], total: 120, page: 1, pageSize: 50, totalPages: 3 } as Record<string, unknown>
}

describe('time-entries list totals', () => {
  beforeEach(() => {
    mockResolveProjectAccess.mockResolvedValue({ canManageAll: false, projectIds: [PROJECT_ID], staffMemberId: MEMBER_ID })
  })

  it('leaves the response untouched unless totals are requested', async () => {
    const { ctx, queries } = buildCtx({ page: 1, pageSize: 50 }, { canSeeRates: true })
    const payload = listPayload()
    await attachTimeEntryTotals(payload, ctx)
    expect(payload).not.toHaveProperty('totals')
    expect(queries).toHaveLength(0)
  })

  it('adds whole-set totals that respect the list filters and project access', async () => {
    const { ctx, queries } = buildCtx(
      { page: 1, pageSize: 50, includeTotals: 'true', from: '2026-10-05', to: '2026-10-11' },
      { canSeeRates: false },
    )
    const payload = listPayload()
    await attachTimeEntryTotals(payload, ctx)

    expect(payload.totals).toEqual({ entryCount: 120, durationMinutes: 7200, roundedMinutes: 7230 })
    expect(queries).toHaveLength(1)
    const [query] = queries
    expect(query.sql).toContain('"e"."tenant_id" = $1')
    expect(query.sql).toContain('"e"."organization_id" in ($2)')
    expect(query.sql).toContain('"e"."date" >= $3')
    expect(query.sql).toContain('"e"."time_project_id" in (')
    expect(query.parameters).toEqual(expect.arrayContaining([PROJECT_ID, MEMBER_ID, '2026-10-05', '2026-10-11']))
  })

  it('adds money per currency only for a caller holding the rates feature', async () => {
    const { ctx } = buildCtx({ includeTotals: 'true' }, { canSeeRates: true })
    const payload = listPayload()
    await attachTimeEntryTotals(payload, ctx)
    expect(payload.totals).toEqual({
      entryCount: 120,
      durationMinutes: 7200,
      roundedMinutes: 7230,
      money: [{ currencyCode: 'PLN', amount: 900 }],
    })
  })

  it('omits totals rather than failing the list when the aggregate cannot run', async () => {
    const { ctx } = buildCtx({ includeTotals: 'true' }, { canSeeRates: true, failQueries: true })
    const payload = listPayload()
    await expect(attachTimeEntryTotals(payload, ctx)).resolves.toBeUndefined()
    expect(payload).not.toHaveProperty('totals')
    expect(payload.items).toEqual([{ id: 'row-1' }])
  })

  it('intersects ?ids= with the tag narrowing exactly like the list does', async () => {
    const { ctx, queries } = buildCtx({ includeTotals: 'true', tagIds: TAG_ID, ids: TAGGED_ENTRY_ID }, { canSeeRates: false })
    await attachTimeEntryTotals(listPayload(), ctx)
    const [query] = queries
    expect(query.parameters).toContain(TAGGED_ENTRY_ID)
    expect(query.parameters).not.toContain(OTHER_TAGGED_ENTRY_ID)
  })

  it('matches nothing for a malformed ?ids= instead of totalling the unfiltered set', async () => {
    const { ctx, queries } = buildCtx({ includeTotals: 'true', ids: 'not-a-uuid' }, { canSeeRates: false })
    await attachTimeEntryTotals(listPayload(), ctx)
    expect(queries[0].sql).toContain('false')
    expect(queries[0].parameters).not.toContain('not-a-uuid')
  })

  it('includes soft-deleted entries only for withDeleted=true, like the list', async () => {
    const { ctx, queries } = buildCtx({ includeTotals: 'true', withDeleted: 'true' }, { canSeeRates: false })
    await attachTimeEntryTotals(listPayload(), ctx)
    expect(queries[0].sql).not.toContain('deleted_at')
  })

  it('drops totals carried over from a cached payload when the aggregate fails', async () => {
    const { ctx } = buildCtx({ includeTotals: 'true' }, { canSeeRates: true, failQueries: true })
    const payload = { ...listPayload(), totals: { entryCount: 1, durationMinutes: 1, roundedMinutes: 1, money: [] } }
    await attachTimeEntryTotals(payload, ctx)
    expect(payload).not.toHaveProperty('totals')
  })
})
