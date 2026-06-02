/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import { setRecordCustomFields } from '../helpers'

describe('setRecordCustomFields', () => {
  it('skips undeclared keys when preferDefs is enabled', async () => {
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

    await setRecordCustomFields(em, {
      entityId: 'example:todo',
      recordId: 'record-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { priority: 3, undeclared: 'ignored' },
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fieldKey: 'priority' }),
    )
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
