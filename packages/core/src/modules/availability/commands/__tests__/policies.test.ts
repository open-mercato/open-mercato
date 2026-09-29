jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: jest.fn(async (opts: { phases: Array<(args: { em: unknown }) => void> }) => {
    for (const phase of opts.phases) phase({ em: { persist: () => {} } })
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    emitCrudUndoSideEffects: jest.fn(async () => {}),
  }
})

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { AvailabilityPolicy } from '../../data/entities'
import { createPolicyCommand, updatePolicyCommand, deletePolicyCommand } from '../policies'

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const VARIANT_ID = '33333333-3333-4333-8333-333333333333'
const POLICY_ID = '55555555-5555-4555-8555-555555555555'

class ProductInventoryProfileStub {}

type ContainerOptions = {
  profileRow?: object | null
  wmsEnabled?: boolean
  policyRecord?: AvailabilityPolicy | null
}

function makeCtx(options: ContainerOptions = {}) {
  const findOne = jest.fn(async (entity: unknown) => {
    if (entity === ProductInventoryProfileStub) return options.profileRow ?? null
    if (entity === AvailabilityPolicy) return options.policyRecord ?? null
    return null
  })
  const flush = jest.fn(async () => {})
  const em = { findOne, flush, fork: () => em }
  const dataEngine = { markOrmEntityChange: jest.fn() }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return dataEngine
      if (name === 'ProductInventoryProfile' && options.wmsEnabled) return ProductInventoryProfileStub
      throw new Error(`not registered: ${name}`)
    },
  }
  const ctx = {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
  } as unknown as CommandRuntimeContext
  return { ctx, findOne, flush }
}

function createdRecord(): AvailabilityPolicy {
  const mocked = runCrudCommandWrite as jest.Mock
  const call = mocked.mock.calls[mocked.mock.calls.length - 1][0] as {
    sideEffect: () => { entity: AvailabilityPolicy }
  }
  return call.sideEffect().entity
}

function makePolicyRecord(): AvailabilityPolicy {
  const record = new AvailabilityPolicy()
  record.id = POLICY_ID
  record.organizationId = ORG_ID
  record.tenantId = TENANT_ID
  record.productId = PRODUCT_ID
  record.isStockManaged = true
  record.isActive = true
  record.createdAt = new Date()
  record.updatedAt = new Date()
  return record
}

function makeSnapshot() {
  return {
    id: POLICY_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    storeId: null,
    productId: PRODUCT_ID,
    variantId: null,
    isStockManaged: false,
    allowBackorder: false,
    backorderLeadTimeDays: null,
    preorderReleaseAt: null,
    lowStockThreshold: null,
    minOrderQuantity: null,
    maxOrderQuantity: null,
    quantityIncrement: null,
    hideWhenOutOfStock: false,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeLogEntry(undo: Record<string, unknown>) {
  return { commandPayload: { undo } } as unknown as Parameters<NonNullable<typeof createPolicyCommand.undo>>[0]['logEntry']
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('availability.policies.create — isStockManaged module default (§5.2)', () => {
  it('defaults to true when wms is enabled and the product has an inventory profile', async () => {
    const { ctx } = makeCtx({ wmsEnabled: true, profileRow: { id: 'profile-1' } })
    await createPolicyCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, productId: PRODUCT_ID, variantId: VARIANT_ID }, ctx)
    expect(createdRecord().isStockManaged).toBe(true)
  })

  it('defaults to false when wms is enabled but the product has no inventory profile', async () => {
    const { ctx } = makeCtx({ wmsEnabled: true, profileRow: null })
    await createPolicyCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, productId: PRODUCT_ID }, ctx)
    expect(createdRecord().isStockManaged).toBe(false)
  })

  it('defaults to false when wms is not enabled', async () => {
    const { ctx } = makeCtx({ wmsEnabled: false })
    await createPolicyCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID, productId: PRODUCT_ID }, ctx)
    expect(createdRecord().isStockManaged).toBe(false)
  })

  it('defaults to false for a store-default row without a product, without querying profiles', async () => {
    const { ctx, findOne } = makeCtx({ wmsEnabled: true, profileRow: { id: 'profile-1' } })
    await createPolicyCommand.execute({ tenantId: TENANT_ID, organizationId: ORG_ID }, ctx)
    expect(createdRecord().isStockManaged).toBe(false)
    expect(findOne).not.toHaveBeenCalled()
  })

  it('keeps an explicit isStockManaged value over the module default', async () => {
    const { ctx } = makeCtx({ wmsEnabled: true, profileRow: { id: 'profile-1' } })
    await createPolicyCommand.execute(
      { tenantId: TENANT_ID, organizationId: ORG_ID, productId: PRODUCT_ID, isStockManaged: false },
      ctx,
    )
    expect(createdRecord().isStockManaged).toBe(false)
  })
})

describe('availability.policies undo — emits availability.policy.* side effects', () => {
  function expectUndoEmit(action: 'created' | 'updated' | 'deleted') {
    const mocked = emitCrudUndoSideEffects as jest.Mock
    expect(mocked).toHaveBeenCalledTimes(1)
    const [opts] = mocked.mock.calls[0] as [{ action: string; identifiers: { id: string }; events: { module: string; entity: string } }]
    expect(opts.action).toBe(action)
    expect(opts.identifiers.id).toBe(POLICY_ID)
    expect(opts.events).toEqual(expect.objectContaining({ module: 'availability', entity: 'policy' }))
  }

  it('undoing a create soft-deletes the row and emits deleted', async () => {
    const record = makePolicyRecord()
    const { ctx, flush } = makeCtx({ policyRecord: record })
    await createPolicyCommand.undo!({ input: {}, ctx, logEntry: makeLogEntry({ after: makeSnapshot() }) } as never)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(flush).toHaveBeenCalled()
    expectUndoEmit('deleted')
  })

  it('undoing an update restores the snapshot and emits updated', async () => {
    const record = makePolicyRecord()
    const { ctx } = makeCtx({ policyRecord: record })
    await updatePolicyCommand.undo!({ input: {}, ctx, logEntry: makeLogEntry({ before: makeSnapshot() }) } as never)
    expect(record.isStockManaged).toBe(false)
    expectUndoEmit('updated')
  })

  it('undoing a delete restores the row and emits created', async () => {
    const record = makePolicyRecord()
    record.deletedAt = new Date()
    const { ctx } = makeCtx({ policyRecord: record })
    await deletePolicyCommand.undo!({ input: {}, ctx, logEntry: makeLogEntry({ before: makeSnapshot() }) } as never)
    expect(record.deletedAt).toBeNull()
    expectUndoEmit('created')
  })
})
