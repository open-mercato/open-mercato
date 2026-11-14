import type { EntityManager } from '@mikro-orm/postgresql'
import { redactActionLogEntries } from '../actionLogRedaction'

const mockEm = {} as unknown as EntityManager

describe('redactActionLogEntries', () => {
  it('suppresses protected resource kinds when no provider is registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: Could not resolve actionLogRedactionProvider')
      },
    }
    const entries = [
      {
        resourceKind: 'customers.interaction',
        snapshotBefore: { foo: 'bar' },
        snapshotAfter: { foo: 'baz' },
        changesJson: { foo: { from: 'bar', to: 'baz' } },
      },
    ]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries as any)

    expect(result).toEqual([
      { resourceKind: 'customers.interaction', snapshotBefore: null, snapshotAfter: null, changesJson: null },
    ])
  })

  it('leaves unprotected resource kinds untouched when no provider is registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: Could not resolve actionLogRedactionProvider')
      },
    }
    const entries = [{ resourceKind: 'product', snapshotBefore: { name: 'Widget' } }]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries as any)

    expect(result).toBe(entries)
  })

  it('loads the redaction context once and redacts every protected entry through the resolved provider', async () => {
    const loadContext = jest.fn().mockResolvedValue({ viewerUserId: 'user-1', sharedConversations: [], sharedChannelIds: [] })
    const redactEntry = jest.fn((entry: unknown) => ({ ...(entry as object), redacted: true }))
    const container = {
      resolve: () => ({ loadContext, redactEntry }),
    }
    const entries = [
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 1 } },
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 2 } },
    ]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1', entries as any)

    expect(loadContext).toHaveBeenCalledTimes(1)
    expect(loadContext).toHaveBeenCalledWith(mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1')
    expect(redactEntry).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 1 }, redacted: true },
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 2 }, redacted: true },
    ])
  })

  it('does not call the resolved provider for unprotected resource kinds', async () => {
    const loadContext = jest.fn().mockResolvedValue({})
    const redactEntry = jest.fn((entry: unknown) => ({ ...(entry as object), redacted: true }))
    const container = {
      resolve: () => ({ loadContext, redactEntry }),
    }
    const entries = [{ resourceKind: 'product', snapshotBefore: { name: 'Widget' } }]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1', entries as any)

    expect(redactEntry).not.toHaveBeenCalled()
    expect(result).toEqual(entries)
  })
})
