import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'

const widgetModule: InjectionWidgetModule = {
  metadata: {
    id: 'security.injection.dashboard-security-stats',
    title: 'Security stats',
    priority: 500,
    enabled: true,
  },
  Widget: () => null,
}

export default widgetModule
