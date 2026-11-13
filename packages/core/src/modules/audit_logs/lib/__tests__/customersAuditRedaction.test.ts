import type { EntityManager } from '@mikro-orm/postgresql'
import { redactActionLogEntries } from '../customersAuditRedaction'

const mockEm = {} as unknown as EntityManager

describe('redactActionLogEntries', () => {
  it('passes entries through unredacted when the customers module is not registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: Could not resolve customersAuditRedactionService')
      },
    }
    const entries = [{ resourceKind: 'customers.interaction', snapshotBefore: { foo: 'bar' } }]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries)

    expect(result).toBe(entries)
  })

  it('loads the redaction context once and redacts every entry through the resolved service', async () => {
    const loadContext = jest.fn().mockResolvedValue({ viewerUserId: 'user-1', sharedConversations: [], sharedChannelIds: [] })
    const redactEntry = jest.fn((entry: unknown) => ({ ...(entry as object), redacted: true }))
    const container = {
      resolve: () => ({ loadContext, redactEntry }),
    }
    const entries = [
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 1 } },
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 2 } },
    ]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1', entries)

    expect(loadContext).toHaveBeenCalledTimes(1)
    expect(loadContext).toHaveBeenCalledWith(mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1')
    expect(redactEntry).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 1 }, redacted: true },
      { resourceKind: 'customers.interaction', snapshotBefore: { a: 2 }, redacted: true },
    ])
  })
})
