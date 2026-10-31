import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import AccountIncidentsWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'incidents.injection.account-incidents',
    title: 'Account incidents',
    description: 'Shows incidents affecting this account',
    features: ['incidents.incident.view'],
    requiredModules: ['incidents'],
    priority: 50,
    enabled: true,
  },
  Widget: AccountIncidentsWidget,
}

export default widget
