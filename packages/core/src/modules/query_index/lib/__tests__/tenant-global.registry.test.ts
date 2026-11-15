import { resetTenantGlobalEntityTypes } from '../tenant-global'

type TenantGlobalRegistry = typeof import('../tenant-global')

function loadIsolatedRegistry(): TenantGlobalRegistry {
  let registry: TenantGlobalRegistry | undefined
  jest.isolateModules(() => {
    registry = jest.requireActual<TenantGlobalRegistry>('../tenant-global')
  })
  if (!registry) throw new Error('[internal] Isolated tenant-global registry did not load')
  return registry
}

describe('tenant-global declaration registry', () => {
  beforeEach(() => resetTenantGlobalEntityTypes())
  afterEach(() => resetTenantGlobalEntityTypes())

  it('shares bootstrap registrations and resets across distinct module instances', () => {
    const writer = loadIsolatedRegistry()
    writer.registerTenantGlobalEntityTypes('billing:plan')
    const reader = loadIsolatedRegistry()

    expect(writer).not.toBe(reader)
    expect(writer.registerTenantGlobalEntityTypes).not.toBe(reader.registerTenantGlobalEntityTypes)
    expect(reader.isTenantGlobalEntityType('billing:plan')).toBe(true)
    expect(reader.listTenantGlobalEntityTypes()).toEqual(['feature_toggles:feature_toggle', 'billing:plan'])

    reader.resetTenantGlobalEntityTypes()

    expect(writer.listTenantGlobalEntityTypes()).toEqual(['feature_toggles:feature_toggle'])
    expect(writer.isTenantGlobalEntityType('billing:plan')).toBe(false)
    expect(writer.isTenantGlobalEntityType('feature_toggles:feature_toggle')).toBe(true)
  })

  it('keeps normalized registrations idempotent across module instances', () => {
    const first = loadIsolatedRegistry()
    const second = loadIsolatedRegistry()
    first.registerTenantGlobalEntityTypes('', ' billing:plan ')
    second.registerTenantGlobalEntityTypes('billing:plan', '   ')

    expect(first.listTenantGlobalEntityTypes()).toEqual(['feature_toggles:feature_toggle', 'billing:plan'])
    expect(second.isTenantGlobalEntityType(' billing:plan ')).toBe(true)
  })
})
