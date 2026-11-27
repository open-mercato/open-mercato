import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import MaintenanceStatusWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'maintenance.injection.maintenance-status',
    title: 'Maintenance status',
    description: 'Shows a bypass banner during maintenance and blocks open pages when a maintenance window starts.',
    priority: 1000,
    enabled: true,
  },
  Widget: MaintenanceStatusWidget,
}

export default widget
