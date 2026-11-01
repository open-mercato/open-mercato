import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AssistedSellingStoreSettings } from '../../data/entities'
import { saveAssistedSellingStoreSettingsCommand } from '../settings'
import { loadAssistedSellingStoreSettings } from '../../lib/settings'

jest.mock('../../lib/settings', () => {
  const actual = jest.requireActual('../../lib/settings')
  return { ...actual, loadAssistedSellingStoreSettings: jest.fn() }
})

const loadAssistedSellingStoreSettingsMock =
  loadAssistedSellingStoreSettings as jest.MockedFunction<typeof loadAssistedSellingStoreSettings>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const ATTEMPTED_AT = new Date('2026-08-13T08:00:00.000Z')
const WINNER_AT = new Date('2026-08-13T08:00:01.000Z')

function makeCtx(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: { resolve: () => ({}) },
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: { tenantId: TENANT_ID, selectedId: ORG_ID, allowedIds: [ORG_ID], filterIds: [ORG_ID] },
    ...overrides,
  } as unknown as CommandRuntimeContext
}

describe('assisted_selling.settings.save', () => {
  beforeEach(() => {
    loadAssistedSellingStoreSettingsMock.mockReset()
  })

  test('creates a row with §5.6 defaults when none exists, applying the given mode', async () => {
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(null)
    const created: Partial<AssistedSellingStoreSettings> = {}
    const em = {
      create: jest.fn((_cls, data) => Object.assign(created, data)),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager
    const ctx = makeCtx({ container: { resolve: () => rootEm } as unknown as CommandRuntimeContext['container'] })

    const result = await saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
      ctx,
    )

    expect(result.mode).toBe('rep')
    expect(result.proposalTtlSeconds).toBe(259200)
    expect(result.maxProposalLines).toBe(50)
    expect(result.conversationRetentionDays).toBe(365)
    expect(result.idleCloseDays).toBe(30)
    expect(result.storeId).toBe(STORE_ID)
  })

  test('updates only the fields the caller sent, leaving the rest untouched', async () => {
    const existing = Object.assign(new AssistedSellingStoreSettings(), {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      mode: 'rep',
      proposalTtlSeconds: 72000,
      maxProposalLines: 25,
      conversationRetentionDays: 200,
      idleCloseDays: 15,
      updatedAt: ATTEMPTED_AT,
    })
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(existing)
    const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager
    const ctx = makeCtx({ container: { resolve: () => rootEm } as unknown as CommandRuntimeContext['container'] })

    const result = await saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, idleCloseDays: 45 },
      ctx,
    )

    expect(result.idleCloseDays).toBe(45)
    expect(result.mode).toBe('rep')
    expect(result.maxProposalLines).toBe(25)
  })

  test('surfaces a first-save race as an optimistic-lock conflict instead of overwriting the winner', async () => {
    const attempted = Object.assign(new AssistedSellingStoreSettings(), {
      id: '33333333-3333-4333-8333-333333333334',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      updatedAt: ATTEMPTED_AT,
    })
    const winner = Object.assign(new AssistedSellingStoreSettings(), {
      id: '44444444-4444-4444-8444-444444444444',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
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
    loadAssistedSellingStoreSettingsMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    const ctx = makeCtx({ container: { resolve: () => rootEm } as unknown as CommandRuntimeContext['container'] })

    await expect(saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
      ctx,
    )).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: WINNER_AT.toISOString(),
        expectedUpdatedAt: ATTEMPTED_AT.toISOString(),
      },
    })

    expect(retryEm.flush).not.toHaveBeenCalled()
  })

  test('refuses a cross-tenant input before touching the database', async () => {
    const ctx = makeCtx()

    await expect(saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: '77777777-7777-4777-8777-777777777777', organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
      ctx,
    )).rejects.toMatchObject({ status: 403 })

    expect(loadAssistedSellingStoreSettingsMock).not.toHaveBeenCalled()
  })

  test('refuses an organization outside the caller\'s scope before touching the database', async () => {
    const ctx = makeCtx()

    await expect(saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, storeId: STORE_ID, mode: 'rep' },
      ctx,
    )).rejects.toMatchObject({ status: 403 })

    expect(loadAssistedSellingStoreSettingsMock).not.toHaveBeenCalled()
  })
})
