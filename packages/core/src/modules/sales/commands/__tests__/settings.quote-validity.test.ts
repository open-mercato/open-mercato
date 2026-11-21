/** @jest-environment node */
import { asValue, createContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { QuoteValiditySettingsSaveInput } from '../../data/validators'
import { SalesSettings } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: { findOne: (entity: unknown, where: unknown, options: unknown) => unknown }, entity: unknown, where: unknown, options: unknown) => em.findOne(entity, where, options),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const currentVersion = '2026-11-04T12:00:00.000Z'

function harness(withRecord = true, expected = currentVersion) {
  const settings = {
    id: '33333333-3333-4333-8333-333333333333', tenantId, organizationId,
    defaultQuoteValidityDays: 14, orderNumberFormat: 'ORDER-{seq:5}', quoteNumberFormat: 'QUOTE-{seq:5}',
    orderCustomerEditableStatuses: ['draft'], orderAddressEditableStatuses: ['draft'], updatedAt: new Date(currentVersion),
  }
  const transactionEm = {
    findOne: withRecord ? jest.fn().mockResolvedValue(settings) : jest.fn().mockResolvedValueOnce(null).mockResolvedValue(settings),
    upsert: jest.fn().mockResolvedValue(settings),
    create: jest.fn().mockImplementation((_entity: unknown, data: object) => ({ ...data, updatedAt: new Date(currentVersion) })),
    persist: jest.fn(), flush: jest.fn().mockResolvedValue(undefined),
  }
  const transactional = jest.fn(async (callback: (em: typeof transactionEm) => Promise<unknown>) => callback(transactionEm))
  const container = createContainer()
  const lockGuard = jest.fn().mockResolvedValue(undefined)
  container.register('em', asValue({ fork: () => ({ transactional }) }))
  container.register('commandOptimisticLockGuardService', asValue({ enforce: lockGuard }))
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: 'user', tenantId, orgId: organizationId }, selectedOrganizationId: organizationId,
    organizationIds: [organizationId], organizationScope: null,
    request: new Request('http://localhost/settings', { headers: { 'x-om-ext-optimistic-lock-expected-updated-at': expected } }),
  }
  return { ctx, transactionEm, settings, transactional, lockGuard }
}

async function execute(ctx: CommandRuntimeContext, overrides: Partial<QuoteValiditySettingsSaveInput> = {}) {
  const handler = commandRegistry.get<QuoteValiditySettingsSaveInput, { defaultQuoteValidityDays: number; updatedAt: string }>('sales.settings.quote_validity.save')
  if (!handler) throw new Error('[internal] quote validity command not registered')
  return handler.execute({ tenantId, organizationId, defaultQuoteValidityDays: 30, ...overrides }, ctx)
}

beforeAll(async () => { await import('../settings') })
it('locks the scoped row inside the transaction and changes only quote validity', async () => {
  const { ctx, settings, transactionEm, transactional, lockGuard } = harness()
  const result = await execute(ctx)
  expect(transactional).toHaveBeenCalledTimes(1)
  expect(transactionEm.findOne).toHaveBeenCalledWith(SalesSettings, { tenantId, organizationId }, { lockMode: LockMode.PESSIMISTIC_WRITE })
  expect(result.defaultQuoteValidityDays).toBe(30)
  expect(result.updatedAt).toBe(settings.updatedAt.toISOString())
  expect(settings.orderNumberFormat).toBe('ORDER-{seq:5}')
  expect(settings.quoteNumberFormat).toBe('QUOTE-{seq:5}')
  expect(settings.orderCustomerEditableStatuses).toEqual(['draft'])
  expect(lockGuard).toHaveBeenCalledWith({ resourceKind: 'sales.settings', resourceId: settings.id, current: new Date(currentVersion), request: ctx.request })
  expect(transactionEm.flush).toHaveBeenCalledTimes(1)
})
it('creates ordinary scoped settings with numbering defaults when no row exists', async () => {
  const { ctx, transactionEm } = harness(false)
  expect((await execute(ctx)).defaultQuoteValidityDays).toBe(30)
  expect(transactionEm.upsert).toHaveBeenCalledWith(SalesSettings, expect.objectContaining({ tenantId, organizationId, updatedAt: expect.any(Date) }), { onConflictFields: ['organizationId', 'tenantId'], onConflictAction: 'ignore' })
  expect(transactionEm.findOne).toHaveBeenCalledTimes(2)
  expect(transactionEm.persist).not.toHaveBeenCalled()
})
it('rejects a stale version before changing or flushing settings', async () => {
  const { ctx, settings, transactionEm, lockGuard } = harness(true, '2026-11-03T12:00:00.000Z')
  await expect(execute(ctx)).rejects.toMatchObject({ status: 409, body: { code: 'optimistic_lock_conflict' } })
  expect(settings.defaultQuoteValidityDays).toBe(14)
  expect(transactionEm.flush).not.toHaveBeenCalled()
  expect(lockGuard).not.toHaveBeenCalled()
})
it('awaits the registered record lock guard and preserves its rejection before changing settings', async () => {
  const { ctx, settings, transactionEm, lockGuard } = harness()
  const rejection = new CrudHttpError(409, { error: 'Record is locked', code: 'record_lock_conflict' })
  lockGuard.mockRejectedValue(rejection)
  await expect(execute(ctx)).rejects.toBe(rejection)
  expect(settings.defaultQuoteValidityDays).toBe(14)
  expect(settings.updatedAt).toEqual(new Date(currentVersion))
  expect(transactionEm.flush).not.toHaveBeenCalled()
})
it('rejects a forged organization before starting a transaction', async () => {
  const { ctx, transactional } = harness()
  await expect(execute(ctx, { organizationId: '44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ status: 403 })
  expect(transactional).not.toHaveBeenCalled()
})
