import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import DealStatusWhyWidget, { type DealStatusWhyContext } from './widget.client'

const widget: InjectionWidgetModule<DealStatusWhyContext, unknown> = {
  metadata: {
    id: 'insights.injection.deal-status-why',
    title: 'Why? (deal status)',
    description: 'Explains why a deal has its current status, next to the deal status badges.',
    features: ['insights.explain.view', 'customers.deals.view'],
    requiredModules: ['customers'],
    priority: 100,
    enabled: true,
  },
  Widget: DealStatusWhyWidget,
}

export default widget
