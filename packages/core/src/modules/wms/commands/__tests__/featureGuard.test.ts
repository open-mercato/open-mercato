/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('../../events', () => ({
  emitWmsEvent: jest.fn(async () => undefined),
}))

const findOneWithDecryptionMock = jest.fn(async () => null)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...(args as [])),
  findWithDecryption: jest.fn(async () => []),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const LOCATION_ID = '44444444-4444-4444-8444-444444444444'

type RbacCheck = (userId: string, required: string[], scope: { tenantId: string | null; organizationId: string | null }) => Promise<boolean>

function createCtx(options: {
  auth?: Record<string, unknown> | null
  rbac?: { userHasAllFeatures: RbacCheck } | null
}) {
  const em = { fork: () => em, findOne: jest.fn(async () => null), flush: jest.fn(async () => undefined) }
  const resolve = jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'dataEngine') return {}
    if (name === 'rbacService') {
      if (options.rbac === null) throw new Error('rbacService not registered')
      return options.rbac
    }
    throw new Error(`Unexpected resolve: ${name}`)
  })
  return {
    resolve,
    ctx: {
      container: { resolve },
      auth: options.auth === undefined ? { sub: USER, tenantId: TENANT, orgId: ORG } : options.auth,
      organizationScope: null,
      selectedOrganizationId: ORG,
      organizationIds: [ORG],
    },
  }
}

function grantOnly(granted: string[]): jest.MockedFunction<RbacCheck> {
  return jest.fn(async (_userId, required) => required.every((feature) => granted.includes(feature)))
}

describe('wms command in-command feature guard (#7673)', () => {
  beforeAll(async () => {
    await import('../index')
  })

  beforeEach(() => {
    findOneWithDecryptionMock.mockClear()
  })

  describe.each([
    ['wms.locations.delete', { id: LOCATION_ID }],
    ['wms.locations.update', { id: LOCATION_ID, code: 'A-01' }],
  ])('%s', (commandId, input) => {
    it('rejects a caller without wms.manage_locations with 403 before touching data', async () => {
      const userHasAllFeatures = grantOnly(['wms.view', 'wms.manage_zones'])
      const { ctx, resolve } = createCtx({ rbac: { userHasAllFeatures } })
      const handler = commandRegistry.get(commandId)!

      const run = handler.execute(input, ctx as never)
      await expect(run).rejects.toBeInstanceOf(CrudHttpError)
      await expect(run).rejects.toMatchObject({ status: 403 })
      expect(userHasAllFeatures).toHaveBeenCalledWith(USER, ['wms.manage_locations'], {
        tenantId: TENANT,
        organizationId: ORG,
      })
      expect(resolve).not.toHaveBeenCalledWith('em')
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('rejects the undo snapshot (prepare) for a caller without the feature', async () => {
      const { ctx } = createCtx({ rbac: { userHasAllFeatures: grantOnly([]) } })
      const handler = commandRegistry.get(commandId)!
      await expect(handler.prepare!(input, ctx as never)).rejects.toMatchObject({ status: 403 })
      expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    })

    it('lets a caller holding wms.manage_locations reach the handler', async () => {
      const userHasAllFeatures = grantOnly(['wms.manage_locations'])
      const { ctx } = createCtx({ rbac: { userHasAllFeatures } })
      const handler = commandRegistry.get(commandId)!

      await expect(handler.execute(input, ctx as never)).rejects.toMatchObject({
        status: 404,
        body: { error: 'Warehouse location not found.' },
      })
      expect(findOneWithDecryptionMock).toHaveBeenCalled()
    })
  })

  it('fails closed when the actor has no user id', async () => {
    const { ctx } = createCtx({
      auth: { tenantId: TENANT, orgId: ORG },
      rbac: { userHasAllFeatures: jest.fn(async () => true) },
    })
    await expect(
      commandRegistry.get('wms.locations.delete')!.execute({ id: LOCATION_ID }, ctx as never),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed when rbacService is unavailable', async () => {
    const { ctx } = createCtx({ rbac: null })
    await expect(
      commandRegistry.get('wms.locations.delete')!.execute({ id: LOCATION_ID }, ctx as never),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('fails closed when the rbac check throws', async () => {
    const { ctx } = createCtx({
      rbac: { userHasAllFeatures: jest.fn(async () => { throw new Error('acl store down') }) },
    })
    await expect(
      commandRegistry.get('wms.locations.delete')!.execute({ id: LOCATION_ID }, ctx as never),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('treats an actor-less context as a trusted server-side dispatch', async () => {
    const userHasAllFeatures = jest.fn(async () => false)
    const { ctx } = createCtx({ auth: null, rbac: { userHasAllFeatures } })
    await expect(
      commandRegistry.get('wms.locations.delete')!.execute({ id: LOCATION_ID }, ctx as never),
    ).rejects.toMatchObject({ status: 404 })
    expect(userHasAllFeatures).not.toHaveBeenCalled()
  })

  it('accepts wms.import as an alternative grant for inventory adjustments', async () => {
    const userHasAllFeatures = grantOnly(['wms.import'])
    const { ctx } = createCtx({ rbac: { userHasAllFeatures } })
    const run = commandRegistry.get('wms.inventory.adjust')!.execute({}, ctx as never)
    await expect(run).rejects.not.toMatchObject({ status: 403 })
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER, ['wms.adjust_inventory'], expect.anything())
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER, ['wms.import'], expect.anything())
  })

  it.each([
    ['wms.warehouses.delete', 'wms.manage_warehouses'],
    ['wms.zones.delete', 'wms.manage_zones'],
    ['wms.inventoryProfiles.delete', 'wms.manage_inventory'],
    ['wms.lots.delete', 'wms.manage_inventory'],
    ['wms.asns.delete', 'wms.manage_asn'],
    ['wms.receiving-lines.delete', 'wms.manage_asn'],
    ['wms.asns.close', 'wms.manage_asn'],
    ['wms.asns.receive-line', 'wms.receive_inventory'],
    ['wms.inventory.reserve', 'wms.manage_reservations'],
    ['wms.inventory.release', 'wms.manage_reservations'],
    ['wms.inventory.allocate', 'wms.manage_reservations'],
    ['wms.inventory.receive', 'wms.receive_inventory'],
    ['wms.inventory.move', 'wms.adjust_inventory'],
    ['wms.inventory.cycleCount', 'wms.cycle_count'],
    ['wms.putaway-tasks.delete', 'wms.manage_putaway'],
    ['wms.putaway-tasks.assign', 'wms.manage_putaway'],
    ['wms.putaway-tasks.complete', 'wms.adjust_inventory'],
    ['wms.sales-order.assign-warehouse', 'wms.manage_reservations'],
    ['wms.sales-order.unassign-warehouse', 'wms.manage_reservations'],
    ['wms.sales-order.re-run-reservation', 'wms.manage_reservations'],
  ])('%s requires %s', async (commandId, feature) => {
    const userHasAllFeatures = grantOnly([])
    const { ctx } = createCtx({ rbac: { userHasAllFeatures } })
    await expect(commandRegistry.get(commandId)!.execute({}, ctx as never)).rejects.toMatchObject({ status: 403 })
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER, [feature], expect.anything())
  })
})
