"use client"

import * as React from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { WhyDrawer } from '../../../components/WhyDrawer.client'
import { readContextId } from '../../../lib/client/context'
import { useExplainMode } from '../../../lib/client/explainMode'
import { describeFieldLabel } from '../../../lib/client/format'
import {
  findExplainFieldLabelKey,
  findFormExplainResource,
  resolveExplainFieldKey,
} from '../../../lib/client/fieldExplain'
import { useExplainDescriptors } from '../../../lib/client/useExplainDescriptors'
import { useFieldExplainEnabled } from '../../../lib/client/useFieldExplainEnabled'

export type FieldWhyContext = {
  entityId?: unknown
  recordId?: unknown
  fieldId?: unknown
  resourceKind?: unknown
}

type FieldWhyTriggerProps = {
  formEntityId: string
  recordId: string
  fieldId: string
  resourceKind: string | null
}

function FieldWhyTrigger({ formEntityId, recordId, fieldId, resourceKind }: FieldWhyTriggerProps) {
  const t = useT()
  const featureEnabled = useFieldExplainEnabled()
  const [explainMode] = useExplainMode(formEntityId)
  const active = featureEnabled && explainMode
  const { resources } = useExplainDescriptors(active)
  const [open, setOpen] = React.useState(false)
  const resource = active ? findFormExplainResource(resources, formEntityId, resourceKind) : null
  const fieldKey = resource ? resolveExplainFieldKey(resource, fieldId) : null
  if (!resource || !fieldKey) return null
  const fieldLabel = describeFieldLabel(fieldKey, findExplainFieldLabelKey(resource, fieldKey), t)
  const triggerLabel = t('insights.why.trigger.field', { field: fieldLabel })
  return (
    <div className="flex">
      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-testid="insights-field-why-trigger"
      >
        <MessageCircleQuestion className="size-4" aria-hidden="true" />
      </IconButton>
      <WhyDrawer
        open={open}
        onOpenChange={setOpen}
        resourceKind={resource.resourceKind}
        resourceId={recordId}
        initialField={fieldKey}
        resourceLabelKey={resource.labelKey}
      />
    </div>
  )
}

export default function FieldWhyWidget({ context }: InjectionWidgetComponentProps<FieldWhyContext>) {
  const formEntityId = readContextId(context, 'entityId')
  const recordId = readContextId(context, 'recordId')
  const fieldId = readContextId(context, 'fieldId')
  if (!formEntityId || !recordId || !fieldId) return null
  return (
    <FieldWhyTrigger
      key={`${formEntityId}:${recordId}:${fieldId}`}
      formEntityId={formEntityId}
      recordId={recordId}
      fieldId={fieldId}
      resourceKind={readContextId(context, 'resourceKind')}
    />
  )
}
