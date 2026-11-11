import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { TimeTrackingSettingsTabContext } from '../../../lib/time-tracking-ui/settingsTabs'
import SupportSettingsTab from './widget.client'

const widget: InjectionWidgetModule<TimeTrackingSettingsTabContext> = {
  metadata: {
    id: 'staff.injection.time-tracking-settings-support',
    title: 'Support',
    description: 'Support ticket categories, routing to projects and the ticket reference prefix.',
    features: ['staff.timesheets.settings.manage'],
    priority: 50,
    enabled: true,
  },
  Widget: SupportSettingsTab,
}

export default widget
