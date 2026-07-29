/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import { CustomFieldDef, CustomFieldValue } from '../../data/entities'
import { setRecordCustomFields } from '../helpers'

describe('setRecordCustomFields', () => {
  it('persists dynamic keys for trusted command writes (whitelist is enforced upstream)', async () => {
    const definition = {
      key: 'priority',
      kind: 'integer',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-03-31T00:00:00.000Z'),
      configJson: {},
    }
    const persist = jest.fn()
    const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
    const em = {
      find: jest.fn(async () => [definition]),
      findOne: jest.fn(async () => null),
      create,
      persist,
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    // First-party flows (CRM dialog, todo adapters, example sync) intentionally
    // persist undeclared/internal keys; the EAV mass-assignment guard lives at the
    // untrusted `/api/entities/records` boundary, not here.
    await setRecordCustomFields(em, {
      entityId: 'example:todo',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { priority: 3, callPhoneNumber: '+15555550100' },
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldKey: 'priority' }),
    )
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldKey: 'callPhoneNumber' }),
    )
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('stores phone custom fields in the value_text column (#62)', async () => {
    const definition = {
      key: 'work_phone',
      kind: 'phone',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
      configJson: {},
    }
    const persist = jest.fn()
    const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
    const em = {
      find: jest.fn(async () => [definition]),
      findOne: jest.fn(async () => null),
      create,
      persist,
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    await setRecordCustomFields(em, {
      entityId: 'auth:user',
      recordId: 'user-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { work_phone: '+1 212 555 1234' },
    })

    const persisted = (persist.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>
    const row = persisted.find((entry) => entry.fieldKey === 'work_phone')
    expect(row?.valueText).toBe('+1 212 555 1234')
    // Discriminating: a wrong column mapping would leave valueText null.
    expect(row?.valueInt ?? null).toBeNull()
    expect(row?.valueMultiline ?? null).toBeNull()
  })

  it('still enforces the per-record key cap as the unbounded-injection backstop', async () => {
    const persist = jest.fn()
    const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
    const em = {
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
      create,
      persist,
      flush: jest.fn(async () => undefined),
    } as unknown as EntityManager

    const values: Record<string, number> = {}
    for (let index = 0; index < 200; index++) values[`field_${index}`] = index

    await expect(
      setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        values,
      }),
    ).rejects.toThrow()
    expect(persist).not.toHaveBeenCalled()
  })

  it('replaces multi-value custom fields without deleting the replacement rows', async () => {
    const definition = {
      key: 'segments',
      kind: 'select',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-06-05T00:00:00.000Z'),
      configJson: { multi: true },
    }
    const persist = jest.fn()
    const remove = jest.fn()
    const nativeDelete = jest.fn(async () => 2)
    const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
    const emMock = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === CustomFieldDef) return [definition]
        if (entity === CustomFieldValue) return []
        return []
      }),
      findOne: jest.fn(async () => null),
      create,
      remove,
      nativeDelete,
      persist,
      flush: jest.fn(async () => undefined),
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      isInTransaction: jest.fn(() => false),
    }
    const em = emMock as unknown as EntityManager

    await setRecordCustomFields(em, {
      entityId: 'customers:customer_deal',
      recordId: 'deal-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { segments: ['gamma', 'delta'] },
    })

    expect(remove).not.toHaveBeenCalled()
    expect(nativeDelete).toHaveBeenCalledTimes(1)
    expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, {
      entityId: 'customers:customer_deal',
      recordId: 'deal-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      fieldKey: 'segments',
    })
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith([
      expect.objectContaining({ fieldKey: 'segments', valueText: 'gamma' }),
      expect.objectContaining({ fieldKey: 'segments', valueText: 'delta' }),
    ])
    expect(nativeDelete.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
    expect(emMock.flush).toHaveBeenCalledTimes(1)
    expect(emMock.begin).toHaveBeenCalledTimes(1)
    expect(emMock.commit).toHaveBeenCalledTimes(1)
    expect(emMock.rollback).not.toHaveBeenCalled()
  })
})
