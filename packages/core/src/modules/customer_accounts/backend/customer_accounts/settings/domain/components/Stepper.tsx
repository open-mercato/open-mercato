"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { DomainStatus } from '@open-mercato/core/modules/customer_accounts/data/entities'

export type StepperProps = {
  status: DomainStatus | null
}

function activeStep(status: DomainStatus | null): number {
  if (!status) return 1
  if (status === 'pending' || status === 'dns_failed') return 2
  if (status === 'verified' || status === 'tls_failed') return 3
  if (status === 'active') return 4
  return 1
}

export function DefaultStepper({ status }: StepperProps) {
  const t = useT()
  const current = activeStep(status)
  const steps: Array<{ idx: number; label: string }> = [
    { idx: 1, label: t('customer_accounts.domainMapping.stepper.step1', 'Register Domain') },
    { idx: 2, label: t('customer_accounts.domainMapping.stepper.step2', 'Configure DNS') },
    { idx: 3, label: t('customer_accounts.domainMapping.stepper.step3', 'SSL Certificate') },
    { idx: 4, label: t('customer_accounts.domainMapping.stepper.step4', 'Live') },
  ]

  return (
    <ol className="flex flex-wrap items-center gap-3 text-sm">
      {steps.map((step, index) => {
        const isDone = step.idx < current
        const isCurrent = step.idx === current
        return (
          <li key={step.idx} className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                  isDone && 'border-status-success-icon bg-status-success-icon text-status-success-foreground',
                  isCurrent && 'border-primary bg-primary/10 text-primary',
                  !isDone && !isCurrent && 'border-border bg-background text-muted-foreground',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isDone ? <Check className="h-4 w-4" aria-hidden /> : step.idx}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <span className="hidden h-px w-8 bg-border sm:block" aria-hidden />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export default DefaultStepper
