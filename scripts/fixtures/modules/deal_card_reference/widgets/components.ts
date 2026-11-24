import type { DealCardProps } from '@open-mercato/core/modules/customers/backend/customers/deals/pipeline/components/DealCard'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides = [{
  target: { componentId: 'section:customers.deals.pipelineCard' },
  priority: 50,
  propsTransform: (props) => {
    const reference = props.deal.record?.description
    return typeof reference === 'string' && reference.startsWith('SPD-7260-')
      ? { ...props, referenceLabel: reference }
      : props
  },
}] satisfies ComponentOverride<DealCardProps>[]
