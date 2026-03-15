"use client"

import * as React from 'react'
import { match } from 'ts-pattern'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WizardStep } from '../types'

const STEP_ORDER: WizardStep[] = ['provider', 'configure', 'confirm']

export type WizardNavProps = {
  step: WizardStep
  onNavigate: (step: WizardStep) => void
}

export const WizardNav = (props: WizardNavProps) => {
  const { step, onNavigate } = props
  const t = useT()
  const stepIndex = STEP_ORDER.indexOf(step)

  const stepLabels: Record<WizardStep, string> = {
    provider: t('shipping_carriers.create.step.provider', 'Select carrier'),
    configure: t('shipping_carriers.create.step.configure', 'Configure shipment'),
    confirm: t('shipping_carriers.create.step.confirm', 'Select service & confirm'),
  }

  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground">
      {STEP_ORDER.map((stepId, index) => (
        <React.Fragment key={stepId}>
          {index > 0 ? <span aria-hidden>›</span> : null}
          <span
            className={match({ isCurrent: stepId === step, isPast: index < stepIndex })
              .with({ isCurrent: true }, () => 'font-medium text-foreground')
              .with({ isPast: true }, () => 'cursor-pointer hover:text-foreground')
              .otherwise(() => '')}
            onClick={() => {
              if (index < stepIndex) onNavigate(stepId)
            }}
          >
            {index + 1}. {stepLabels[stepId]}
          </span>
        </React.Fragment>
      ))}
    </nav>
  )
}
