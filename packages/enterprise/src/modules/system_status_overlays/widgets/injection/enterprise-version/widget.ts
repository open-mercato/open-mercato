import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import EnterpriseVersionWidget from './widget.client'

type AdminPageContext = {
  path?: string
}

const widget: InjectionWidgetModule<AdminPageContext, Record<string, unknown>> = {
  metadata: {
    id: 'system_status_overlays.injection.enterprise-version',
    title: 'Enterprise version info',
    description: 'Shows current application version and enterprise edition on system status page.',
    priority: 500,
    enabled: true,
  },
  Widget: EnterpriseVersionWidget,
}

export default widget

