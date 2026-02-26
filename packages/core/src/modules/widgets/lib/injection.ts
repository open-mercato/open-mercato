// Re-export from shared for backward compatibility
// New code should import directly from @open-mercato/shared/modules/widgets/injection-loader
export {
  registerCoreInjectionWidgets,
  getCoreInjectionWidgets,
  registerCoreInjectionTables,
  getCoreInjectionTables,
  invalidateInjectionWidgetCache,
  loadAllInjectionWidgets,
  loadInjectionDataWidgetById,
  loadInjectionDataWidgetsForSpot,
  loadInjectionWidgetById,
  loadInjectionWidgetsForSpot,
  type LoadedInjectionDataWidget,
  type LoadedInjectionWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
