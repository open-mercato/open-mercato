/** @jest-environment node */
// D-3 read-side signal: the project list/detail response must say whether the
// currency is locked and why, so the form can render it read-only behind the
// explicit change action. One grouped aggregate covers the whole page — a
// per-row count would turn a 50-project list into 50 queries.
import type { EntityManager } from '@mikro-orm/postgresql'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const PROJECT_WITH_ENTRIES = '11111111-1111-4111-8111-111111111111'
const PROJECT_WITH_LOCKED_ENTRIES = '22222222-2222-4222-8222-222222222222'
const PROJECT_WITHOUT_ENTRIES = '33333333-3333-4333-8333-333333333333'

type ExecuteCall = { sql: string; params: unknown[] }

function makeEm(rows: Array<Record<string, unknown>>, calls: ExecuteCall[]) {
  return {
    getConnection: () => ({
      execute: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        return rows
      },
    }),
  } as unknown as EntityManager
}

describe('time project currency lock read signal', () => {
  it('marks projects with entries as currency-locked and reports the counts', async () => {
    const { decorateProjectCurrencyLock } = await import('../route')
    const calls: ExecuteCall[] = []
    const em = makeEm(
      [
        { time_project_id: PROJECT_WITH_ENTRIES, entry_count: '12', locked_entry_count: '0' },
        { time_project_id: PROJECT_WITH_LOCKED_ENTRIES, entry_count: '4', locked_entry_count: '3' },
      ],
      calls,
    )
    const items = [
      { id: PROJECT_WITH_ENTRIES },
      { id: PROJECT_WITH_LOCKED_ENTRIES },
      { id: PROJECT_WITHOUT_ENTRIES },
    ]

    await decorateProjectCurrencyLock(items, em, { tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(items).toEqual([
      { id: PROJECT_WITH_ENTRIES, entryCount: 12, lockedEntryCount: 0, currencyLocked: true },
      { id: PROJECT_WITH_LOCKED_ENTRIES, entryCount: 4, lockedEntryCount: 3, currencyLocked: true },
      { id: PROJECT_WITHOUT_ENTRIES, entryCount: 0, lockedEntryCount: 0, currencyLocked: false },
    ])
    // One grouped aggregate for the whole page, scoped to tenant AND organization.
    expect(calls).toHaveLength(1)
    expect(calls[0].params[0]).toBe(TENANT_ID)
    expect(calls[0].params[1]).toBe(ORG_ID)
    expect(calls[0].params[2]).toEqual([
      PROJECT_WITH_ENTRIES,
      PROJECT_WITH_LOCKED_ENTRIES,
      PROJECT_WITHOUT_ENTRIES,
    ])
  })

  it('issues no query for an empty page', async () => {
    const { decorateProjectCurrencyLock } = await import('../route')
    const calls: ExecuteCall[] = []
    const em = makeEm([], calls)

    await decorateProjectCurrencyLock([], em, { tenantId: TENANT_ID, organizationId: ORG_ID })

    expect(calls).toHaveLength(0)
  })
})
