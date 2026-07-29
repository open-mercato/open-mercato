/** @jest-environment node */
import { resolveDictionaryEntryValue, resolveCachedDictionaryEntryValue } from '../dictionaries'
import { runWithCacheTenant } from '@open-mercato/cache'
import { buildRecordTag } from '@open-mercato/shared/lib/crud/cache'

jest.mock('@open-mercato/core/modules/dictionaries/data/entities', () => ({
  Dictionary: 'Dictionary',
  DictionaryEntry: 'DictionaryEntry',
}))

// The tenant scoping of the cache key is the cache service's job (runWithCacheTenant); here we only
// need it to run the callback, and we assert it is invoked with the caller's tenant id.
jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: jest.fn((_tenantId: string | null, fn: () => unknown) => fn()),
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

// A minimal in-memory stand-in for the shared cache service (only get/set are used here).
function createCache() {
  const store = new Map<string, unknown>()
  const get = jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null))
  const set = jest.fn(async (key: string, value: unknown, _options?: unknown) => {
    store.set(key, value)
  })
  return { get, set }
}

beforeEach(() => {
  jest.clearAllMocks()
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

describe('resolveCachedDictionaryEntryValue', () => {
  const rows: EntryRow[] = [
    { id: 'entry-a', tenantId: TENANT_A, organizationId: 'org-a', value: 'Approved (A)' },
  ]

  it('reads the entry once and serves repeat lookups from the shared cache', async () => {
    const { em, findOne } = createEntityManager(rows)
    const cache = createCache()
    const first = await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, cache as any)
    const second = await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, cache as any)
    expect(first).toBe('Approved (A)')
    expect(second).toBe('Approved (A)')
    expect(findOne).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
  })

  it('falls back to a straight EM read when no cache is provided', async () => {
    const { em, findOne } = createEntityManager(rows)
    await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, undefined)
    await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, undefined)
    expect(findOne).toHaveBeenCalledTimes(2)
  })

  it('scopes the cache read/write to the caller tenant via runWithCacheTenant', async () => {
    const { em } = createEntityManager(rows)
    const cache = createCache()
    await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, cache as any)
    expect(runWithCacheTenant).toHaveBeenCalledWith(TENANT_A, expect.any(Function))
  })

  it('tags the cached value with the dictionaries.entry CRUD record tag so invalidateCrudCache drops it on edit', async () => {
    const { em } = createEntityManager(rows)
    const cache = createCache()
    await resolveCachedDictionaryEntryValue(em, 'entry-a', { tenantId: TENANT_A }, cache as any)
    const setOptions = cache.set.mock.calls[0][2] as { tags?: string[] }
    expect(setOptions?.tags).toEqual([buildRecordTag('dictionaries.entry', TENANT_A, 'entry-a')])
  })

  it('does not cache a missing entry (re-reads on the next lookup)', async () => {
    const { em, findOne } = createEntityManager(rows)
    const cache = createCache()
    const first = await resolveCachedDictionaryEntryValue(em, 'missing', { tenantId: TENANT_A }, cache as any)
    const second = await resolveCachedDictionaryEntryValue(em, 'missing', { tenantId: TENANT_A }, cache as any)
    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(findOne).toHaveBeenCalledTimes(2)
    expect(cache.set).not.toHaveBeenCalled()
  })
})
