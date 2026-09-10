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
      find: jest.fn(async (entity: unknown) => (entity === CustomFieldDef ? [definition] : [])),
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
      find: jest.fn(async (entity: unknown) => (entity === CustomFieldDef ? [definition] : [])),
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
    // Organization-free on purpose (#5970): the replacement must also clear rows written
    // under an organization the record has since left. The tenant boundary stays — the
    // filter reaches the caller's tenant and the instance-global NULL tenant, nothing else.
    expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, {
      entityId: 'customers:customer_deal',
      recordId: 'deal-1',
      fieldKey: 'segments',
      $or: [{ tenantId: 'tenant-1' }, { tenantId: null }],
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

  describe('logical-key reconciliation (#5970)', () => {
    const definition = {
      key: 'priority',
      kind: 'integer',
      organizationId: null,
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      configJson: {},
    }

    const makeEm = (rows: Array<Partial<CustomFieldValue>>, def: Record<string, unknown> = definition) => {
      const nativeDelete = jest.fn(async () => rows.length)
      const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
      const persist = jest.fn()
      const find = jest.fn(async (entity: unknown) => (entity === CustomFieldDef ? [def] : rows))
      const emMock = {
        find,
        create,
        persist,
        nativeDelete,
        flush: jest.fn(async () => undefined),
      }
      return { emMock, em: emMock as unknown as EntityManager, find, nativeDelete, create, persist }
    }

    it('deletes the row left behind by the record\'s previous organization instead of adding a second one', async () => {
      const staleRow = { id: 'value-org-a', organizationId: 'org-a', tenantId: 'tenant-1', valueInt: 3 }
      const { em, nativeDelete, create, persist } = makeEm([staleRow])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      // Without the fix the org-a row is invisible to the scoped lookup and survives next to
      // the org-b row, so (entity_id, record_id, field_key) resolves to two live values.
      expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, { id: { $in: ['value-org-a'] } })
      expect(create).toHaveBeenCalledTimes(1)
      expect(persist).toHaveBeenCalledWith([
        expect.objectContaining({ fieldKey: 'priority', organizationId: 'org-b', valueInt: 7 }),
      ])
      expect(nativeDelete.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
    })

    it('removes a stale NULL-scoped row that a SQL inequality predicate would have spared', async () => {
      const staleRow = { id: 'value-unscoped', organizationId: null, tenantId: null, valueInt: 1 }
      const { em, nativeDelete } = makeEm([staleRow])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, { id: { $in: ['value-unscoped'] } })
    })

    it('updates the row already in the current scope and collapses same-scope duplicates', async () => {
      const current = { id: 'value-current', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 3 }
      const duplicate = { id: 'value-duplicate', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 4 }
      const { em, nativeDelete, create, persist } = makeEm([current, duplicate])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      expect(current.valueInt).toBe(7)
      expect(create).not.toHaveBeenCalled()
      expect(persist).not.toHaveBeenCalled()
      expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, { id: { $in: ['value-duplicate'] } })
    })

    it('never reaches past the tenant boundary when looking for stale rows', async () => {
      const { em, find } = makeEm([])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      // Organization is deliberately absent from the filter; tenant is not. Another
      // tenant's rows for a colliding (entityId, recordId) must stay invisible to this
      // write, because a cross-tenant delete is a worse failure than a duplicate row.
      expect(find).toHaveBeenCalledWith(CustomFieldValue, {
        entityId: 'example:todo',
        recordId: 'record-1',
        fieldKey: 'priority',
        $or: [{ tenantId: 'tenant-1' }, { tenantId: null }],
      })
    })

    it('never writes the new value onto a soft-deleted row', async () => {
      const tombstone = { id: 'value-tombstone', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 3, deletedAt: new Date('2026-09-01T00:00:00.000Z') }
      const live = { id: 'value-live', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 4 }
      const { em, nativeDelete, create } = makeEm([tombstone, live])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      // Picking the tombstone would leave deleted_at set on the surviving row, hiding the
      // field from loadCustomFieldValues while the live row it replaced is deleted as stale.
      expect(live.valueInt).toBe(7)
      expect(tombstone.valueInt).toBe(3)
      expect(create).not.toHaveBeenCalled()
      // The tombstone is still removed: the Query Engine's join does not filter deleted_at.
      expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, { id: { $in: ['value-tombstone'] } })
    })

    it('collapses a multi-value field to one row when the caller writes a scalar', async () => {
      const multiDefinition = { ...definition, configJson: { multi: true } }
      const first = { id: 'value-a', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 1 }
      const second = { id: 'value-b', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 2 }
      const { em, nativeDelete } = makeEm([first, second], multiDefinition)

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      // The branch is chosen by Array.isArray(raw), not by the definition's multi flag, so a
      // scalar payload is a set-to-one write. Deliberate: leaving the other selections alive
      // is what produced the ambiguous multi-row read this reconciliation removes.
      expect(first.valueInt).toBe(7)
      expect(nativeDelete).toHaveBeenCalledWith(CustomFieldValue, { id: { $in: ['value-b'] } })
    })

    it('does not delete anything when the record has never left its scope', async () => {
      const current = { id: 'value-current', organizationId: 'org-b', tenantId: 'tenant-1', valueInt: 3 }
      const { em, nativeDelete } = makeEm([current])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      expect(nativeDelete).not.toHaveBeenCalled()
      expect(current.valueInt).toBe(7)
    })
  })
})
