/** @jest-environment node */
import { resolveDictionaryEntryValue, resetDictionaryEntryValueCache } from '../dictionaries'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

type EntryRow = {
  id: string
  tenantId: string
  organizationId: string
  value: string
}

function createEntityManager(rows: EntryRow[]) {
  // Mirrors MikroORM semantics: a bare scalar second argument is treated as a
  // primary-key lookup, while an object is treated as a where-filter.
  const findOne = jest.fn(async (_entity: unknown, where: unknown) => {
    if (typeof where === 'string') {
      return rows.find((row) => row.id === where) ?? null
    }
    const filter = where as Partial<EntryRow>
    return (
      rows.find(
        (row) =>
          (filter.id === undefined || row.id === filter.id) &&
          (filter.tenantId === undefined || row.tenantId === filter.tenantId) &&
          (filter.organizationId === undefined || row.organizationId === filter.organizationId),
      ) ?? null
    )
  })
  return { em: { findOne } as unknown as any, findOne }
}

// The resolved-value memo is process-global, so reset it between tests for determinism.
beforeEach(() => {
  resetDictionaryEntryValueCache()
})

describe('resolveDictionaryEntryValue tenant scoping (issue #2740)', () => {
  const rows: EntryRow[] = [
    { id: 'entry-a', tenantId: TENANT_A, organizationId: 'org-a', value: 'Approved (A)' },
    { id: 'entry-b', tenantId: TENANT_B, organizationId: 'org-b', value: 'Approved (B)' },
  ]

  it('does not resolve an entry that belongs to another tenant', async () => {
    const { em } = createEntityManager(rows)
    const value = await resolveDictionaryEntryValue(em, 'entry-b', { tenantId: TENANT_A })
    expect(value).toBeNull()
  })

  it('scopes the dictionary lookup by tenant id', async () => {
    const { em, findOne } = createEntityManager(rows)
    await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    expect(findOne).toHaveBeenCalledWith(
      'DictionaryEntry',
      expect.objectContaining({ id: 'entry-a', tenantId: TENANT_A }),
    )
  })

  it('resolves the entry value within the caller tenant', async () => {
    const { em } = createEntityManager(rows)
    const value = await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    expect(value).toBe('Approved (A)')
  })

  it('returns null without querying when no entry id is provided', async () => {
    const { em, findOne } = createEntityManager(rows)
    const value = await resolveDictionaryEntryValue(em, null, { tenantId: TENANT_A })
    expect(value).toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })
})

describe('resolveDictionaryEntryValue memoization', () => {
  // Same entry id under two tenants — the memo must not leak across the tenant boundary.
  const rows: EntryRow[] = [
    { id: 'entry-a', tenantId: TENANT_A, organizationId: 'org-a', value: 'Approved (A)' },
    { id: 'entry-a', tenantId: TENANT_B, organizationId: 'org-b', value: 'Approved (B)' },
  ]

  it('reads the entry once and serves repeat lookups from the memo', async () => {
    const { em, findOne } = createEntityManager(rows)
    const first = await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    const second = await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    expect(first).toBe('Approved (A)')
    expect(second).toBe('Approved (A)')
    expect(findOne).toHaveBeenCalledTimes(1)
  })

  it('keys the memo by tenant so the same entry id does not leak across tenants', async () => {
    const { em, findOne } = createEntityManager(rows)
    const a = await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    const b = await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_B })
    expect(a).toBe('Approved (A)')
    expect(b).toBe('Approved (B)')
    expect(findOne).toHaveBeenCalledTimes(2)
  })

  it('memoizes a missing entry (negative result) too', async () => {
    const { em, findOne } = createEntityManager(rows)
    const first = await resolveDictionaryEntryValue(em, 'missing', { tenantId: TENANT_A })
    const second = await resolveDictionaryEntryValue(em, 'missing', { tenantId: TENANT_A })
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(findOne).toHaveBeenCalledTimes(1)
  })

  it('re-reads after resetDictionaryEntryValueCache()', async () => {
    const { em, findOne } = createEntityManager(rows)
    await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    resetDictionaryEntryValueCache()
    await resolveDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A })
    expect(findOne).toHaveBeenCalledTimes(2)
  })
})
