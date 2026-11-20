// `seedPostingRulesDefaults` looks the sentinel cost centre up by code among
// non-deleted rows and creates it only when absent (spec, Design Decisions,
// "The sentinel `CostCenter` is protected by the commands").
export {}

import { CostCenter, PostingRulesSettings } from '../../data/entities'
import { UNALLOCATED_COST_CENTER_CODE, seedPostingRulesDefaults } from '../seedDefaults'
import { ORG, SCOPE, TENANT, buildFakeEm } from './support/fixtures'

function setup() {
  const em = buildFakeEm()
  const seedingEm = Object.assign(em, {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    persist: jest.fn((record: Record<string, unknown>) => {
      em.seed(record.code !== undefined ? CostCenter : PostingRulesSettings, record)
    }),
    flush: jest.fn(async () => undefined),
  })
  return seedingEm
}

const liveSentinels = (em: ReturnType<typeof setup>) =>
  em.rows(CostCenter).filter((row) => row.code === UNALLOCATED_COST_CENTER_CODE && !row.deletedAt)

describe('seedPostingRulesDefaults', () => {
  it('seeds one sentinel and one settings row, and a re-run adds nothing', async () => {
    const em = setup()
    expect(await seedPostingRulesDefaults(em as never, SCOPE)).toBe(true)
    expect(await seedPostingRulesDefaults(em as never, SCOPE)).toBe(false)
    expect(liveSentinels(em)).toHaveLength(1)
    expect(em.rows(PostingRulesSettings)).toHaveLength(1)
  })

  it('creates a live sentinel when the only one there is soft-deleted', async () => {
    const em = setup()
    em.seed(CostCenter, { id: 'cc-old-sentinel', organizationId: ORG, tenantId: TENANT, code: UNALLOCATED_COST_CENTER_CODE, name: 'Unallocated', isActive: true, deletedAt: new Date('2026-10-01') })
    em.seed(PostingRulesSettings, { id: 'settings-1', organizationId: ORG, tenantId: TENANT, clearingAccountId: null, unallocatedCostAccountId: null })

    expect(await seedPostingRulesDefaults(em as never, SCOPE)).toBe(true)
    expect(liveSentinels(em)).toHaveLength(1)
    expect(em.rows(PostingRulesSettings)).toHaveLength(1)
  })
})
