import {
  loadInjectionWidgetsForSpot,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { injectionTable } from '../../../injection-table'
import widget from '../widget'

test('loads the recent sign-ins widget at the security profile extension point', async () => {
  const widgetEntry = {
    key: 'security:profile-recent-sign-ins:widget',
    moduleId: 'security',
    source: 'package' as const,
    widgetId: widget.metadata.id,
    loader: async () => widget,
  }
  registerCoreInjectionWidgets([widgetEntry])
  registerCoreInjectionTables([{ moduleId: 'security', table: injectionTable }], [widgetEntry])
  const loaded = await loadInjectionWidgetsForSpot('security.profile.sections')
  expect(loaded).toHaveLength(1)
  expect(loaded[0].metadata.id).toBe(widget.metadata.id)
})
