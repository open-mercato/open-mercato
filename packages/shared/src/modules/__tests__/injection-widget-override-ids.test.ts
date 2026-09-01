import {
  applyInjectionWidgetOverridesToEntries,
  applyInjectionWidgetOverridesToTables,
  applyModuleOverridesFromEnabledModules,
  resetModuleContractOverridesForTests,
  resetModuleOverrideAppliersForTests,
  type ModuleEntryWithOverrides,
} from '../overrides'
import type { ModuleInjectionWidgetEntry } from '../registry'
import { createLogger } from '@open-mercato/shared/lib/logger'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})
const loggerWarn = createLogger('shared').warn as jest.Mock

const ENTRY_KEY = 'catalog:product-seo:widget'
const WIDGET_ID = 'catalog.injection.product-seo'

function makeEntries(): ModuleInjectionWidgetEntry[] {
  return [
    { moduleId: 'catalog', key: ENTRY_KEY, source: 'package', widgetId: WIDGET_ID, loader: jest.fn() },
    { moduleId: 'catalog', key: 'catalog:pricing:widget', source: 'package', widgetId: 'catalog.injection.pricing', loader: jest.fn() },
  ]
}

function makeTables() {
  return [
    {
      moduleId: 'catalog',
      table: {
        'backend.product.tabs': [
          { widgetId: WIDGET_ID, priority: 10 },
          { widgetId: 'catalog.injection.pricing', priority: 20 },
        ],
        'backend.product.footer': WIDGET_ID,
      },
    },
  ]
}

function disableWidget(overrideKey: string): void {
  const moduleEntry: ModuleEntryWithOverrides = {
    id: 'app',
    from: '@app',
    overrides: { widgets: { injection: { [overrideKey]: null } } },
  }
  applyModuleOverridesFromEnabledModules([moduleEntry])
}

function staleWarnings(): unknown[][] {
  return loggerWarn.mock.calls.filter((args) => String(args[0]).includes('did not match any registered entry'))
}

beforeEach(() => {
  resetModuleOverrideAppliersForTests()
  resetModuleContractOverridesForTests()
  loggerWarn.mockClear()
})

describe('injection widget overrides accept either identifier (#5152)', () => {
  it.each([
    ['entry.key', ENTRY_KEY],
    ['widgetId', WIDGET_ID],
  ])('drops the entry and its table slots when the override is keyed by %s', (_label, overrideKey) => {
    disableWidget(overrideKey)

    const entries = applyInjectionWidgetOverridesToEntries(makeEntries())
    expect(entries.map((entry) => entry.key)).toEqual(['catalog:pricing:widget'])

    expect(applyInjectionWidgetOverridesToTables(makeTables())).toEqual([
      {
        moduleId: 'catalog',
        table: {
          'backend.product.tabs': [{ widgetId: 'catalog.injection.pricing', priority: 20 }],
        },
      },
    ])

    expect(staleWarnings()).toEqual([])
  })

  it('resolves the key/widgetId pair from entries handed to the table filter directly', () => {
    disableWidget(ENTRY_KEY)

    expect(applyInjectionWidgetOverridesToTables(makeTables(), undefined, makeEntries())).toEqual([
      {
        moduleId: 'catalog',
        table: {
          'backend.product.tabs': [{ widgetId: 'catalog.injection.pricing', priority: 20 }],
        },
      },
    ])
  })

  it('replaces the entry when the override is keyed by widgetId', () => {
    const replacement: ModuleInjectionWidgetEntry = {
      moduleId: 'app',
      key: ENTRY_KEY,
      source: 'app',
      widgetId: WIDGET_ID,
      loader: jest.fn(),
    }
    applyModuleOverridesFromEnabledModules([{
      id: 'app',
      from: '@app',
      overrides: { widgets: { injection: { [WIDGET_ID]: replacement } } },
    }])

    expect(applyInjectionWidgetOverridesToEntries(makeEntries())[0]).toBe(replacement)
    expect(staleWarnings()).toEqual([])
  })

  it('still warns for an override key that matches neither identifier', () => {
    disableWidget('catalog.injection.does-not-exist')

    expect(applyInjectionWidgetOverridesToEntries(makeEntries())).toHaveLength(2)
    expect(staleWarnings()).toHaveLength(1)
  })

  it('leaves tables untouched when no widget is disabled', () => {
    const tables = makeTables()
    expect(applyInjectionWidgetOverridesToTables(tables)).toEqual(tables)
  })
})

describe('client-side override dispatch (#5152)', () => {
  it('dispatches only the requested domains so unwired ones are not reported', () => {
    applyModuleOverridesFromEnabledModules(
      [{
        id: 'app',
        from: '@app',
        overrides: {
          widgets: { injection: { [WIDGET_ID]: null } },
          ai: { agents: { 'catalog.catalog_assistant': null } },
        },
      }],
      { domains: ['widgets'] },
    )

    expect(applyInjectionWidgetOverridesToEntries(makeEntries()).map((entry) => entry.key))
      .toEqual(['catalog:pricing:widget'])
    expect(loggerWarn.mock.calls.filter((args) => String(args[0]).includes('not yet wired'))).toEqual([])
  })
})
