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
      timeZone: 'europe/warsaw',
      conformanceWorkflowId: null,
      activityStepMap: null,
      deletedAt: null,
      updatedAt: null,
    }] as never)
    const loader = createEntityManagerSettingsLoader({} as EntityManager)
    const loaded = await loader(TENANT.toUpperCase(), [ORG.toUpperCase(), ORG])
    expect(findMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { tenantId: TENANT, organizationId: { $in: [ORG] } }, undefined, { tenantId: TENANT })
    expect(Array.from(loaded.entries())).toEqual([[ORG, { kAnonymity: 7, debounceSeconds: 30, individualsEnabled: true, enabled: true, timeZone: 'Europe/Warsaw' }]])
  })

  it('reports a disabled organization and falls back to UTC for an unknown stored time zone', async () => {
    findMock.mockResolvedValue([{
      tenantId: TENANT,
      organizationId: ORG,
      enabled: false,
      retentionDays: 365,
      kAnonymity: 10,
      debounceSeconds: 120,
      individualsEnabled: false,
      timeZone: 'Mars/Olympus_Mons',
      conformanceWorkflowId: null,
      activityStepMap: null,
      deletedAt: null,
      updatedAt: null,
    }] as never)
    const loaded = await createEntityManagerSettingsLoader({} as EntityManager)(TENANT, [ORG])
    expect(loaded.get(ORG)).toEqual(expect.objectContaining({ enabled: false, timeZone: 'UTC' }))
  })

  it('folds the time zone the organizations share, UTC when they differ', () => {
    const zoned = (timeZone?: string): AnalyticsOrgSettings => ({ kAnonymity: 10, debounceSeconds: 120, individualsEnabled: false, ...(timeZone ? { timeZone } : {}) })
    expect(foldScopeSettings([ORG, OTHER_ORG], new Map([[ORG, zoned('Europe/Warsaw')], [OTHER_ORG, zoned('Europe/Warsaw')]])).timeZone).toBe('Europe/Warsaw')
    expect(foldScopeSettings([ORG, OTHER_ORG], new Map([[ORG, zoned('Europe/Warsaw')], [OTHER_ORG, zoned('America/New_York')]])).timeZone).toBe('UTC')
    expect(foldScopeSettings([ORG, OTHER_ORG], new Map([[ORG, zoned('Europe/Warsaw')]])).timeZone).toBe('UTC')
    expect(foldScopeSettings([], new Map()).timeZone).toBe('UTC')
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
