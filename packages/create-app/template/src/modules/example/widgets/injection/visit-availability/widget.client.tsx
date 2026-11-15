"use client"

import { useEffect } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionContext, InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function VisitAvailabilityWidget({ context }: InjectionWidgetComponentProps<InjectionContext, Record<string, unknown>>) {
  const translate = useT()
  const state = context.sharedState as { set?: (key: string, value: unknown) => void } | undefined
  useEffect(() => { state?.set?.('visitAvailabilityTranslate', translate) }, [state, translate])
  return null
}
