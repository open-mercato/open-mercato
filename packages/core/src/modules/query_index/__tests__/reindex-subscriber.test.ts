const mockRecordIndexerError = jest.fn(async () => undefined)
const mockRecordIndexerLog = jest.fn(async () => undefined)
const mockReindexEntity = jest.fn(async () => ({
  processed: 0,
  total: 0,
  tenantScopes: [],
  scopes: [],
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: (...args: unknown[]) => mockRecordIndexerError(...args),
}))

jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: (...args: unknown[]) => mockRecordIndexerLog(...args),
}))

jest.mock('../lib/reindexer', () => ({
  reindexEntity: (...args: unknown[]) => mockReindexEntity(...args),
}))

const mockPurgeIndexScope = jest.fn(async () => undefined)

jest.mock('../lib/purge', () => ({
  purgeIndexScope: (...args: unknown[]) => mockPurgeIndexScope(...args),
}))

jest.mock('../lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn(async () => undefined),
}))

import handleReindex from '../subscribers/reindex'
import handlePurge from '../subscribers/purge'

describe('query_index reindex subscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses a fresh EntityManager fork for reindex work', async () => {
    const forkedEm = { id: 'forked-em' }
    const sourceEm = {
      id: 'source-em',
      fork: jest.fn(() => forkedEm),
    }
    const eventBus = { emitEvent: jest.fn(async () => undefined) }
    const ctx = {
      eventScope: { tenantId: 'tenant-1', organizationId: null },
      resolve: jest.fn((name: string) => {
        if (name === 'em') return sourceEm
        if (name === 'eventBus') return eventBus
        throw new Error(`Unexpected token: ${name}`)
      }) as <T>(name: string) => T,
    }

    await handleReindex({
      entityType: 'checkout:checkout_transaction',
      tenantId: 'untrusted-tenant',
      organizationId: 'untrusted-org',
      force: true,
    }, ctx)

    expect(sourceEm.fork).toHaveBeenCalledWith({
      clear: true,
      freshEventManager: true,
      useContext: false,
    })
    expect(mockReindexEntity).toHaveBeenCalledWith(forkedEm, expect.objectContaining({
      entityType: 'checkout:checkout_transaction',
      tenantId: 'tenant-1',
      organizationId: null,
    }))
    expect(mockRecordIndexerLog).toHaveBeenCalledWith(
      { em: forkedEm },
      expect.objectContaining({
        source: 'query_index',
        handler: 'event:query_index.reindex',
        message: 'Reindex started for checkout:checkout_transaction',
      }),
    )
  })
})

describe('query_index privileged subscriber scope', () => {
  const entityType = 'example:todo'
  const payload = { entityType, tenantId: 'untrusted-tenant', organizationId: 'untrusted-org' }
  const em = { id: 'test-em' }
  const resolve = <T,>(name: string): T => {
    if (name === 'em') return em as T
    throw new Error(`Unexpected token: ${name}`)
  }

  beforeEach(() => jest.clearAllMocks())

  it.each([handlePurge, handleReindex])('refuses jobs without trusted scope', async (handle) => {
    await expect(handle(payload, { resolve })).rejects.toThrow('requires trusted event scope')
    expect(mockPurgeIndexScope).not.toHaveBeenCalled()
    expect(mockReindexEntity).not.toHaveBeenCalled()
  })

  it.each([false, true])('uses only the trusted all-tenant flag (%s)', async (allowAllTenants) => {
    const eventBus = { emitEvent: jest.fn(async () => undefined) }
    const resolveReindexDependency = <T,>(name: string): T => name === 'eventBus' ? eventBus as T : resolve(name)
    await handleReindex({ ...payload, allowAllTenants: true }, {
      resolve: resolveReindexDependency,
      eventScope: { tenantId: null, allowAllTenants },
    })
    expect(mockReindexEntity).toHaveBeenCalledWith(em, expect.objectContaining({
      entityType,
      tenantId: allowAllTenants ? undefined : null,
    }))
  })

  it('purges only the scope in subscriber context', async () => {
    const eventScope = { tenantId: 'tenant-1', organizationId: 'org-1' }
    await handlePurge(payload, { resolve, eventScope })
    expect(mockPurgeIndexScope).toHaveBeenCalledWith(em, { entityType, ...eventScope })
  })
})
