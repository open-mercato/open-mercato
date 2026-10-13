import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonGroupsTabWidget from '../person-groups-tab'

type PersonGroupsTabContext = {
  resourceKind: string
  resourceId: string
}

const widget: InjectionWidgetModule<PersonGroupsTabContext, unknown> = {
  metadata: {
    id: 'customer_groups.injection.person-groups-tab',
    title: 'Groups',
    description: 'Customer group memberships for the current customer',
    features: ['customer_groups.memberships.view'],
    priority: 45,
    enabled: true,
  },
  Widget: PersonGroupsTabWidget,
}

export default widget
