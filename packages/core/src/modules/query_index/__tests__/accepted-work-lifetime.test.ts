import { AsyncLocalStorage } from 'node:async_hooks'
import {
  configureDatabasePool,
  currentDatabaseExecutionContext,
  registerDatabaseRuntimeAdapter,
  runWithDatabaseExecutionContext,
  type DatabaseExecutionContext,
} from '@open-mercato/shared/lib/db/runtime'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

const mockErrors: unknown[] = []
const mockTrace: string[] = []
let mockEncryption: TenantDataEncryptionService

jest.mock('../lib/indexer', () => ({
  ...jest.requireActual('../lib/indexer'),
  upsertIndexRow: jest.fn(async () => ({ doc: { id: 'person-1', display_name: 'Ada' }, created: true })),
}))
jest.mock('../lib/subscriber-scope', () => ({
  resolveQueryIndexSourceMetadata: () => ({}),
  loadQueryIndexRowScope: async () => ({ kind: 'scoped', tenantId: '00000000-0000-4000-8000-000000000001', organizationId: null }),
  resolveQueryIndexRecordScope: () => ({ tenantId: '00000000-0000-4000-8000-000000000001', organizationId: null }),
}))
jest.mock('@open-mercato/shared/lib/encryption/customFieldValues', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/customFieldValues'),
  resolveTenantEncryptionService: () => mockEncryption,
}))
jest.mock('../lib/search-tokens', () => ({
  replaceSearchTokensForRecord: async (_db: unknown, args: { doc: Record<string, unknown> }) => {
    await nextTurn()
    expect(currentDatabaseExecutionContext()?.kind).toBe('tenant')
    expect(args.doc.search_text).toBe('Ada')
    mockTrace.push('tokens')
  },
}))
jest.mock('../lib/coverage', () => ({
  refreshCoverageSnapshot: async () => {
    await nextTurn()
    expect(currentDatabaseExecutionContext()?.kind).toBe('tenant')
    mockTrace.push('coverage')
  },
}))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: async (_ctx: unknown, error: unknown) => { mockErrors.push(error) },
}))

import handleUpsert from '../subscribers/upsert_one'
import handleCoverage from '../subscribers/coverage_refresh'

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const storage = new AsyncLocalStorage<{ context: DatabaseExecutionContext; active: boolean }>()
const runBoundary = async <Result>(context: DatabaseExecutionContext, callback: () => Result): Promise<Result> => {
  const invocation = { context, active: true }
  return storage.run(invocation, async () => {
    try { return await callback() } finally { invocation.active = false }
  })
}
const currentContext = () => {
  const invocation = storage.getStore()
  if (invocation && !invocation.active) throw new Error('[internal] Database invocation has completed')
  return invocation?.context
}
let disposals = 0
registerDatabaseRuntimeAdapter({
  id: 'query-index-lifetime-test', version: '1', configurationKey: '1',
  run: (context, callback) => runBoundary(context, callback) as ReturnType<typeof callback>,
  currentContext,
  configurePool: () => ({ ready: async () => undefined, dispose: () => { disposals += 1 } }),
})

it('joins actual token decryption and delayed coverage before invocation revocation and disposal', async () => {
  const context = { kind: 'tenant', tenantId: '00000000-0000-4000-8000-000000000001', source: 'api' } as const
  const lifecycle = configureDatabasePool({}, { id: 'query-index-test', purpose: 'runtime', tables: 'primary' })
  const em = {
    getKysely: () => ({}),
    execute: async () => {
      await nextTurn()
      expect(currentDatabaseExecutionContext()).toEqual(context)
      mockTrace.push('decrypt-policy')
      return []
    },
  }
  mockEncryption = new TenantDataEncryptionService(em as unknown as ConstructorParameters<typeof TenantDataEncryptionService>[0], {
    kms: { isHealthy: () => true, getTenantDek: async () => null, createTenantDek: async () => null },
  })
  let escaped!: Promise<void>
  const eventBus = {
    emitEvent: async (event: string) => {
      await nextTurn()
      expect(currentDatabaseExecutionContext()).toEqual(context)
      mockTrace.push(event)
    },
  }
  const ctx = { resolve: <Result,>(name: string): Result => (
    name === 'em' ? { fork: () => em } : eventBus
  ) as unknown as Result }

  try {
    await runWithDatabaseExecutionContext(context, async () => {
      await lifecycle.ready()
      await handleUpsert({ entityType: 'customers:customer_person', recordId: 'person-1', suppressCoverage: true }, ctx)
      escaped = nextTurn().then(() => {
        expect(() => currentDatabaseExecutionContext()).toThrow('invocation has completed')
      })
    })
    await escaped
    await runWithDatabaseExecutionContext(context, async () => {
      await handleCoverage({ entityType: 'customers:customer_person', tenantId: context.tenantId, delayMs: 5 }, ctx)
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockErrors).toEqual([])
    expect(mockTrace).toEqual(['decrypt-policy', 'tokens', 'query_index.vectorize_one', 'search.index_record', 'coverage'])
  } finally {
    lifecycle.dispose()
    lifecycle.dispose()
  }
  expect(disposals).toBe(1)
  expect(currentDatabaseExecutionContext()).toBeUndefined()
})
