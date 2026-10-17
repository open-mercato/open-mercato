import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import LogCauseWidget, { type LogCauseContext } from './widget.client'

const widget: InjectionWidgetModule<LogCauseContext, unknown> = {
  metadata: {
    id: 'insights.injection.log-cause',
    title: 'Why? (history entry)',
    description: 'Explains the recorded cause of one version-history entry.',
    features: ['insights.explain.view'],
    priority: 100,
    enabled: true,
  },
  Widget: LogCauseWidget,
}

export default widget
