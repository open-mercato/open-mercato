import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { AssistedSellingStoreSettings } from '../../data/entities'
import { saveAssistedSellingStoreSettingsCommand } from '../settings'
import { loadAssistedSellingStoreSettings } from '../../lib/settings'

jest.mock('../../lib/settings', () => {
  const actual = jest.requireActual('../../lib/settings')
  return { ...actual, loadAssistedSellingStoreSettings: jest.fn() }
})

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: jest.fn(async (em: { flush: () => Promise<void> }, phases: Array<() => void | Promise<void>>) => {
    for (const phase of phases) {
      await phase()
      await em.flush()
    }
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const loadAssistedSellingStoreSettingsMock =
  loadAssistedSellingStoreSettings as jest.MockedFunction<typeof loadAssistedSellingStoreSettings>
const withAtomicFlushMock = withAtomicFlush as jest.MockedFunction<typeof withAtomicFlush>

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

function containerFor(rootEm: EntityManager): CommandRuntimeContext['container'] {
  return {
    resolve: (name: string) => (name === 'em' ? rootEm : undefined),
    hasRegistration: () => false,
  } as unknown as CommandRuntimeContext['container']
}

function existingRow(overrides: Partial<AssistedSellingStoreSettings> = {}): AssistedSellingStoreSettings {
  return Object.assign(new AssistedSellingStoreSettings(), {
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
    ...overrides,
  })
}

describe('assisted_selling.settings.save', () => {
  beforeEach(() => {
    loadAssistedSellingStoreSettingsMock.mockReset()
    withAtomicFlushMock.mockClear()
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
    const ctx = makeCtx({ container: containerFor(rootEm) })

    const result = await saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
      ctx,
    )

    expect(result).toMatchObject({
      storeId: STORE_ID,
      mode: 'rep',
      proposalTtlSeconds: 259200,
      maxProposalLines: 50,
      conversationRetentionDays: 365,
      idleCloseDays: 30,
    })
    expect(created).toMatchObject({ tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID })
    expect(em.persist).toHaveBeenCalledTimes(1)
  })

  test('writes through withAtomicFlush in a transaction', async () => {
    loadAssistedSellingStoreSettingsMock.mockImplementationOnce(async () => {
      expect(withAtomicFlushMock).toHaveBeenCalledTimes(1)
      return existingRow()
    })
    const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager

    await saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'off' },
      makeCtx({ container: containerFor(rootEm) }),
    )

    expect(withAtomicFlushMock).toHaveBeenCalledWith(
      em,
      expect.any(Array),
      expect.objectContaining({ transaction: true }),
    )
    expect(loadAssistedSellingStoreSettingsMock).toHaveBeenCalledWith(
      em, { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID }, true,
    )
  })

  test('updates only the fields the caller sent, leaving the rest untouched', async () => {
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(existingRow())
    const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager

    const result = await saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, idleCloseDays: 45 },
      makeCtx({ container: containerFor(rootEm) }),
    )

    expect(result.idleCloseDays).toBe(45)
    expect(result.mode).toBe('rep')
    expect(result.maxProposalLines).toBe(25)
    expect(result.proposalTtlSeconds).toBe(72000)
  })

  test('advances the version when the clock is at the current version', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(ATTEMPTED_AT.getTime())
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(existingRow())
    const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager
    try {
      const result = await saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID },
        makeCtx({ container: containerFor(rootEm) }),
      )
      expect(result.updatedAt).toBe(new Date(ATTEMPTED_AT.getTime() + 1).toISOString())
    } finally {
      clock.mockRestore()
    }
  })

  test('refuses a stale version on an existing row with 409', async () => {
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(existingRow({ updatedAt: WINNER_AT }))
    const em = { flush: jest.fn(async () => undefined) } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager
    const request = new Request('http://localhost/api/assisted_selling/settings/x', {
      method: 'PUT',
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: ATTEMPTED_AT.toISOString() },
    })

    await expect(
      saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'off' },
        makeCtx({ container: containerFor(rootEm), request }),
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  test('answers 409 to the loser of a concurrent first save instead of overwriting the winner', async () => {
    const attempted = Object.assign(new AssistedSellingStoreSettings(), {
      id: '33333333-3333-4333-8333-333333333334',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      storeId: STORE_ID,
      updatedAt: ATTEMPTED_AT,
    })
    const winner = existingRow({ id: '44444444-4444-4444-8444-444444444444', updatedAt: WINNER_AT })
    const firstEm = {
      create: jest.fn((_entity, data: { updatedAt: Date }) => Object.assign(attempted, data)),
      persist: jest.fn(),
      flush: jest.fn(async () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }) }),
    } as unknown as EntityManager
    const retryEm = { flush: jest.fn() } as unknown as EntityManager
    const rootEm = {
      fork: jest.fn().mockReturnValueOnce(firstEm).mockReturnValueOnce(retryEm),
    } as unknown as EntityManager
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(null).mockResolvedValueOnce(winner)

    const outcome = saveAssistedSellingStoreSettingsCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
      makeCtx({ container: containerFor(rootEm) }),
    )
    await expect(outcome).rejects.toMatchObject({
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: WINNER_AT.toISOString(),
        expectedUpdatedAt: expect.any(String),
      },
    })
    await expect(outcome).rejects.toMatchObject({ body: { expectedUpdatedAt: attempted.updatedAt.toISOString() } })
    expect(retryEm.flush).not.toHaveBeenCalled()
  })

  test('rethrows a non-unique failure unchanged', async () => {
    loadAssistedSellingStoreSettingsMock.mockResolvedValueOnce(null)
    const failure = new Error('connection reset')
    const em = {
      create: jest.fn((_cls, data) => Object.assign(new AssistedSellingStoreSettings(), data)),
      persist: jest.fn(),
      flush: jest.fn(async () => { throw failure }),
    } as unknown as EntityManager
    const rootEm = { fork: jest.fn(() => em) } as unknown as EntityManager

    await expect(
      saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
        makeCtx({ container: containerFor(rootEm) }),
      ),
    ).rejects.toBe(failure)
  })

  test('refuses mode ai with 400 before touching the database', async () => {
    await expect(
      saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: TENANT_ID, organizationId: ORG_ID, storeId: STORE_ID, mode: 'ai' } as never,
        makeCtx(),
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(loadAssistedSellingStoreSettingsMock).not.toHaveBeenCalled()
  })

  test('refuses a cross-tenant input before touching the database', async () => {
    await expect(
      saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: '77777777-7777-4777-8777-777777777777', organizationId: ORG_ID, storeId: STORE_ID, mode: 'rep' },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(loadAssistedSellingStoreSettingsMock).not.toHaveBeenCalled()
  })

  test('refuses an organization outside the caller\'s scope before touching the database', async () => {
    await expect(
      saveAssistedSellingStoreSettingsCommand.execute(
        { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, storeId: STORE_ID, mode: 'rep' },
        makeCtx(),
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(loadAssistedSellingStoreSettingsMock).not.toHaveBeenCalled()
  })

  test('logs the save under assisted_selling.settings.save with the settings row', async () => {
    const log = await saveAssistedSellingStoreSettingsCommand.buildLog!({
      input: { tenantId: TENANT_ID, organizationId: OTHER_ORG_ID, storeId: STORE_ID },
      result: {
        settingsId: '55555555-5555-4555-8555-555555555555',
        storeId: STORE_ID,
        mode: 'rep',
        proposalTtlSeconds: 259200,
        maxProposalLines: 50,
        conversationRetentionDays: 365,
        idleCloseDays: 30,
        updatedAt: null,
      },
      ctx: makeCtx(),
    } as never)

    expect(log).toMatchObject({
      actionLabel: 'Save assisted selling settings',
      resourceKind: 'assisted_selling.store_settings',
      resourceId: '55555555-5555-4555-8555-555555555555',
      tenantId: TENANT_ID,
      organizationId: OTHER_ORG_ID,
    })
  })
})
