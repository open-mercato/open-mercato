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

  it('accepts a map carrying both spellings without reporting either as stale', () => {
    applyModuleOverridesFromEnabledModules([{
      id: 'app',
      from: '@app',
      overrides: { widgets: { injection: { [ENTRY_KEY]: null, [WIDGET_ID]: null } } },
    }])

    expect(applyInjectionWidgetOverridesToEntries(makeEntries()).map((entry) => entry.key))
      .toEqual(['catalog:pricing:widget'])
    expect(applyInjectionWidgetOverridesToTables(makeTables())).toEqual([
      {
        moduleId: 'catalog',
        table: {
          'backend.product.tabs': [{ widgetId: 'catalog.injection.pricing', priority: 20 }],
        },
      },
    ])
    expect(staleWarnings()).toEqual([])
    expect(loggerWarn.mock.calls.filter((args) => String(args[0]).includes('Conflicting overrides'))).toEqual([])
  })

  it('warns when the two spellings of one widget disagree', () => {
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
      overrides: { widgets: { injection: { [ENTRY_KEY]: replacement, [WIDGET_ID]: null } } },
    }])

    expect(applyInjectionWidgetOverridesToEntries(makeEntries())[0]).toBe(replacement)
    expect(staleWarnings()).toEqual([])
    expect(loggerWarn.mock.calls.filter((args) => String(args[0]).includes('Conflicting overrides'))).toHaveLength(1)
  })

  it('warns when a replacement quietly changes the identifier it was not matched on', () => {
    // Matched on widgetId, so the foreign `key` passes validation — and then collides
    // with whatever registry slot already owns it. The override still applies, but the
    // author is told which identifier moved.
    const replacement: ModuleInjectionWidgetEntry = {
      moduleId: 'app',
      key: 'app:something-else:widget',
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
    const warnings = loggerWarn.mock.calls.filter((args) => String(args[0]).includes('changes an identifier it was not matched on'))
    expect(warnings).toHaveLength(1)
    expect((warnings[0][1] as { replaced: string[] }).replaced).toEqual([ENTRY_KEY])
  })

  it('reports two equivalent replacements as a duplicate instruction, not a conflict', () => {
    // Both spellings name the same widget with the same intent; they are distinct
    // objects only because the author wrote the literal twice.
    const makeReplacement = (): ModuleInjectionWidgetEntry => ({
      moduleId: 'app',
      key: ENTRY_KEY,
      source: 'app',
      widgetId: WIDGET_ID,
      loader: jest.fn(),
    })
    applyModuleOverridesFromEnabledModules([{
      id: 'app',
      from: '@app',
      overrides: { widgets: { injection: { [ENTRY_KEY]: makeReplacement(), [WIDGET_ID]: makeReplacement() } } },
    }])

    applyInjectionWidgetOverridesToEntries(makeEntries())

    expect(loggerWarn.mock.calls.filter((args) => String(args[0]).includes('Conflicting overrides'))).toEqual([])
    expect(loggerWarn.mock.calls.filter((args) => String(args[0]).includes('Duplicate replacement overrides'))).toHaveLength(1)
  })

  it('keeps the key/widgetId index on globalThis so a duplicated shared instance still resolves it', () => {
    // The index is written by @open-mercato/ui's entries filter and read by
    // @open-mercato/core's table filter; a module-local Map would split in a
    // standalone build that evaluates @open-mercato/shared through two chunks.
    applyInjectionWidgetOverridesToEntries(makeEntries())

    const index = (globalThis as Record<string, unknown>).__openMercatoInjectionWidgetIdAliases__
    expect(index).toBeInstanceOf(Map)
    expect([...((index as Map<string, Set<string>>).get(ENTRY_KEY) ?? [])]).toEqual([WIDGET_ID])
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
