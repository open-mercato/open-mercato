"use client"

import * as React from 'react'
import { AlertCircle, Check, ChevronDown, ListChecks } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@open-mercato/ui/primitives/dropdown-menu'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  StepIndicator,
  StepperDots,
  type StepIndicatorStatus,
  type StepIndicatorStep,
} from '@open-mercato/ui/primitives/step-indicator'
import type { WizardProps, WizardStep } from '../contracts/wizard'

const ROOT_CLASS = 'flex max-w-3xl flex-col gap-section'
const SELECTABLE_STATUSES: StepIndicatorStatus[] = ['complete', 'error']
const SKELETON_STEPS = ['first', 'second', 'third']
const SKELETON_FIELDS = ['first', 'second']

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
  onRetry,
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
    return (
      <div data-slot="wizard" aria-busy="true" className={cn(ROOT_CLASS, className)}>
        <span className="sr-only">{t('ui.blocks.wizard.loading', 'Loading')}</span>
        <div className="hidden items-center gap-4 md:flex">
          {SKELETON_STEPS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <Skeleton shape="circle" className="size-5" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="flex h-10 items-center justify-between md:hidden">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-10" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SKELETON_FIELDS.map((key) => (
              <div key={key} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end border-t border-border pt-4">
          <Skeleton className="h-10 w-full sm:h-9 sm:w-20" />
        </div>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <ErrorMessage
        className={cn('max-w-xl rounded-md', className)}
        label={errorMessage ?? t('ui.blocks.wizard.error', 'Something went wrong')}
        action={
          onRetry ? (
            <Button type="button" size="sm" variant="outline" className="text-foreground" onClick={onRetry}>
              {t('ui.blocks.wizard.retry', 'Try again')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (status === 'empty') {
    return (
      emptyState ?? (
        <EmptyState
          size="sm"
          icon={<ListChecks aria-hidden="true" className="size-5" />}
          title={t('ui.blocks.wizard.empty', 'Nothing to show')}
          description={t('ui.blocks.wizard.emptyDescription', 'There are no steps to complete yet.')}
          className={cn('items-start text-left px-0', className)}
        />
      )
    )
  }

  const position = t('ui.blocks.wizard.stepPosition', 'Step {current} of {total}', {
    current: activeIndex + 1,
    total: steps.length,
  })
  const summary = t('ui.blocks.wizard.stepSummary', 'Step {current} of {total}: {title}', {
    current: activeIndex + 1,
    total: steps.length,
    title: activeStep.title,
  })
  const canSelectSteps = typeof onStepSelect === 'function'
  const selectStep = (stepId: string) => {
    if (stepId === activeStepId || isBusy) return
    onStepSelect?.(stepId)
  }
  const describeStepError = (step: WizardStep) =>
    step.errorMessage
      ? t('ui.blocks.wizard.stepErrorWithMessage', '{title}: {message}', {
          title: step.title,
          message: step.errorMessage,
        })
      : t('ui.blocks.wizard.stepError', '{title} needs attention', { title: step.title })
  const erroredSteps = steps.filter((step) => step.state === 'error')
  const erroredIndexes = steps.flatMap((step, index) => (step.state === 'error' ? [index] : []))

  return (
    <div data-slot="wizard" className={cn(ROOT_CLASS, className)} onKeyDown={handleKeyDown}>
      <div className="hidden md:block">
        {activeStep.state === 'error' ? (
          <span data-slot="wizard-current-step-marker" aria-current="step" className="sr-only">
            {activeStep.title}
          </span>
        ) : null}
        <StepIndicator
          steps={indicatorSteps}
          showNumbers
          truncateLabels
          className="flex-wrap gap-y-3"
          onStepClick={isBusy || !canSelectSteps ? undefined : selectStep}
          clickableStatuses={SELECTABLE_STATUSES}
        />
      </div>
      <div className="flex min-h-10 items-center justify-between gap-4 md:hidden">
        {canSelectSteps ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={isBusy}
                data-slot="wizard-step-summary"
                aria-current="step"
                aria-label={summary}
              >
                {position}
                <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent data-slot="wizard-step-menu" className="min-w-56">
              {steps.map((step, index) => {
                const isActive = step.id === activeStepId
                const isSelectable = !isActive && (step.state === 'complete' || step.state === 'error')
                return (
                  <DropdownMenuItem
                    key={step.id}
                    disabled={!isSelectable}
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={step.state === 'error' ? describeStepError(step) : undefined}
                    onSelect={() => selectStep(step.id)}
                    className={cn('min-h-10', isActive && 'data-[disabled]:opacity-100')}
                  >
                    <span aria-hidden="true" className="w-4 text-center text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{step.title}</span>
                    {step.state === 'error' ? (
                      <AlertCircle aria-hidden="true" className="text-status-error-icon" />
                    ) : step.state === 'complete' ? (
                      <Check aria-hidden="true" className="text-status-success-icon" />
                    ) : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <p data-slot="wizard-step-summary" aria-current="step" className="text-sm text-foreground">
            {position}
          </p>
        )}
        <StepperDots count={steps.length} activeStep={activeIndex} errorSteps={erroredIndexes} />
      </div>
      <div className="flex flex-col gap-4">
      {erroredSteps.length > 0 ? (
        <ul data-slot="wizard-step-errors" role="alert" className="flex flex-col gap-1">
          {erroredSteps.map((step) => {
            const message = describeStepError(step)
            const canJump = canSelectSteps && step.id !== activeStepId
            return (
              <li key={step.id} className="flex items-start gap-2 text-sm text-status-error-text">
                {canJump ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => selectStep(step.id)}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md text-left underline-offset-4 outline-none hover:underline focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 md:min-h-8"
                  >
                    <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-status-error-icon" />
                    <span>{message}</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-status-error-icon" />
                    <span>{message}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
      <div
        ref={contentRef}
        role="region"
        aria-labelledby={`${titleId}-title`}
        tabIndex={-1}
        data-slot="wizard-content"
        className="outline-none"
      >
        <div data-slot="wizard-step-header" className="mb-4 flex flex-col gap-1">
          <h2 id={`${titleId}-title`} className="text-xl font-normal leading-tight text-foreground">
            {activeStep.title}
          </h2>
          {activeStep.description ? (
            <p className="text-sm text-muted-foreground">{activeStep.description}</p>
          ) : null}
        </div>
        {children}
      </div>
      </div>
      <div
        data-slot="wizard-footer"
        className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        {footer === undefined || footer === null ? null : (
          <div className="min-w-0 text-sm text-muted-foreground">{footer}</div>
        )}
        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
          {isFirst ? null : (
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 sm:h-9 sm:flex-none"
              disabled={isBusy}
              onClick={onBack}
            >
              {t('ui.blocks.wizard.back', 'Back')}
            </Button>
          )}
          {isLast ? (
            <Button
              type="button"
              className="h-10 flex-1 sm:h-9 sm:flex-none"
              disabled={isBusy}
              onClick={() => void run('finish', onFinish)}
            >
              {pending === 'finish' ? <Spinner size="sm" /> : null}
              {t('ui.blocks.wizard.finish', 'Finish')}
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 flex-1 sm:h-9 sm:flex-none"
              disabled={isBusy}
              onClick={() => void run('next', onNext)}
            >
              {pending === 'next' ? <Spinner size="sm" /> : null}
              {t('ui.blocks.wizard.next', 'Next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
