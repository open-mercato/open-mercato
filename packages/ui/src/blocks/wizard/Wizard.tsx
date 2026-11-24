"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  StepIndicator,
  StepperDots,
  type StepIndicatorStatus,
  type StepIndicatorStep,
} from '@open-mercato/ui/primitives/step-indicator'
import type { WizardProps, WizardStep } from '../contracts/wizard'

type PendingAction = 'next' | 'finish' | null

function resolveStatus(step: WizardStep, activeStepId: string): StepIndicatorStatus {
  if (step.id === activeStepId) return step.state === 'error' ? 'error' : 'current'
  if (step.state === 'complete') return 'complete'
  if (step.state === 'error') return 'error'
  return 'pending'
}

export function Wizard({
  steps,
  activeStepId,
  onNext,
  onBack,
  onStepSelect,
  onFinish,
  children,
  footer,
  status,
  errorMessage,
  emptyState,
  className,
}: WizardProps) {
  const t = useT()
  const [pending, setPending] = React.useState<PendingAction>(null)
  const mountedRef = React.useRef(true)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const previousStepIdRef = React.useRef(activeStepId)
  const titleId = React.useId()

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === activeStepId),
  )
  const activeStep = steps[activeIndex]
  const isFirst = activeIndex === 0
  const isLast = activeIndex === steps.length - 1

  const indicatorSteps = React.useMemo<StepIndicatorStep[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        label: step.title,
        description: step.description,
        status: resolveStatus(step, activeStepId),
      })),
    [steps, activeStepId],
  )

  const run = React.useCallback(async (action: Exclude<PendingAction, null>, handler: () => Promise<unknown>) => {
    setPending(action)
    try {
      await handler()
    } catch {
      return
    } finally {
      if (mountedRef.current) setPending(null)
    }
  }, [])

  React.useEffect(() => {
    if (previousStepIdRef.current === activeStepId) return
    previousStepIdRef.current = activeStepId
    contentRef.current?.focus()
  }, [activeStepId])

  const isBusy = pending !== null

  const advance = React.useCallback(() => {
    if (isLast) return run('finish', onFinish)
    return run('next', onNext)
  }, [isLast, onFinish, onNext, run])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || isBusy) return
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void advance()
    },
    [advance, isBusy],
  )

  if (status === 'loading') {
    return <LoadingMessage className={className} label={t('ui.blocks.wizard.loading', 'Loading')} />
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        className={className}
        label={errorMessage ?? t('ui.blocks.wizard.error', 'Something went wrong')}
      />
    )
  }

  if (status === 'empty') {
    return (
      emptyState ?? (
        <EmptyState className={className} title={t('ui.blocks.wizard.empty', 'Nothing to show')} />
      )
    )
  }

  const summary = t('ui.blocks.wizard.stepSummary', 'Step {current} of {total}: {title}', {
    current: activeIndex + 1,
    total: steps.length,
    title: activeStep.title,
  })
  return (
    <div data-slot="wizard" className={cn('flex flex-col gap-6', className)} onKeyDown={handleKeyDown}>
      <div className="hidden md:block">
        {activeStep.state === 'error' ? (
          <span data-slot="wizard-current-step-marker" aria-current="step" className="sr-only">
            {activeStep.title}
          </span>
        ) : null}
        <StepIndicator
          steps={indicatorSteps}
          onStepClick={onStepSelect}
          clickableStatuses={['complete']}
        />
      </div>
      <div className="flex flex-col gap-2 md:hidden">
        <p data-slot="wizard-step-summary" aria-current="step" className="text-sm text-foreground">
          {summary}
        </p>
        <StepperDots count={steps.length} activeStep={activeIndex} />
      </div>
      <div
        ref={contentRef}
              role="region"
        aria-labelledby={`${titleId}-title`}
        tabIndex={-1}
        data-slot="wizard-content"
        className="outline-none"
      >
        <span id={`${titleId}-title`} className="sr-only">
          {activeStep.title}
        </span>
        {children}
      </div>
      <div
        data-slot="wizard-footer"
        className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4"
      >
        <div className="min-w-0 text-sm text-muted-foreground">{footer}</div>
        <div className="flex items-center gap-2">
          {isFirst ? null : (
            <Button type="button" variant="outline" disabled={isBusy} onClick={onBack}>
              {t('ui.blocks.wizard.back', 'Back')}
            </Button>
          )}
          {isLast ? (
            <Button type="button" disabled={isBusy} onClick={() => void run('finish', onFinish)}>
              {pending === 'finish' ? <Spinner size="sm" /> : null}
              {t('ui.blocks.wizard.finish', 'Finish')}
            </Button>
          ) : (
            <Button type="button" disabled={isBusy} onClick={() => void run('next', onNext)}>
              {pending === 'next' ? <Spinner size="sm" /> : null}
              {t('ui.blocks.wizard.next', 'Next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
