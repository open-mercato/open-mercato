"use client"

import * as React from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { WhyDrawer } from '../../../components/WhyDrawer.client'
import { readContextId } from '../../../lib/client/context'
import { useExplainResourceDescriptor } from '../../../lib/client/useExplainDescriptors'

export const DEAL_RESOURCE_KIND = 'customers.deal'
export const DEAL_STATUS_FIELD = 'status'

export type DealStatusWhyContext = {
  resourceKind?: unknown
  resourceId?: unknown
  dealId?: unknown
}

function DealStatusWhyTrigger({ dealId }: { dealId: string }) {
  const t = useT()
  const { descriptor } = useExplainResourceDescriptor(DEAL_RESOURCE_KIND)
  const [open, setOpen] = React.useState(false)
  const explainable = descriptor?.fields.some((field) => field.key === DEAL_STATUS_FIELD) ?? false
  if (!descriptor || !explainable) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="insights-deal-status-why-trigger"
      >
        <MessageCircleQuestion className="size-4" aria-hidden="true" />
        {t('insights.why.trigger.status')}
      </Button>
      <WhyDrawer
        open={open}
        onOpenChange={setOpen}
        resourceKind={DEAL_RESOURCE_KIND}
        resourceId={dealId}
        initialField={DEAL_STATUS_FIELD}
        resourceLabelKey={descriptor.labelKey}
      />
    </>
  )
}

export default function DealStatusWhyWidget({ context }: InjectionWidgetComponentProps<DealStatusWhyContext>) {
  const resourceKind = readContextId(context, 'resourceKind') ?? DEAL_RESOURCE_KIND
  const dealId = readContextId(context, 'resourceId', 'dealId')
  if (resourceKind !== DEAL_RESOURCE_KIND || !dealId) return null
  return <DealStatusWhyTrigger key={dealId} dealId={dealId} />
}
