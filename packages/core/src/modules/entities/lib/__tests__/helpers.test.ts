/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/core'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { CustomFieldDef, CustomFieldValue } from '../../data/entities'
import { setRecordCustomFields } from '../helpers'

type StoredDefinition = Record<string, unknown>

// Mirrors PostgreSQL comparison semantics for the operators the definition
// lookup uses. The point of the org-NULL regression tests below is that
// `IN (?, NULL)` never matches a NULL column, so a stub that ignores the where
// clause (or treats `$in` as JS `includes`) would pass against the bug.
function matchesWhere(definition: StoredDefinition, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Record<string, unknown>[]).every((sub) => matchesWhere(definition, sub))
    if (key === '$or') return (condition as Record<string, unknown>[]).some((sub) => matchesWhere(definition, sub))
    const columnValue = definition[key] ?? null
    if (condition && typeof condition === 'object' && '$in' in (condition as Record<string, unknown>)) {
      const candidates = (condition as { $in: unknown[] }).$in
      if (columnValue === null) return false
      return candidates.some((candidate) => candidate !== null && candidate === columnValue)
    }
    return columnValue === (condition ?? null)
  })
}

function createScopedEm(definitions: StoredDefinition[], encryptionService?: TenantDataEncryptionService) {
  const persist = jest.fn()
  const create = jest.fn((entity: unknown, data: Record<string, unknown>) => ({ ...data, entity }))
  const find = jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity !== CustomFieldDef) return []
    return definitions.filter((definition) => matchesWhere(definition, where))
  })
  const em = {
    find,
    findOne: jest.fn(async () => null),
    create,
    persist,
    flush: jest.fn(async () => undefined),
  } as unknown as EntityManager
  return { em, find, create, persist, encryptionService }
}

const TEST_DEK = Buffer.alloc(32, 7).toString('base64')

function createEnabledEncryptionService(): TenantDataEncryptionService {
  return {
    isEnabled: () => true,
    getDek: async () => ({ key: TEST_DEK }),
    createDek: async () => ({ key: TEST_DEK }),
  } as unknown as TenantDataEncryptionService
}

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

    it('scopes the lookup by organizationId when pinOrganizationId is set, so a colliding recordId in another organization cannot be reached (#6034)', async () => {
      // custom_entities_storage upserts on (entity_type, entity_id, organization_id), so the
      // same recordId can be a live record in org-a and org-b at once — the recordId-is-globally-
      // unique invariant this reconciliation otherwise relies on does not hold for those writes.
      // pinOrganizationId adds organizationId back to the query, so org-a's row is never even
      // fetched by an org-b write, and cannot be picked up as "left behind" and deleted.
      const { em, find } = makeEm([])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
        pinOrganizationId: true,
      })

      expect(find).toHaveBeenCalledWith(CustomFieldValue, {
        entityId: 'example:todo',
        recordId: 'record-1',
        fieldKey: 'priority',
        organizationId: 'org-b',
        $or: [{ tenantId: 'tenant-1' }, { tenantId: null }],
      })
    })

    it('leaves organizationId out of the lookup by default, matching another organization\'s row for the same recordId (#5970)', async () => {
      const { em, find } = makeEm([])

      await setRecordCustomFields(em, {
        entityId: 'example:todo',
        recordId: 'record-1',
        organizationId: 'org-b',
        tenantId: 'tenant-1',
        values: { priority: 7 },
      })

      const [, where] = find.mock.calls.find(([entity]) => entity === CustomFieldValue) ?? []
      expect(where).not.toHaveProperty('organizationId')
    })
  })

  it('encrypts values for a tenant-wide definition that leaves organization_id null (#5919)', async () => {
    const definition = {
      key: 'ssn',
      kind: 'text',
      entityId: 'customers:person',
      isActive: true,
      deletedAt: null,
      organizationId: null,
      tenantId: 'tenant-1',
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      configJson: { encrypted: true },
    }
    const { em, persist } = createScopedEm([definition])

    await setRecordCustomFields(em, {
      entityId: 'customers:person',
      recordId: 'person-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { ssn: '123-45-6789' },
      encryptionService: createEnabledEncryptionService(),
    })

    const persisted = (persist.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>
    const row = persisted.find((entry) => entry.fieldKey === 'ssn')
    // Before the fix the definition lookup returned nothing, the `encrypted`
    // flag was never seen, and the raw value landed in value_text as plaintext.
    expect(row?.valueText).not.toBe('123-45-6789')
    expect(decryptWithAesGcm(String(row?.valueText), TEST_DEK)).toBe('123-45-6789')
  })

  it('honours the declared kind of a fully global definition (#5919)', async () => {
    const definition = {
      key: 'headcount',
      kind: 'integer',
      entityId: 'customers:company',
      isActive: true,
      deletedAt: null,
      organizationId: null,
      tenantId: null,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      configJson: {},
    }
    const { em, persist } = createScopedEm([definition])

    await setRecordCustomFields(em, {
      entityId: 'customers:company',
      recordId: 'company-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { headcount: '42' },
    })

    const persisted = (persist.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>
    const row = persisted.find((entry) => entry.fieldKey === 'headcount')
    // Without the definition the write path falls back to the JS type of the
    // incoming value, so the string '42' would be stored in value_text.
    expect(row?.valueInt).toBe(42)
    expect(row?.valueText ?? null).toBeNull()
  })

  it('still prefers the org-scoped definition over the global one for the same key (#5919)', async () => {
    const shared = {
      key: 'tier',
      entityId: 'customers:person',
      isActive: true,
      deletedAt: null,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      configJson: {},
    }
    const { em, persist } = createScopedEm([
      { ...shared, kind: 'text', organizationId: null, tenantId: null },
      { ...shared, kind: 'integer', organizationId: 'org-1', tenantId: 'tenant-1' },
    ])

    await setRecordCustomFields(em, {
      entityId: 'customers:person',
      recordId: 'person-2',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { tier: '3' },
    })

    const persisted = (persist.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>
    const row = persisted.find((entry) => entry.fieldKey === 'tier')
    expect(row?.valueInt).toBe(3)
    expect(row?.valueText ?? null).toBeNull()
  })

  it('never filters definition scope with a literal null inside $in (#5919)', async () => {
    const { em, find } = createScopedEm([])

    await setRecordCustomFields(em, {
      entityId: 'customers:person',
      recordId: 'person-3',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      values: { anything: 'x' },
    })

    const where = JSON.stringify(find.mock.calls[0]?.[1] ?? {})
    expect(where).not.toContain('"$in"')
    expect(find.mock.calls[0]?.[1]).toMatchObject({
      $and: [
        { $or: [{ organizationId: 'org-1' }, { organizationId: null }] },
        { $or: [{ tenantId: 'tenant-1' }, { tenantId: null }] },
      ],
    })
  })
})
