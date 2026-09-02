import {
  applyInjectionWidgetOverridesToEntries,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
} from '@open-mercato/shared/modules/overrides'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import {
  CLIENT_OVERRIDE_DOMAINS,
  OVERRIDE_DEPENDENT_GROUPS,
  ensureModuleOverridesApplied,
  resetModuleOverridesAppliedForTests,
} from '../ClientBootstrap'

const ENTRY_KEY = 'catalog:product-seo:widget'
const WIDGET_ID = 'catalog.injection.product-seo'

const loggerCalls: { warn: unknown[][]; error: unknown[][] } = { warn: [], error: [] }

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...args: unknown[]) => { loggerCalls.warn.push(args) },
    error: (...args: unknown[]) => { loggerCalls.error.push(args) },
    child: () => logger,
  }
  return { createLogger: () => logger }
})

let failNextModulesRead = false

jest.mock('@/modules', () => ({
  get enabledModules() {
    if (failNextModulesRead) {
      failNextModulesRead = false
      throw new Error('chunk load failed')
    }
    return [
      {
        id: 'app',
        from: '@app',
        overrides: {
          widgets: { injection: { 'catalog.injection.product-seo': null } },
          ai: { agents: { 'catalog.catalog_assistant': null } },
        },
      },
    ]
  },
}))

let generatedModuleIds: string[] = ['app']

jest.mock('@/.mercato/generated/enabled-module-ids.generated', () => ({
  get enabledModuleIds() {
    return generatedModuleIds
  },
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
  loggerCalls.warn = []
  loggerCalls.error = []
  generatedModuleIds = ['app']
  failNextModulesRead = false
})

describe('client bootstrap module overrides (#5152)', () => {
  it('dispatches only the domains whose registries the browser re-registers', () => {
    // A domain added here without a matching client registration would fill a store
    // nothing reads and report server-wired appliers as unwired in the browser.
    expect(CLIENT_OVERRIDE_DOMAINS).toEqual(['widgets', 'notifications'])
  })

  it('awaits the dispatch only for the registry groups an override can change', () => {
    // The public /messages/view and /pay profiles register `messages` and `payments`
    // only; pulling `@/modules` into their client graph buys them nothing.
    expect([...OVERRIDE_DEPENDENT_GROUPS].sort()).toEqual(['dashboard', 'injection', 'notifications'])
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

  it('warns for modules the browser cannot see, so a server-only env gate is not silent', async () => {
    // `record_locks` is gated on OM_ENABLE_ENTERPRISE_MODULES, which Next does not
    // inline into the client bundle: the server dispatched its overrides and the
    // browser cannot. Without this warning the widget simply returns on hydration.
    generatedModuleIds = ['app', 'record_locks']

    await ensureModuleOverridesApplied()

    const warning = loggerCalls.warn.find(([message]) => String(message).includes('browser-evaluated module list'))
    expect(warning).toBeDefined()
    expect((warning?.[1] as { modules: string[] }).modules).toEqual(['record_locks'])
  })

  it('stays quiet when the browser sees every module the build did', async () => {
    await ensureModuleOverridesApplied()

    expect(loggerCalls.warn).toEqual([])
  })

  it('lets the next registry group retry after a transient failure instead of pinning unfiltered registries', async () => {
    failNextModulesRead = true

    const failed = ensureModuleOverridesApplied()
    await expect(failed).resolves.toBeUndefined()
    expect(loggerCalls.error).toHaveLength(1)
    expect(applyInjectionWidgetOverridesToEntries(makeEntries())).toHaveLength(2)

    const retried = ensureModuleOverridesApplied()
    expect(retried).not.toBe(failed)
    await retried

    expect(applyInjectionWidgetOverridesToEntries(makeEntries()).map((entry) => entry.key))
      .toEqual(['catalog:pricing:widget'])
  })
})
