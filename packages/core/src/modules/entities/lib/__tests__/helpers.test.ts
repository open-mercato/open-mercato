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
