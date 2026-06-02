/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
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
})
