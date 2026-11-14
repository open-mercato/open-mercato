import type { EntityManager } from '@mikro-orm/postgresql'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { redactActionLogEntries } from '../actionLogRedaction'

const reportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError }),
}))

const mockEm = {} as unknown as EntityManager

function makeEntry(overrides: Partial<ActionLog>): ActionLog {
  return Object.assign(new ActionLog(), overrides)
}

describe('redactActionLogEntries', () => {
  beforeEach(() => {
    reportError.mockClear()
  })

  it('suppresses protected resource kinds when no provider is registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: Could not resolve actionLogRedactionProvider')
      },
      hasRegistration: () => false,
    }
    const entries = [
      makeEntry({
        resourceKind: 'customers.interaction',
        snapshotBefore: { foo: 'bar' },
        snapshotAfter: { foo: 'baz' },
        changesJson: { foo: { from: 'bar', to: 'baz' } },
      }),
    ]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries)

    expect(result).toEqual([
      { ...entries[0], snapshotBefore: null, snapshotAfter: null, changesJson: null },
    ])
    expect(reportError).not.toHaveBeenCalled()
  })

  it('leaves unprotected resource kinds untouched when no provider is registered', async () => {
    const container = {
      resolve: () => {
        throw new Error('AwilixResolutionError: Could not resolve actionLogRedactionProvider')
      },
      hasRegistration: () => false,
    }
    const entries = [makeEntry({ resourceKind: 'product', snapshotBefore: { name: 'Widget' } })]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries)

    expect(result).toEqual(entries)
    expect(result[0]).toBe(entries[0])
  })

  it('does not report when the provider is simply unregistered', async () => {
    const hasRegistration = jest.fn(() => false)
    const resolve = jest.fn()
    const container = { resolve, hasRegistration }
    const entries = [makeEntry({ resourceKind: 'customers.interaction', snapshotBefore: { title: 'Private subject' } })]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries)

    expect(resolve).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    expect(result[0].snapshotBefore).toBeNull()
  })

  it('reports and still suppresses when a registered provider fails to resolve', async () => {
    const hasRegistration = jest.fn(() => true)
    const resolveError = new Error('provider construction failed')
    const resolve = jest.fn(() => {
      throw resolveError
    })
    const container = { resolve, hasRegistration }
    const entries = [makeEntry({ resourceKind: 'customers.interaction', snapshotBefore: { title: 'Private subject' } })]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: null }, 'user-1', entries)

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(resolveError, expect.objectContaining({ module: 'audit_logs' }))
    expect(result[0].snapshotBefore).toBeNull()
  })

  it('loads the redaction context once and redacts every protected entry through the resolved provider', async () => {
    const loadContext = jest.fn().mockResolvedValue({ viewerUserId: 'user-1', sharedConversations: [], sharedChannelIds: [] })
    const redactEntry = jest.fn((entry: ActionLog) => ({ ...entry, redacted: true }))
    const container = {
      resolve: () => ({ loadContext, redactEntry }),
    }
    const entries = [
      makeEntry({ resourceKind: 'customers.interaction', snapshotBefore: { a: 1 } }),
      makeEntry({ resourceKind: 'customers.interaction', snapshotBefore: { a: 2 } }),
    ]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1', entries)

    expect(loadContext).toHaveBeenCalledTimes(1)
    expect(loadContext).toHaveBeenCalledWith(mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1')
    expect(redactEntry).toHaveBeenCalledTimes(2)
    expect(result).toEqual([
      { ...entries[0], redacted: true },
      { ...entries[1], redacted: true },
    ])
  })

  it('does not call the resolved provider for unprotected resource kinds', async () => {
    const loadContext = jest.fn().mockResolvedValue({})
    const redactEntry = jest.fn((entry: ActionLog) => ({ ...entry, redacted: true }))
    const container = {
      resolve: () => ({ loadContext, redactEntry }),
    }
    const entries = [makeEntry({ resourceKind: 'product', snapshotBefore: { name: 'Widget' } })]

    const result = await redactActionLogEntries(container, mockEm, { tenantId: 'tenant-1', organizationId: 'org-1' }, 'user-1', entries)

    expect(redactEntry).not.toHaveBeenCalled()
    expect(result).toEqual(entries)
  })
})
