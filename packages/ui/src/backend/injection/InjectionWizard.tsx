"use client"

import * as React from 'react'
import type {
  InjectionWizardWidget,
  InjectionWizardStep,
  InjectionContext,
} from '@open-mercato/shared/modules/widgets/injection'
import { InjectedField } from './InjectedField'
import { Button } from '../../primitives/button'
import { Spinner } from '../../primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

export type InjectionWizardProps = {
  widget: InjectionWizardWidget
  context: InjectionContext
  onClose?: () => void
}

type StepStatus = 'pending' | 'current' | 'completed'

function StepIndicator({
  steps,
  currentIndex,
}: {
  steps: InjectionWizardStep[]
  currentIndex: number
}) {
  const t = useT()

  return (
    <nav aria-label={t('ui.wizard.steps', 'Steps')} className="mb-6">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const status: StepStatus =
            index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'pending'
          const label = t(step.label, step.label)

          return (
            <li key={step.id} className="flex items-center gap-2">
              <div
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors',
                  status === 'completed' && 'bg-primary text-primary-foreground',
                  status === 'current' && 'border-2 border-primary bg-background text-primary',
                  status === 'pending' && 'border border-muted-foreground/30 bg-muted text-muted-foreground',
                )}
                aria-current={status === 'current' ? 'step' : undefined}
              >
                {status === 'completed' ? (
                  <svg className="size-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  'hidden text-sm sm:inline',
                  status === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'h-px w-6 sm:w-12',
                    index < currentIndex ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StepFieldsRenderer({
  step,
  data,
  onChange,
  context,
  fieldErrors,
}: {
  step: InjectionWizardStep
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  context: InjectionContext
  fieldErrors: Record<string, string>
}) {
  if (!step.fields || step.fields.length === 0) return null

  const fieldContext = {
    organizationId: context.organizationId,
    tenantId: context.tenantId,
    userId: context.userId,
    record: data,
  }

  return (
    <div className="space-y-4">
      {step.fields.map((field) => (
        <div key={field.id}>
          <InjectedField
            field={field}
            value={data[field.id]}
            onChange={onChange}
            context={fieldContext}
            formData={data}
          />
          {fieldErrors[field.id] && (
            <p className="mt-1 text-sm text-destructive">{fieldErrors[field.id]}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export function InjectionWizard({ widget, context, onClose }: InjectionWizardProps) {
  const t = useT()
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0)
  const [allData, setAllData] = React.useState<Record<string, unknown>>({})
  const [validating, setValidating] = React.useState(false)
  const [completing, setCompleting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  const steps = widget.steps
  const currentStep = steps[currentStepIndex]
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === steps.length - 1

  const handleFieldChange = React.useCallback((key: string, value: unknown) => {
    setAllData((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setErrorMessage(null)
  }, [])

  const handleSetData = React.useCallback((next: Record<string, unknown>) => {
    setAllData(next)
    setErrorMessage(null)
    setFieldErrors({})
  }, [])

  const validateCurrentStep = React.useCallback(async (): Promise<boolean> => {
    if (!currentStep?.validate) return true

    setValidating(true)
    setErrorMessage(null)
    setFieldErrors({})

    try {
      const result = await currentStep.validate(allData, context)
      if (!result.ok) {
        setErrorMessage(result.message ?? t('ui.wizard.validationFailed', 'Validation failed'))
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors)
        }
        return false
      }
      return true
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('ui.wizard.validationFailed', 'Validation failed'))
      return false
    } finally {
      setValidating(false)
    }
  }, [currentStep, allData, context, t])

  const handleNext = React.useCallback(async () => {
    const valid = await validateCurrentStep()
    if (!valid) return
    setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1))
    setErrorMessage(null)
    setFieldErrors({})
  }, [validateCurrentStep, steps.length])

  const handleBack = React.useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0))
    setErrorMessage(null)
    setFieldErrors({})
  }, [])

  const handleComplete = React.useCallback(async () => {
    const valid = await validateCurrentStep()
    if (!valid) return

    if (!widget.onComplete) {
      onClose?.()
      return
    }

    setCompleting(true)
    setErrorMessage(null)

    try {
      await widget.onComplete(allData, context)
      onClose?.()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t('ui.wizard.completeFailed', 'Failed to complete'))
    } finally {
      setCompleting(false)
    }
  }, [validateCurrentStep, widget, allData, context, onClose, t])

  // Handle Escape to cancel
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!currentStep) return null

  const stepLabel = t(currentStep.label, currentStep.label)
  const stepDescription = currentStep.description ? t(currentStep.description, currentStep.description) : undefined
  const title = widget.metadata.title ? t(widget.metadata.title, widget.metadata.title) : undefined

  return (
    <div className="space-y-6">
      {title && <h2 className="text-lg font-semibold">{title}</h2>}

      <StepIndicator steps={steps} currentIndex={currentStepIndex} />

      <div className="space-y-4">
        <div>
          <h3 className="text-base font-medium">{stepLabel}</h3>
          {stepDescription && (
            <p className="mt-1 text-sm text-muted-foreground">{stepDescription}</p>
          )}
        </div>

        {currentStep.fields && currentStep.fields.length > 0 && (
          <StepFieldsRenderer
            step={currentStep}
            data={allData}
            onChange={handleFieldChange}
            context={context}
            fieldErrors={fieldErrors}
          />
        )}

        {currentStep.customComponent && (
          <React.Suspense fallback={<Spinner size="sm" />}>
            <currentStep.customComponent
              data={allData}
              setData={handleSetData}
              context={context}
            />
          </React.Suspense>
        )}

        {errorMessage && (
          <p className="text-sm text-destructive" role="alert">{errorMessage}</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <div>
          {!isFirstStep && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={validating || completing}
            >
              {t('ui.wizard.back', 'Back')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={completing}
            >
              {t('ui.wizard.cancel', 'Cancel')}
            </Button>
          )}
          {isLastStep ? (
            <Button
              type="button"
              onClick={handleComplete}
              disabled={validating || completing}
            >
              {completing ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t('ui.wizard.completing', 'Completing...')}
                </>
              ) : (
                t('ui.wizard.complete', 'Complete')
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleNext}
              disabled={validating || completing}
            >
              {validating ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t('ui.wizard.validating', 'Validating...')}
                </>
              ) : (
                t('ui.wizard.next', 'Next')
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default InjectionWizard
