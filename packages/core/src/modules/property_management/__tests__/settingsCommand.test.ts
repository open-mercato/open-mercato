/** @jest-environment node */
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { PropertyManagementSettings } from '../data/entities'
import { FakeEm } from './support/fakeEm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))

import '../commands'
import { LockMode } from '@mikro-orm/core'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { orderStatusEntryExists } from '../lib/salesLookups'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const STATUS = '33333333-3333-4333-8333-333333333333'
const CHANNEL = '44444444-4444-4444-8444-444444444444'
const input = { ...scope, billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 }

const rbac = { userHasAllFeatures: jest.fn(async () => true) }

function buildCtx(em: FakeEm): CommandRuntimeContext {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : name === 'rbacService' ? rbac : undefined) } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

async function save(em: FakeEm): Promise<{ settingsId: string | null }> {
  const handler = commandRegistry.get('property_management.settings.save')
  if (!handler) throw new Error('[internal] missing property_management.settings.save')
  return handler.execute(input, buildCtx(em)) as Promise<{ settingsId: string | null }>
}

async function undo(em: FakeEm, payload: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }): Promise<void> {
  const handler = commandRegistry.get('property_management.settings.save')
  if (!handler?.undo) throw new Error('[internal] missing property_management.settings.save undo')
  await handler.undo({ logEntry: { commandPayload: { undo: { scope, ...payload } } } as never, ctx: buildCtx(em) } as never)
}

describe('property_management.settings.save', () => {
  it('creates the row on the first save', async () => {
    const em = new FakeEm()
    const result = await save(em)
    expect(em.rows(PropertyManagementSettings)).toEqual([expect.objectContaining({ id: result.settingsId, leaseEndingThresholdDays: 30 })])
  })

  it('answers 409 instead of failing when a concurrent first save inserted the row', async () => {
    const em = new FakeEm()
    jest.spyOn(em, 'flush').mockRejectedValueOnce(
      new UniqueConstraintViolationException(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })),
    )
    await expect(save(em)).rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'settings_changed' }) })
    await expect(save(em)).resolves.toMatchObject({ settingsId: expect.any(String) })
  })

  it('checks the version against the row it locked before writing', async () => {
    const em = new FakeEm()
    const updatedAt = new Date('2026-11-01T10:00:00Z')
    const row = em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 60, updatedAt } as never)
    const findOne = jest.spyOn(em, 'findOne')
    await save(em)
    expect(findOne).toHaveBeenCalledWith(PropertyManagementSettings, expect.anything(), expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }))
    expect(enforceCommandOptimisticLockWithGuards).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resourceId: 'settings-1', current: updatedAt }))
    expect(row).toMatchObject({ leaseEndingThresholdDays: 30 })
  })

  it('leaves the row untouched when the locked version is stale', async () => {
    const em = new FakeEm()
    const row = em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 60 } as never)
    jest.mocked(enforceCommandOptimisticLockWithGuards).mockRejectedValueOnce(new CrudHttpError(409, { code: 'record_conflict' }))
    await expect(save(em)).rejects.toMatchObject({ status: 409 })
    expect(row).toMatchObject({ leaseEndingThresholdDays: 60 })
  })

  it('refuses a caller who does not manage every building and leaves the row alone', async () => {
    const em = new FakeEm()
    const row = em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 60 } as never)
    rbac.userHasAllFeatures.mockResolvedValueOnce(false)
    await expect(save(em)).rejects.toMatchObject({ status: 403, body: expect.objectContaining({ code: 'settings_forbidden' }) })
    expect(rbac.userHasAllFeatures).toHaveBeenLastCalledWith('user-1', ['property_management.manage', 'property_management.buildings.manage_all'], { tenantId: TENANT, organizationId: ORG })
    expect(row).toMatchObject({ leaseEndingThresholdDays: 60 })
  })

  it('undoes only while the row still holds what the save wrote', async () => {
    const em = new FakeEm()
    const row = em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 } as never)
    const before = { billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 60, bookingReminderMinutes: 60, proposalExpiryDays: 14 }
    const after = { ...before, leaseEndingThresholdDays: 30 }
    await expect(undo(em, { before, after: { ...after, leaseEndingThresholdDays: 45 } })).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({ code: 'settings_changed' }),
    })
    expect(row).toMatchObject({ leaseEndingThresholdDays: 30 })
    await undo(em, { before, after })
    expect(row).toMatchObject({ leaseEndingThresholdDays: 60 })
  })

  it('refuses to restore a billing channel that no longer exists', async () => {
    const em = new FakeEm()
    const row = em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: null, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 } as never)
    const after = { billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 }
    em.respond = () => []
    await expect(undo(em, { before: { ...after, billingChannelId: CHANNEL }, after })).rejects.toMatchObject({ status: 422 })
    expect(row).toMatchObject({ billingChannelId: null })
  })

  it('refuses undo to a caller without property_management.manage', async () => {
    const em = new FakeEm()
    const after = { billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 }
    rbac.userHasAllFeatures.mockResolvedValueOnce(false)
    await expect(undo(em, { before: null, after })).rejects.toMatchObject({ status: 403 })
  })

  it('does not hide other write failures', async () => {
    const em = new FakeEm()
    jest.spyOn(em, 'flush').mockRejectedValueOnce(new Error('connection lost'))
    const outcome = save(em)
    await expect(outcome).rejects.toThrow('connection lost')
    await expect(outcome).rejects.not.toBeInstanceOf(CrudHttpError)
  })
})

describe('orderStatusEntryExists', () => {
  it('only accepts entries of the organization’s live order-status dictionary', async () => {
    const em = new FakeEm()
    em.respond = () => [{ id: STATUS }]
    expect(await orderStatusEntryExists(em as never, scope, STATUS)).toBe(true)
    const [{ sql, params }] = em.executed
    expect(sql).toContain('dictionary.deleted_at is null')
    expect(sql).toContain('dictionary.organization_id = ?')
    expect(params).toEqual([STATUS, ORG, TENANT, ORG, TENANT])
  })
})
