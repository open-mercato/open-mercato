/** @jest-environment node */
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { Building, ProductUse, PropertyManagementSettings } from '../data/entities'
import { TransactionalFakeEm, resetCustomFieldStore } from './support/customFieldStore'

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
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: jest.fn(async () => undefined),
  emitCrudUndoSideEffects: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/optimistic-lock-command'),
  enforceCommandOptimisticLockWithGuards: jest.fn(async () => undefined),
}))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn(() => ({ enqueue: jest.fn() })) }))
jest.mock('../lib/managers', () => ({
  assertManagerUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  filterOrganizationUsers: jest.fn(async (_em: unknown, _scope: unknown, ids: string[]) => ids),
  loadManagerIds: jest.fn(async () => []),
  replaceManagers: jest.fn(async () => undefined),
  listBuildingManagers: jest.fn(async () => new Map()),
}))
jest.mock('../events', () => ({ emitPropertyManagementEvent: jest.fn(async () => undefined) }))

import '../commands'
import { assertManagerUsers } from '../lib/managers'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const scope = { tenantId: TENANT, organizationId: ORG }
const PRODUCT = '80000000-0000-4000-8000-000000000011'
const MANAGER = '80000000-0000-4000-8000-000000000031'
const LAYOUT = { below: 0, above: 1, floors: [{ number: 0, name: 'Ground Floor', sizeX: 20, sizeY: 10 }] }

const rbac = { userHasAllFeatures: jest.fn(async () => true) }

function buildCtx(em: TransactionalFakeEm, actor: { systemActor?: boolean }): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'dataEngine') return {}
        if (name === 'rbacService') return rbac
        throw new Error(`[internal] unexpected ${name}`)
      },
    } as never,
    auth: null,
    ...actor,
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

async function expectForbidden(promise: Promise<unknown>, code?: string): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(CrudHttpError)
    expect((err as CrudHttpError).status).toBe(403)
    if (code) expect((err as CrudHttpError).body).toMatchObject({ code })
    return
  }
  throw new Error('[internal] expected the command to be refused')
}

function seedProduct(): TransactionalFakeEm {
  const em = new TransactionalFakeEm()
  em.seed(CatalogProduct, { id: PRODUCT, ...scope, deletedAt: null } as never)
  return em
}

const productUseInput = { ...scope, catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' }
const settingsInput = { ...scope, billingChannelId: null, cancelledOrderStatusEntryId: null, leaseEndingThresholdDays: 30, bookingReminderMinutes: 60, proposalExpiryDays: 14 }
const buildingInput = { ...scope, name: 'Annex', address: 'Quay 2', layout: LAYOUT, managerUserIds: [MANAGER] }

beforeEach(() => {
  jest.clearAllMocks()
  resetCustomFieldStore()
})

describe('a context without a login is trusted only as an explicit system actor', () => {
  it('refuses product_use.set without a login or a system actor', async () => {
    const em = seedProduct()
    await expectForbidden(handler('property_management.product_use.set').execute(productUseInput, buildCtx(em, {})), 'product_use_forbidden')
    expect(em.rows(ProductUse)).toEqual([])
  })

  it('runs product_use.set for a system actor', async () => {
    const em = seedProduct()
    await handler('property_management.product_use.set').execute(productUseInput, buildCtx(em, { systemActor: true }))
    expect(em.rows(ProductUse)).toEqual([expect.objectContaining({ catalogProductId: PRODUCT, use: 'leasable', billingUnit: 'month' })])
  })

  it('refuses settings.save without a login or a system actor', async () => {
    const em = new TransactionalFakeEm()
    await expectForbidden(handler('property_management.settings.save').execute(settingsInput, buildCtx(em, { systemActor: false })), 'settings_forbidden')
    expect(em.rows(PropertyManagementSettings)).toEqual([])
    expect(rbac.userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('runs settings.save for a system actor', async () => {
    const em = new TransactionalFakeEm()
    await handler('property_management.settings.save').execute(settingsInput, buildCtx(em, { systemActor: true }))
    expect(em.rows(PropertyManagementSettings)).toEqual([expect.objectContaining({ leaseEndingThresholdDays: 30 })])
  })

  it('refuses a building manager assignment without a login or a system actor', async () => {
    const em = new TransactionalFakeEm()
    await expectForbidden(handler('property_management.building.create').execute(buildingInput, buildCtx(em, {})))
    expect(em.rows(Building)).toEqual([])
    expect(assertManagerUsers).not.toHaveBeenCalled()
  })

  it('keeps the requested managers for a system actor', async () => {
    const em = new TransactionalFakeEm()
    await handler('property_management.building.create').execute(buildingInput, buildCtx(em, { systemActor: true }))
    expect(assertManagerUsers).toHaveBeenCalledWith(expect.anything(), scope, [MANAGER])
    expect(em.rows(Building)).toEqual([expect.objectContaining({ name: 'Annex' })])
  })
})
