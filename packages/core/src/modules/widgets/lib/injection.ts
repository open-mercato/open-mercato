// Re-export from shared for backward compatibility
// New code should import directly from @open-mercato/shared/modules/widgets/injection-loader
export {
  registerCoreInjectionWidgets,
  getCoreInjectionWidgets,
  registerCoreInjectionTables,
  getCoreInjectionTables,
  invalidateInjectionWidgetCache,
  loadAllInjectionWidgets,
  loadInjectionWidgetById,
  loadInjectionWidgetsForSpot,
  type LoadedInjectionWidget,
} from '@open-mercato/shared/modules/widgets/injection-loader'
