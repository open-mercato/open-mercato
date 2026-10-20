"use client"

import * as React from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { readContextId } from '../../../lib/client/context'
import { useExplainMode } from '../../../lib/client/explainMode'
import {
  findFormExplainResource,
  hasExplainableFormFields,
  readFormEntityIdFromSpotId,
} from '../../../lib/client/fieldExplain'
import { useExplainDescriptors } from '../../../lib/client/useExplainDescriptors'
import { useFieldExplainEnabled } from '../../../lib/client/useFieldExplainEnabled'

export type FieldExplainToggleContext = {
  injectionSpotId?: unknown
  recordId?: unknown
  resourceKind?: unknown
}

function FieldExplainSwitch({ formEntityId, resourceKind }: { formEntityId: string; resourceKind: string | null }) {
  const t = useT()
  const switchId = React.useId()
  const featureEnabled = useFieldExplainEnabled()
  const [explainMode, setExplainMode] = useExplainMode(formEntityId)
  const { resources } = useExplainDescriptors(featureEnabled)
  const resource = featureEnabled ? findFormExplainResource(resources, formEntityId, resourceKind) : null
  if (!resource || !hasExplainableFormFields(resource)) return null
  return (
    <div className="inline-flex items-center gap-2" data-testid="insights-field-explain-toggle">
      <MessageCircleQuestion className="size-4 text-muted-foreground" aria-hidden="true" />
      <label htmlFor={switchId} className="text-sm text-muted-foreground">
        {t('insights.why.explainMode.toggle')}
      </label>
      <Switch id={switchId} checked={explainMode} onCheckedChange={setExplainMode} />
    </div>
  )
}

export default function FieldExplainToggleWidget({ context }: InjectionWidgetComponentProps<FieldExplainToggleContext>) {
  const formEntityId = readFormEntityIdFromSpotId(readContextId(context, 'injectionSpotId'))
  const recordId = readContextId(context, 'recordId')
  if (!formEntityId || !recordId) return null
  return (
    <FieldExplainSwitch
      key={formEntityId}
      formEntityId={formEntityId}
      resourceKind={readContextId(context, 'resourceKind')}
    />
  )
}
