/** @jest-environment node */

// The `query_index.upsert_one` subscriber must return before the coverage
// arithmetic, not merely before the row write: an `entity_index_coverage` row for
// a stopped entity type is what would make the engine believe the type is
// indexed. `query_index.delete_one` is deliberately left unfiltered so a row
// written before the switch was set still cleans itself up.

const mockUpsertIndexRow = jest.fn(async () => ({
  doc: null, existed: false, wasDeleted: false, created: false, revived: false,
}))
const mockReindexSearchTokensForRecord = jest.fn(async () => undefined)
const mockApplyCoverageAdjustments = jest.fn(async () => undefined)
const mockCreateCoverageAdjustments = jest.fn(() => [{ any: true }])
const mockMarkDeleted = jest.fn(async () => ({ wasActive: true }))

jest.mock('../lib/indexer', () => ({
  upsertIndexRow: (...args: unknown[]) => mockUpsertIndexRow(...(args as [])),
  reindexSearchTokensForRecord: (...args: unknown[]) => mockReindexSearchTokensForRecord(...(args as [])),
  markDeleted: (...args: unknown[]) => mockMarkDeleted(...(args as [])),
}))

jest.mock('../lib/coverage', () => ({
  applyCoverageAdjustments: (...args: unknown[]) => mockApplyCoverageAdjustments(...(args as [])),
  createCoverageAdjustments: (...args: unknown[]) => mockCreateCoverageAdjustments(...(args as [])),
}))

jest.mock('../lib/subscriber-scope', () => ({
  loadQueryIndexRowScope: jest.fn(async () => ({ kind: 'missing' as const })),
  resolveQueryIndexSourceMetadata: jest.fn(() => ({
    table: 'sales_order_lines', organizationColumn: 'organization_id', tenantColumn: 'tenant_id',
  })),
  resolveQueryIndexRecordScope: jest.fn((input: any) => ({
    organizationId: input.payloadOrganizationId ?? null,
    tenantId: input.payloadTenantId ?? null,
  })),
}))

jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/data/consistency', () => ({
  isReadProjectionAlwaysConsistent: () => false,
}))

import {
  applyQueryIndexOverrides,
  resetQueryIndexProjectionPolicyForTests,
} from '@open-mercato/shared/modules/query-index'
import handleUpsertOne from '../subscribers/upsert_one'
import handleCoverageRefresh from '../subscribers/coverage_refresh'

const STOPPED = 'sales:sales_order_line'
const PROJECTED = 'sales:sales_order'

function createContext() {
  const emitEvent = jest.fn(async () => undefined)
  const em = { getKysely: () => { throw new Error('no kysely in test') } }
  const sourceEm = { fork: jest.fn(() => em) }
  return {
    emitEvent,
    ctx: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return sourceEm
        if (name === 'eventBus') return { emitEvent }
        throw new Error(`Unexpected resolve: ${name}`)
      }),
    },
  }
}

function flushFireAndForget() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

beforeEach(() => {
  jest.clearAllMocks()
  resetQueryIndexProjectionPolicyForTests()
  applyQueryIndexOverrides([{ entities: { [STOPPED]: null } }])
})

afterEach(() => {
  resetQueryIndexProjectionPolicyForTests()
})

describe('query_index.upsert_one', () => {
  it('writes nothing and adjusts no coverage for a stopped entity type', async () => {
    const { ctx, emitEvent } = createContext()

    await handleUpsertOne(
      { entityType: STOPPED, recordId: 'r1', tenantId: 't1', organizationId: null, crudAction: 'created' },
      ctx,
    )
    await flushFireAndForget()

    expect(mockUpsertIndexRow).not.toHaveBeenCalled()
    expect(mockApplyCoverageAdjustments).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('still indexes a projected entity type', async () => {
    const { ctx } = createContext()

    await handleUpsertOne(
      { entityType: PROJECTED, recordId: 'r1', tenantId: 't1', organizationId: null, crudAction: 'created' },
      ctx,
    )
    await flushFireAndForget()

    expect(mockUpsertIndexRow).toHaveBeenCalledTimes(1)
  })
})

describe('query_index.coverage.refresh', () => {
  it('writes no snapshot for a stopped entity type', async () => {
    const { ctx } = createContext()

    // An unfiltered `delete_one` on a stray row emits this event; the snapshot it
    // would write is the one thing that must not appear.
    await expect(
      handleCoverageRefresh({ entityType: STOPPED, tenantId: 't1', organizationId: null }, ctx),
    ).resolves.toBeUndefined()
    expect(ctx.resolve).not.toHaveBeenCalled()
  })
})
