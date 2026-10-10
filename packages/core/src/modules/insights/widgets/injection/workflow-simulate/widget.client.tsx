"use client"

import * as React from 'react'
import { FlaskConical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { readContextId } from '../../../lib/client/context'
import { TRIGGER_BACKTEST_SIMULATION_KIND } from '../../../lib/client/simulation/api'
import { useSimulationCapabilities } from '../../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun } from '../../../lib/client/simulation/pendingDecisions'
import { buildTriggerBacktestProposal, type WorkflowEditorValues } from '../../../lib/client/simulation/triggerBacktest'
import { SimulationRequestDialog } from '../../../components/simulation/SimulationRequestDialog'

export type WorkflowSimulateContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * "Simulate impact" in the workflow definition editor toolbar (`workflows.definition.editor:toolbar`):
 * submits the CURRENT, unsaved triggers of the definition as a trigger backtest and follows the run
 * in a dialog. Shown only when the viewer may run the trigger backtest here. The dialog stays
 * mounted while closed, so a run keeps being followed and, once completed in this editor session,
 * is remembered for the editor's save to record the `applied` decision
 * (`workflow-simulation-apply`).
 */
export default function WorkflowSimulateWidget({ context, data, disabled }: InjectionWidgetComponentProps<WorkflowSimulateContext, WorkflowEditorValues>) {
  const t = useT()
  const capabilities = useSimulationCapabilities()
  const [open, setOpen] = React.useState(false)
  const dataRef = React.useRef<WorkflowEditorValues | undefined>(data)
  React.useEffect(() => {
    dataRef.current = data
  })
  const formId = readContextId(context, 'formId')
  const recordId = readContextId(context, 'recordId')
  const buildProposal = React.useCallback(() => buildTriggerBacktestProposal(dataRef.current ?? {}), [])
  const handleCompleted = React.useCallback((runId: string) => {
    if (formId) rememberPendingSimulationRun(formId, { runId, recordId, source: 'dialog' })
  }, [formId, recordId])
  const kind = capabilities.data?.canRun
    ? capabilities.data.kinds.find((candidate) => candidate.kind === TRIGGER_BACKTEST_SIMULATION_KIND) ?? null
    : null
  if (!capabilities.data || !kind) return null
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="workflow-simulate-open"
      >
        <FlaskConical className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {t('insights.simulation.ui.simulate.button')}
      </Button>
      <SimulationRequestDialog
        open={open}
        onOpenChange={setOpen}
        kind={kind.kind}
        artifactId={recordId}
        limits={capabilities.data.limits}
        buildProposal={buildProposal}
        contextId={`insights-simulation:workflow:${formId ?? 'editor'}`}
        title={t('insights.simulation.ui.workflowSimulate.title')}
        description={t('insights.simulation.ui.workflowSimulate.description')}
        decisionHint={t('insights.simulation.ui.workflowSimulate.decisionHint')}
        onCompleted={handleCompleted}
      />
    </>
  )
}
