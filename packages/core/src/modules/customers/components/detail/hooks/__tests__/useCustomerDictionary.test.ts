import { QueryClient } from '@tanstack/query-core'
import {
  ensureCustomerDictionary,
  invalidateCustomerDictionary,
} from '../useCustomerDictionary'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockReadApiResultOrThrow = readApiResultOrThrow as jest.Mock

const createApiResponse = (items: unknown[]) => ({ items })

describe('ensureCustomerDictionary', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    mockReadApiResultOrThrow.mockReset()
  })

  afterEach(() => {
    queryClient?.clear?.()
  })

  it('normalizes API payload into dictionary data', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce(
      createApiResponse([
        {
          id: 'status-1',
          value: 'new',
          label: 'New',
          color: '#AABBCC',
          icon: '⭐',
          organizationId: 'org-123',
          isInherited: false,
        },
      ]),
    )

    const result = await ensureCustomerDictionary(queryClient, 'statuses', 0)

    expect(mockReadApiResultOrThrow).toHaveBeenCalledWith(
      '/api/customers/dictionaries/statuses',
      undefined,
      { errorMessage: 'Failed to load dictionary entries.' },
    )
    expect(result.entries).toEqual([
      { value: 'new', label: 'New', color: '#aabbcc', icon: '⭐' },
    ])
    expect(result.map['new']).toEqual({ value: 'new', label: 'New', color: '#aabbcc', icon: '⭐' })
    expect(result.fullEntries[0]).toMatchObject({
      id: 'status-1',
      value: 'new',
      label: 'New',
      color: '#aabbcc',
      icon: '⭐',
      organizationId: 'org-123',
      isInherited: false,
    })
  })

  it('refetches freshly after invalidation and returns updated entries', async () => {
    mockReadApiResultOrThrow
      .mockResolvedValueOnce(createApiResponse([{ id: 'status-1', value: 'alpha', label: 'Alpha' }]))
      .mockResolvedValueOnce(createApiResponse([{ id: 'status-2', value: 'beta', label: 'Beta' }]))

    const first = await ensureCustomerDictionary(queryClient, 'statuses', 0)
    expect(first.entries.map((entry) => entry.value)).toEqual(['alpha'])
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(1)

    await invalidateCustomerDictionary(queryClient, 'statuses')

    const second = await ensureCustomerDictionary(queryClient, 'statuses', 0)
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(2)
    expect(second.entries.map((entry) => entry.value)).toEqual(['beta'])
  })

  it('isolates cached data per scope version', async () => {
    mockReadApiResultOrThrow
      .mockResolvedValueOnce(createApiResponse([{ id: 'source-1', value: 'scope-0', label: 'Scope Zero' }]))
      .mockResolvedValueOnce(createApiResponse([{ id: 'source-2', value: 'scope-1', label: 'Scope One' }]))

    const scopeZero = await ensureCustomerDictionary(queryClient, 'sources', 0)
    expect(scopeZero.entries[0]?.value).toBe('scope-0')

    const scopeOne = await ensureCustomerDictionary(queryClient, 'sources', 1)
    expect(scopeOne.entries[0]?.value).toBe('scope-1')

    const cachedKeys = queryClient.getQueryCache().findAll().map((query) => query.queryKey)
    expect(cachedKeys).toContainEqual(['customers', 'dictionaries', 'sources', 'scope:0'])
    expect(cachedKeys).toContainEqual(['customers', 'dictionaries', 'sources', 'scope:1'])
  })
})
