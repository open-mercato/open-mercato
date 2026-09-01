import {
  applyInjectionWidgetOverridesToEntries,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
} from '@open-mercato/shared/modules/overrides'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import {
  CLIENT_OVERRIDE_DOMAINS,
  ensureModuleOverridesApplied,
  resetModuleOverridesAppliedForTests,
} from '../ClientBootstrap'

const ENTRY_KEY = 'catalog:product-seo:widget'
const WIDGET_ID = 'catalog.injection.product-seo'

jest.mock('@/modules', () => ({
  enabledModules: [
    {
      id: 'app',
      from: '@app',
      overrides: {
        widgets: { injection: { 'catalog.injection.product-seo': null } },
        ai: { agents: { 'catalog.catalog_assistant': null } },
      },
    },
  ],
}))

function makeEntries(): ModuleInjectionWidgetEntry[] {
  return [
    { moduleId: 'catalog', key: ENTRY_KEY, source: 'package', widgetId: WIDGET_ID, loader: jest.fn() },
    { moduleId: 'catalog', key: 'catalog:pricing:widget', source: 'package', widgetId: 'catalog.injection.pricing', loader: jest.fn() },
  ]
}

beforeEach(() => {
  resetModuleOverrideAppliersForTests()
  resetModuleContractOverridesForTests()
  resetModuleOverridesAppliedForTests()
})

describe('client bootstrap module overrides (#5152)', () => {
  it('dispatches only the domains whose registries the browser re-registers', () => {
    // A domain added here without a matching client registration would fill a store
    // nothing reads and report server-wired appliers as unwired in the browser.
    expect(CLIENT_OVERRIDE_DOMAINS).toEqual(['widgets', 'notifications'])
  })

  it('applies modules.ts overrides so a disabled widget stays disabled after hydration', async () => {
    expect(applyInjectionWidgetOverridesToEntries(makeEntries())).toHaveLength(2)

    await ensureModuleOverridesApplied()

    expect(applyInjectionWidgetOverridesToEntries(makeEntries()).map((entry) => entry.key))
      .toEqual(['catalog:pricing:widget'])
  })

  it('dispatches once no matter how many registry groups await it concurrently', async () => {
    const [first, second, third] = [
      ensureModuleOverridesApplied(),
      ensureModuleOverridesApplied(),
      ensureModuleOverridesApplied(),
    ]
    expect(second).toBe(first)
    expect(third).toBe(first)

    await Promise.all([first, second, third])

    expect(applyInjectionWidgetOverridesToEntries(makeEntries()).map((entry) => entry.key))
      .toEqual(['catalog:pricing:widget'])
  })
})
