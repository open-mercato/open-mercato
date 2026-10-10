jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { foldScopeSettings } from '../compute'
import { createEntityManagerSettingsLoader } from '../settings'
import type { AnalyticsOrgSettings } from '../types'

const TENANT = 'aaaaaaaa-0000-4000-8000-00000000000a'
const ORG = 'bbbbbbbb-0000-4000-8000-00000000000b'
const OTHER_ORG = 'cccccccc-0000-4000-8000-00000000000c'

const findMock = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

describe('X-Ray analytics settings identifiers', () => {
  beforeEach(() => findMock.mockReset())

  it('loads settings for upper-case tenant and organization ids under their canonical lower-case ids', async () => {
    findMock.mockResolvedValue([{
      tenantId: TENANT,
      organizationId: ORG,
      enabled: true,
      retentionDays: 365,
      kAnonymity: 7,
      debounceSeconds: 30,
      individualsEnabled: true,
      conformanceWorkflowId: null,
      activityStepMap: null,
      deletedAt: null,
      updatedAt: null,
    }] as never)
    const loader = createEntityManagerSettingsLoader({} as EntityManager)
    const loaded = await loader(TENANT.toUpperCase(), [ORG.toUpperCase(), ORG])
    expect(findMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { tenantId: TENANT, organizationId: { $in: [ORG] } }, undefined, { tenantId: TENANT })
    expect(Array.from(loaded.entries())).toEqual([[ORG, { kAnonymity: 7, debounceSeconds: 30, individualsEnabled: true }]])
  })

  it('folds settings keyed by lower-case ids for upper-case scope ids', () => {
    const settings = new Map<string, AnalyticsOrgSettings>([
      [ORG, { kAnonymity: 7, debounceSeconds: 30, individualsEnabled: true }],
      [OTHER_ORG.toUpperCase(), { kAnonymity: 8, debounceSeconds: 0, individualsEnabled: true }],
    ])
    const folded = foldScopeSettings([ORG.toUpperCase(), OTHER_ORG], settings)
    expect(folded.organizationIds).toEqual([ORG, OTHER_ORG])
    expect(folded.kAnonymity).toBe(8)
    expect(folded.debounceMsByOrganization.get(ORG)).toBe(30_000)
    expect(folded.debounceMsByOrganization.get(OTHER_ORG)).toBe(0)
    expect(folded.individualsEnabled).toBe(true)
    expect(folded.fingerprint).toBe(foldScopeSettings([OTHER_ORG, ORG], new Map([
      [ORG, { kAnonymity: 7, debounceSeconds: 30, individualsEnabled: true }],
      [OTHER_ORG, { kAnonymity: 8, debounceSeconds: 0, individualsEnabled: true }],
    ])).fingerprint)
  })
})
