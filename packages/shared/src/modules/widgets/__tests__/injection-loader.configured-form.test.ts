import {
  loadConfiguredFormWidgetsForSpot,
  loadInjectionWidgetsForSpot,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '../injection-loader'
import type { ModuleInjectionWidgetEntry } from '../../registry'

const spot = 'crud-form:example.record:header'
const widgetId = 'example.widget'

function entry(loader: ModuleInjectionWidgetEntry['loader'], key = 'example/widget', id = widgetId): ModuleInjectionWidgetEntry {
  return { moduleId: 'example', key, widgetId: id, source: 'package', loader }
}

function bind(entries: ModuleInjectionWidgetEntry[], boundSpot = spot) {
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'example', table: { [boundSpot]: widgetId } }], entries)
  registerEnabledModuleIds(['example'])
}

it('rejects a registered load failure without altering the ordinary widget fallback', async () => {
  const reject = entry(async () => { throw new Error('Fixture chunk failed') })
  const fallback = entry(async () => ({ metadata: { id: widgetId, title: 'Widget' }, Widget: () => null }), 'example/fallback')
  bind([reject, fallback])
  await expect(loadConfiguredFormWidgetsForSpot(spot, 'render')).rejects.toThrow('Fixture chunk failed')
  await expect(loadInjectionWidgetsForSpot(spot)).resolves.toMatchObject([{ key: 'example/fallback' }])
})

it('does not import unrelated entries and skips a widget with a disabled required module', async () => {
  const unrelated = jest.fn(async () => { throw new Error('Unrelated fixture') })
  bind([
    entry(async () => ({
      metadata: { id: widgetId, title: 'Widget', requiredModules: ['absent'] }, Widget: () => null,
    })),
    entry(unrelated, 'example/unrelated', 'example.unrelated'),
  ], 'crud-form:*:header')
  await expect(loadConfiguredFormWidgetsForSpot(spot, 'render')).resolves.toEqual([])
  expect(unrelated).not.toHaveBeenCalled()
})

it('rejects unresolved slots and incompatible render/data widget kinds', async () => {
  bind([])
  await expect(loadConfiguredFormWidgetsForSpot(spot, 'render')).rejects.toThrow(/invalid configured form widget binding/i)
  bind([entry(async () => ({ metadata: { id: widgetId }, fields: [] }))])
  await expect(loadConfiguredFormWidgetsForSpot(spot, 'render')).rejects.toThrow(/invalid configured form widget kind/i)
  await expect(loadConfiguredFormWidgetsForSpot(spot, 'data')).resolves.toMatchObject([{ metadata: { id: widgetId } }])
})
