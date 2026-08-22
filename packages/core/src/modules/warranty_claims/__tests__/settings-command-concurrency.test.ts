import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { WarrantyClaimSettings } from '../data/entities'
import { saveWarrantyClaimSettingsCommand } from '../commands/settings'
import { loadWarrantyClaimSettings } from '../lib/settings'

jest.mock('../lib/settings', () => {
  const actual = jest.requireActual('../lib/settings')
  return { ...actual, loadWarrantyClaimSettings: jest.fn() }
})

const loadWarrantyClaimSettingsMock = loadWarrantyClaimSettings as jest.MockedFunction<typeof loadWarrantyClaimSettings>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const ATTEMPTED_AT = new Date('2026-08-13T08:00:00.000Z')
const WINNER_AT = new Date('2026-08-13T08:00:01.000Z')

describe('warranty claim settings command concurrency', () => {
  beforeEach(() => {
    loadWarrantyClaimSettingsMock.mockReset()
  })

  it('surfaces a first-save race as an optimistic-lock conflict instead of overwriting the winner', async () => {
    const attempted = Object.assign(new WarrantyClaimSettings(), {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      updatedAt: ATTEMPTED_AT,
    })
    const winner = Object.assign(new WarrantyClaimSettings(), {
      id: '44444444-4444-4444-8444-444444444444',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      updatedAt: WINNER_AT,
    })
    const firstEm = {
      create: jest.fn(() => attempted),
      persist: jest.fn(),
      flush: jest.fn(async () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }) }),
    } as unknown as EntityManager
    const retryEm = { flush: jest.fn() } as unknown as EntityManager
    const rootEm = {
      fork: jest.fn()
        .mockReturnValueOnce(firstEm)
        .mockReturnValueOnce(retryEm),
    } as unknown as EntityManager
    loadWarrantyClaimSettingsMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    const ctx = {
      container: { resolve: () => rootEm },
      auth: { tenantId: TENANT_ID, orgId: ORG_ID },
      selectedOrganizationId: ORG_ID,
      organizationIds: [ORG_ID],
    } as unknown as CommandRuntimeContext

    await expect(saveWarrantyClaimSettingsCommand.execute({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      slaHours: 36,
    }, ctx)).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: WINNER_AT.toISOString(),
        expectedUpdatedAt: ATTEMPTED_AT.toISOString(),
      },
    })

    expect(retryEm.flush).not.toHaveBeenCalled()
    expect(winner.slaHours).not.toBe(36)
  })
})
