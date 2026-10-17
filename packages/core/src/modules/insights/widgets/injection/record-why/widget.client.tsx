"use client"

import * as React from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { WhyDrawer } from '../../../components/WhyDrawer.client'
import { readContextId } from '../../../lib/client/context'
import { useExplainResourceDescriptor } from '../../../lib/client/useExplainDescriptors'

export type RecordWhyContext = {
  resourceKind?: unknown
  resourceId?: unknown
}

function RecordWhyTrigger({ resourceKind, resourceId }: { resourceKind: string; resourceId: string }) {
  const t = useT()
  const { descriptor } = useExplainResourceDescriptor(resourceKind)
  const [open, setOpen] = React.useState(false)
  if (!descriptor) return null
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="insights-record-why-trigger"
      >
        <MessageCircleQuestion className="size-4" aria-hidden="true" />
        {t('insights.why.trigger.record')}
      </Button>
      <WhyDrawer
        open={open}
        onOpenChange={setOpen}
        resourceKind={resourceKind}
        resourceId={resourceId}
        resourceLabelKey={descriptor.labelKey}
      />
    </div>
  )
}

export default function RecordWhyWidget({ context }: InjectionWidgetComponentProps<RecordWhyContext>) {
  const resourceKind = readContextId(context, 'resourceKind')
  const resourceId = readContextId(context, 'resourceId')
  if (!resourceKind || !resourceId) return null
  return <RecordWhyTrigger key={`${resourceKind}:${resourceId}`} resourceKind={resourceKind} resourceId={resourceId} />
}
