"use client"

import * as React from 'react'
import type { InjectionSpotId, InjectionWizardWidget, InjectionContext } from '@open-mercato/shared/modules/widgets/injection'
import { useInjectionDataWidgets } from './useInjectionDataWidgets'
import { InjectionWizard } from './InjectionWizard'

type WizardInjectionSpotProps = {
  spotId: InjectionSpotId
  context: InjectionContext
  onClose?: () => void
}

function isWizardWidget(widget: Record<string, unknown>): boolean {
  const mod = (widget as any).module ?? widget
  return mod && typeof mod === 'object' && 'kind' in mod && mod.kind === 'wizard' && 'steps' in mod
}

/**
 * Renders wizard data widgets for a given injection spot.
 * Filters loaded data widgets to only those with `kind: 'wizard'`.
 */
export function WizardInjectionSpot({ spotId, context, onClose }: WizardInjectionSpotProps) {
  const { widgets, isLoading } = useInjectionDataWidgets(spotId)

  if (isLoading || widgets.length === 0) return null

  const wizardWidgets = widgets.filter(isWizardWidget)
  if (wizardWidgets.length === 0) return null

  return (
    <>
      {wizardWidgets.map((widget) => {
        const mod = ((widget as any).module ?? widget) as InjectionWizardWidget
        return (
          <InjectionWizard
            key={mod.metadata?.id ?? (widget as any).key}
            widget={mod}
            context={context}
            onClose={onClose}
          />
        )
      })}
    </>
  )
}
