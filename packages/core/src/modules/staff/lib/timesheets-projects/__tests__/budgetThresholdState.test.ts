import type { EntityManager } from '@mikro-orm/postgresql'
import {
  claimBudgetThresholdAlert,
  loadTimeProjectBudgetStateForEntry,
} from '../budgetThresholdState'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const timeEntryId = '55555555-5555-4555-8555-555555555555'
const timeProjectId = '44444444-4444-4444-8444-444444444444'

function createEm(rows: unknown[]) {
  const execute = jest.fn(async () => rows)
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  return { em, execute }
}

describe('loadTimeProjectBudgetStateForEntry', () => {
  it('scopes the lookup to the tenant and organization of the write', async () => {
    const { em, execute } = createEm([])

    await loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId })

    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('entry.tenant_id = ?')
    expect(sql).toContain('entry.organization_id = ?')
    expect(sql).toContain('project.tenant_id = entry.tenant_id')
    expect(sql).toContain('project.organization_id = entry.organization_id')
    expect(sql).toContain('project.deleted_at IS NULL')
    expect(params).toEqual([timeEntryId, tenantId, organizationId])
  })

  it('does not filter the entry by deleted_at so a delete can still lower the usage', async () => {
    const { em, execute } = createEm([])

    await loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId })

    const [sql] = execute.mock.calls[0] as unknown as [string]
    expect(sql).not.toContain('entry.deleted_at')
  })

  it('returns null when the entry has no project in scope', async () => {
    const { em } = createEm([])

    await expect(
      loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId }),
    ).resolves.toBeNull()
  })

  it('normalizes the numeric columns postgres returns as strings', async () => {
    const { em } = createEm([
      {
        time_project_id: timeProjectId,
        name: 'Nordvik portal',
        owner_user_id: null,
        budget_kind: 'amount',
        budget_value: '1000.0000',
        budget_warn_at_percent: '75',
        budget_alerted_at_percent: null,
        hourly_rate: '200.0000',
        currency_code: 'PLN',
      },
    ])

    const state = await loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId })

    expect(state).toEqual({
      timeProjectId,
      name: 'Nordvik portal',
      ownerUserId: null,
      budgetKind: 'amount',
      budgetValue: 1000,
      budgetWarnAtPercent: 75,
      budgetAlertedAtPercent: null,
      hourlyRate: 200,
      currencyCode: 'PLN',
    })
  })

  it('falls back to a budget kind of none for an unknown value', async () => {
    const { em } = createEm([
      {
        time_project_id: timeProjectId,
        name: null,
        owner_user_id: null,
        budget_kind: 'quarterly',
        budget_value: null,
        budget_warn_at_percent: null,
        budget_alerted_at_percent: null,
        hourly_rate: null,
        currency_code: null,
      },
    ])

    const state = await loadTimeProjectBudgetStateForEntry({ em, tenantId, organizationId, timeEntryId })

    expect(state?.budgetKind).toBe('none')
  })
})

describe('claimBudgetThresholdAlert', () => {
  it('compares and swaps the marker without touching updated_at', async () => {
    const { em, execute } = createEm([{ id: timeProjectId }])

    const claimed = await claimBudgetThresholdAlert({
      em,
      tenantId,
      organizationId,
      timeProjectId,
      expectedAlertedAtPercent: null,
      nextAlertedAtPercent: 80,
    })

    expect(claimed).toBe(true)
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('budget_alerted_at_percent IS NOT DISTINCT FROM ?')
    expect(sql).toContain('tenant_id = ?')
    expect(sql).toContain('organization_id = ?')
    expect(sql).not.toContain('updated_at')
    expect(params).toEqual([80, timeProjectId, tenantId, organizationId, null])
  })

  it('reports the loser of a concurrent claim', async () => {
    const { em } = createEm([])

    await expect(
      claimBudgetThresholdAlert({
        em,
        tenantId,
        organizationId,
        timeProjectId,
        expectedAlertedAtPercent: 80,
        nextAlertedAtPercent: 100,
      }),
    ).resolves.toBe(false)
  })
})
