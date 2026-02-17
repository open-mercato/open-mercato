'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { NODE_TYPE_ICONS, stepTypeToNodeType } from '../../lib/node-type-icons'
import { Circle, Pencil, Trash2, ArrowRight, Plus } from 'lucide-react'
import type { WorkflowDefinitionFormValues } from '../formConfig'

interface WorkflowStep {
  stepId: string
  stepName: string
  stepType?: string
  type?: string
}

interface WorkflowTransition {
  transitionId: string
  fromStepId: string
  toStepId: string
  trigger?: string
}

interface MobileDefinitionDetailProps {
  values: WorkflowDefinitionFormValues
  onEditStep: (index: number) => void
  onDeleteStep: (index: number) => void
  onAddStep: () => void
  onEditTransition: (index: number) => void
  onDeleteTransition: (index: number) => void
  onAddTransition: () => void
}

export function MobileDefinitionDetail({
  values,
  onEditStep,
  onDeleteStep,
  onAddStep,
  onEditTransition,
  onDeleteTransition,
  onAddTransition,
}: MobileDefinitionDetailProps) {
  const t = useT()
  const steps = values.steps || []
  const transitions = values.transitions || []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('workflows.form.stepsLabel', 'Steps')} ({steps.length})</h2>
          <Button variant="outline" size="sm" onClick={onAddStep} className="h-8 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('workflows.mobile.addStep', 'Add Step')}
          </Button>
        </div>

        {steps.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('workflows.mobile.noSteps', 'No steps defined yet.')}
          </p>
        ) : (
          <div className="space-y-2">
            {steps.map((step: WorkflowStep, idx: number) => {
              const nodeType = stepTypeToNodeType(step.stepType || step.type || '')
              const Icon = NODE_TYPE_ICONS[nodeType] || Circle
              return (
                <div
                  key={step.stepId || idx}
                  className="flex items-center gap-3 rounded-lg border bg-background p-3"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{step.stepName || step.stepId}</div>
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {step.stepType || step.type || 'unknown'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => onEditStep(idx)}
                      className="rounded p-1.5 hover:bg-muted"
                      aria-label={t('workflows.mobile.editStep')}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => onDeleteStep(idx)}
                      className="rounded p-1.5 hover:bg-muted"
                      aria-label={t('workflows.mobile.deleteStep')}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('workflows.form.transitionsLabel', 'Transitions')} ({transitions.length})</h2>
          <Button variant="outline" size="sm" onClick={onAddTransition} className="h-8 text-xs">
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('workflows.mobile.addTransition', 'Add Transition')}
          </Button>
        </div>

        {transitions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('workflows.mobile.noTransitions', 'No transitions defined yet.')}
          </p>
        ) : (
          <div className="space-y-2">
            {transitions.map((transition: WorkflowTransition, idx: number) => (
              <div
                key={transition.transitionId || idx}
                className="flex items-center gap-3 rounded-lg border bg-background p-3"
              >
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="truncate font-mono text-xs">{transition.fromStepId}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono text-xs">{transition.toStepId}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {transition.trigger || 'auto'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => onEditTransition(idx)}
                    className="rounded p-1.5 hover:bg-muted"
                    aria-label={t('workflows.mobile.editTransition')}
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => onDeleteTransition(idx)}
                    className="rounded p-1.5 hover:bg-muted"
                    aria-label={t('workflows.mobile.deleteTransition')}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
