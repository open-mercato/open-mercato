"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readContextId } from '../../../lib/client/context'
import { triggerBacktestProposalToEditorChange, type WorkflowEditorValues } from '../../../lib/client/simulation/triggerBacktest'
import { SimulationApplyBanner } from '../../../components/simulation/SimulationApplyBanner'

export type WorkflowSimulationApplyContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * Applies a trigger backtest in the workflow definition editor (`workflows.definition.editor:banner`):
 * the banner of `SimulationApplyBanner` (a linked run can load its triggers, enabled flag and version
 * into the editor); the editor's own optimistic-lock Save dispatches `onAfterSave`, which records the
 * `applied` decision the server then verifies.
 */
export default function WorkflowSimulationApplyWidget({
  context,
  data,
  onDataChange,
}: InjectionWidgetComponentProps<WorkflowSimulationApplyContext, WorkflowEditorValues>) {
  return (
    <SimulationApplyBanner
      formId={readContextId(context, 'formId')}
      recordId={readContextId(context, 'recordId')}
      data={data}
      onDataChange={onDataChange}
      proposalToValues={triggerBacktestProposalToEditorChange}
      descriptionKey="insights.simulation.ui.workflowApply.description"
      loadedKey="insights.simulation.ui.workflowApply.loaded"
      testId="workflow-simulation-apply"
      loadTestId="workflow-simulation-load-proposal"
      className="shrink-0 border-b border-border bg-background px-3 py-2 md:px-6 md:py-3"
    />
  )
}
