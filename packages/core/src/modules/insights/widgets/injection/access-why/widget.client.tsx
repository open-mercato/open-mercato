"use client"

import * as React from 'react'
import { ShieldQuestion } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { AccessWhyPanel } from '../../../components/AccessWhyPanel'
import { readContextId, readContextStringList } from '../../../lib/client/context'
import { resolveExplainableAccessFeatures } from '../../../lib/client/explainApi'

export type AccessWhyContext = {
  path?: unknown
  requiredFeatures?: unknown
}

function AccessWhyDisclosure({ path, features }: { path: string | null; features: string[] }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const panelId = 'insights-access-why-panel'
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        data-testid="insights-access-why-trigger"
      >
        <ShieldQuestion className="size-4" aria-hidden="true" />
        {open ? t('insights.why.access.hide') : t('insights.why.access.trigger')}
      </Button>
      {open ? (
        <div id={panelId}>
          <AccessWhyPanel requiredFeatures={features} path={path} />
        </div>
      ) : null}
    </div>
  )
}

export default function AccessWhyWidget({ context }: InjectionWidgetComponentProps<AccessWhyContext>) {
  const path = readContextId(context, 'path')
  const features = resolveExplainableAccessFeatures(readContextStringList(context, 'requiredFeatures'))
  if (!features) return null
  return <AccessWhyDisclosure key={`${path ?? ''}|${features.join(',')}`} path={path} features={features} />
}
