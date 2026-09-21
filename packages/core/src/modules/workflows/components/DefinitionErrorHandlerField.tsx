'use client'

import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowErrorHandlerConfig } from '../data/validators'

export type DefinitionErrorHandlerFieldProps = {
  value: WorkflowErrorHandlerConfig | null | undefined
  onChange: (next: WorkflowErrorHandlerConfig | null) => void
  stepOptions: Array<{ stepId: string; label: string }>
}

const NONE_MODE = 'none'
const STEP_MODE = 'step'
const WORKFLOW_MODE = 'workflow'

function readMode(value: WorkflowErrorHandlerConfig | null | undefined): string {
  if (value?.stepId) return STEP_MODE
  if (value?.workflowId) return WORKFLOW_MODE
  return NONE_MODE
}

/**
 * Definition-level catch-all error handler (spec 5.9). Exactly one form is
 * declared at a time; clearing it back to "none" removes the key so the saved
 * definition is identical to one that never used the picker.
 */
export function DefinitionErrorHandlerField({
  value,
  onChange,
  stepOptions,
}: DefinitionErrorHandlerFieldProps) {
  const t = useT()
  const mode = readMode(value)

  const handleModeChange = (next: string) => {
    if (next === STEP_MODE) {
      onChange({ stepId: stepOptions[0]?.stepId ?? '' })
      return
    }
    if (next === WORKFLOW_MODE) {
      onChange({ workflowId: '' })
      return
    }
    onChange(null)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="error-handler-mode" className="text-xs">
            {t('workflows.visualEditor.errorHandler.label', 'On unhandled failure')}
          </Label>
          <Select value={mode} onValueChange={handleModeChange}>
            <SelectTrigger
              id="error-handler-mode"
              aria-label={t('workflows.visualEditor.errorHandler.label', 'On unhandled failure')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_MODE}>
                {t('workflows.visualEditor.errorHandler.none', 'Fail the instance (default)')}
              </SelectItem>
              <SelectItem value={STEP_MODE}>
                {t('workflows.visualEditor.errorHandler.step', 'Go to a handler step')}
              </SelectItem>
              <SelectItem value={WORKFLOW_MODE}>
                {t('workflows.visualEditor.errorHandler.workflow', 'Run a handler workflow')}
              </SelectItem>
            </SelectContent>
          </Select>
      </div>

      {mode === STEP_MODE ? (
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="error-handler-step" className="text-xs">
            {t('workflows.visualEditor.errorHandler.stepLabel', 'Handler step')}
          </Label>
          <Select
            value={value?.stepId ?? ''}
            onValueChange={(stepId) => onChange({ stepId })}
          >
            <SelectTrigger
              id="error-handler-step"
              aria-label={t('workflows.visualEditor.errorHandler.stepLabel', 'Handler step')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stepOptions.map((step) => (
                <SelectItem key={step.stepId} value={step.stepId}>
                  {step.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {mode === WORKFLOW_MODE ? (
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="error-handler-workflow" className="text-xs">
            {t('workflows.visualEditor.errorHandler.workflowLabel', 'Handler workflow id')}
          </Label>
          <Input
            id="error-handler-workflow"
            value={value?.workflowId ?? ''}
            placeholder={t('workflows.visualEditor.errorHandler.workflowPlaceholder', 'order-failure-handler')}
            onChange={(event) => onChange({ workflowId: event.target.value, version: value?.version })}
          />
        </div>
      ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {t(
          'workflows.visualEditor.errorHandler.help',
          'Catch-all for failures no error route and no step directive handled. A handler step keeps the run going in place; a handler workflow starts separately with the failed step, the error and a context snapshot.',
        )}
      </p>
    </div>
  )
}
