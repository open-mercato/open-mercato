/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { applyCustomFieldsNormalization, decorateRecordWithCustomFields } from '@open-mercato/shared/lib/crud/custom-fields'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { E } from '#generated/entities.ids.generated'
import { Building, Lease, LeaseReferenceCounter, PropertyManagementSettings, Unit, UnitProductPeriod } from '../data/entities'
import { leaseCreateBodySchema, liftCustomFields } from '../data/validators'
import {
  customFieldStore,
  resetCustomFieldStore,
  storedCustomFields,
  textFieldDefinitions,
  TransactionalFakeEm,
} from './support/customFieldStore'

type CapturedRoute = {
  list?: {
    entityId?: string
    transformItem?: (item: Record<string, unknown>) => Record<string, unknown>
    decorateCustomFields?: { entityIds: unknown; stripPrefixedKeys?: boolean }
  }
  actions?: Record<string, { mapInput?: (args: { raw: unknown; ctx: CrudCtx }) => Promise<Record<string, unknown>> }>
}

const capturedRoutes: CapturedRoute[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: CapturedRoute) => {
    capturedRoutes.push(config)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => jest.requireActual('./support/fakeEm').encryptionFindMock())
jest.mock('@open-mercato/shared/lib/data/engine', () => jest.requireActual('./support/customFieldStore').dataEngineMock())
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => jest.requireActual('./support/customFieldStore').customFieldSnapshotsMock())
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined) }))
jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => null) }
})
jest.mock('../lib/salesOperations', () => {
  const actual = jest.requireActual('../lib/salesOperations')
  return { ...actual, enqueueSalesOperations: jest.fn(async () => undefined) }
})
jest.mock('../lib/leaseEvents', () => {
  const actual = jest.requireActual('../lib/leaseEvents')
  return { ...actual, emitLeaseEvent: jest.fn(async () => undefined), emitProposalEvent: jest.fn(async () => undefined) }
})
jest.mock('../commands/shared', () => {
  const actual = jest.requireActual('../commands/shared')
  return { ...actual, emitSideEffects: jest.fn(async () => undefined) }
})

import '../commands'
import '../api/leases/route'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const BUILDING = '82000000-0000-4000-8000-000000000001'
const UNIT = '82000000-0000-4000-8000-000000000002'
const PRODUCT = '82000000-0000-4000-8000-000000000003'
const COMPANY = '82000000-0000-4000-8000-000000000004'
const CHANNEL = '82000000-0000-4000-8000-000000000005'
const ENTITY = E.property_management.lease
const year = new Date().getFullYear()
const NEXT = year + 1

function seed(): TransactionalFakeEm {
  const em = new TransactionalFakeEm()
  em.seed(Building, { id: BUILDING, ...scope, name: 'Harbor Point', status: 'active', deletedAt: null } as never)
  em.seed(Unit, { id: UNIT, ...scope, buildingId: BUILDING, floorId: 'f1', spaceId: 's1', name: 'Studio 2B', catalogProductId: PRODUCT, deletedAt: null } as never)
  em.seed(UnitProductPeriod, {
    id: 'period-1',
    ...scope,
    unitId: UNIT,
    catalogProductId: PRODUCT,
    productName: 'Private office',
    use: 'leasable',
    billingUnit: 'month',
    priceAmount: '1200.0000',
    currencyCode: 'PLN',
    validTo: null,
  } as never)
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, title: 'Private office', deletedAt: null } as never)
  em.seed(CustomerEntity, { id: COMPANY, ...scope, kind: 'company', displayName: 'Solstice Analytics', deletedAt: null } as never)
  em.seed(PropertyManagementSettings, { id: 'settings-1', ...scope, billingChannelId: CHANNEL, proposalExpiryDays: 14 } as never)
  em.seed(LeaseReferenceCounter, { id: 'counter-1', ...scope, year, lastNumber: 0 } as never)
  return em
}

function buildCtx(em: TransactionalFakeEm): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as never,
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function handler(commandId: string) {
  const command = commandRegistry.get(commandId)
  if (!command) throw new Error(`[internal] missing command ${commandId}`)
  return command
}

function leaseRoute(): CapturedRoute {
  const route = capturedRoutes.find((config) => config.list?.entityId === ENTITY)
  if (!route) throw new Error('[internal] leases route not captured')
  return route
}

beforeEach(() => {
  resetCustomFieldStore()
})

describe('lease custom fields', () => {
  it('keeps cf_ keys of a new-lease body as customFields', () => {
    const body = leaseCreateBodySchema.parse(liftCustomFields({ unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-01-01`, termMonths: 12, monthlyRate: 1200, cf_po_number: 'PO-7' }))
    expect(body.customFields).toEqual({ po_number: 'PO-7' })
    expect(body).not.toHaveProperty('cf_po_number')
  })

  it('maps cf_ keys of an update body and decorates list items into customValues', async () => {
    const route = leaseRoute()
    const input = await route.actions?.update?.mapInput?.({ raw: { id: '82000000-0000-4000-8000-000000000009', cf_po_number: 'PO-8' }, ctx: buildCtx(new TransactionalFakeEm()) as unknown as CrudCtx })
    expect(input).toMatchObject({ ...scope, customFields: { po_number: 'PO-8' } })
    expect(route.list?.decorateCustomFields).toEqual({ entityIds: ENTITY, stripPrefixedKeys: true })
    const item = route.list?.transformItem?.({ id: 'lease-1', reference: 'L-1', organization_id: ORG, tenant_id: TENANT, 'cf:po_number': 'PO-7' }) ?? {}
    const decorated = applyCustomFieldsNormalization(item, decorateRecordWithCustomFields(item, textFieldDefinitions('po_number', scope), scope), { stripPrefixedKeys: true })
    expect(decorated.customValues).toEqual({ po_number: 'PO-7' })
  })

  it('writes custom values with the lease and restores them on undo of an update', async () => {
    const em = seed()
    const ctx = buildCtx(em)
    const created = (await handler('property_management.lease.create').execute(
      { ...scope, unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-01-01`, termMonths: 12, monthlyRate: 1200, customFields: { po_number: 'PO-7' } },
      ctx,
    )) as { leaseId: string }
    expect(customFieldStore.writes).toEqual([{ entityId: ENTITY, recordId: created.leaseId, values: { po_number: 'PO-7' }, inTransaction: true }])

    const update = handler('property_management.lease.update')
    const updateInput = { ...scope, id: created.leaseId, customFields: { po_number: 'PO-9' } }
    const prepared = (await update.prepare?.(updateInput, ctx)) as { before?: Record<string, unknown> }
    const lease = em.rows(Lease)[0] as unknown as Lease
    const stale = new Date('2026-01-01T00:00:00Z')
    lease.updatedAt = stale
    const result = await update.execute(updateInput, ctx)
    expect(lease.updatedAt.getTime()).toBeGreaterThan(stale.getTime())
    const after = await update.captureAfter?.(updateInput, result, ctx)
    expect(storedCustomFields(ENTITY, created.leaseId)).toEqual({ po_number: 'PO-9' })
    expect(customFieldStore.writes.at(-1)?.inTransaction).toBe(true)
    const log = await update.buildLog?.({ input: updateInput, result, ctx, snapshots: { before: prepared.before, after } } as never)

    await update.undo?.({ logEntry: { payload: (log as { payload: unknown }).payload } as never, ctx } as never)
    expect(storedCustomFields(ENTITY, created.leaseId)).toEqual({ po_number: 'PO-7' })
    expect(customFieldStore.writes.at(-1)?.inTransaction).toBe(true)
  })

  it('leaves the lease untouched when an update carries neither a contact nor custom values', async () => {
    const em = seed()
    const ctx = buildCtx(em)
    const created = (await handler('property_management.lease.create').execute(
      { ...scope, unitId: UNIT, customerCompanyId: COMPANY, startsOn: `${NEXT}-01-01`, termMonths: 12, monthlyRate: 1200 },
      ctx,
    )) as { leaseId: string }
    const lease = em.rows(Lease)[0] as unknown as Lease
    const stale = new Date('2026-01-01T00:00:00Z')
    lease.updatedAt = stale
    await handler('property_management.lease.update').execute({ ...scope, id: created.leaseId }, ctx)
    expect(lease.updatedAt).toBe(stale)
    expect(customFieldStore.writes).toEqual([])
  })
})
