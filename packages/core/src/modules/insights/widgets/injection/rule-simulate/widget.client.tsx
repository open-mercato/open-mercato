"use client"

import * as React from 'react'
import { FlaskConical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { readContextId } from '../../../lib/client/context'
import { RULE_BACKTEST_SIMULATION_KIND } from '../../../lib/client/simulation/api'
import { useSimulationCapabilities } from '../../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun } from '../../../lib/client/simulation/pendingDecisions'
import { buildRuleBacktestProposal, type RuleFormValues } from '../../../lib/client/simulation/ruleBacktest'
import { SimulationRequestDialog } from '../../../components/simulation/SimulationRequestDialog'

export type RuleSimulateContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * "Simulate impact" on the business rule editor header: submits the CURRENT, unsaved rule
 * definition as a rule backtest and follows the run in a dialog. Shown only when the viewer may
 * run the rule backtest here. The dialog stays mounted while closed, so a run keeps being followed
 * and, once completed in this form session, is remembered for the form's save to record the
 * `applied` decision (`rule-simulation-apply`).
 */
export default function RuleSimulateWidget({ context, data }: InjectionWidgetComponentProps<RuleSimulateContext, RuleFormValues>) {
  const t = useT()
  const capabilities = useSimulationCapabilities()
  const [open, setOpen] = React.useState(false)
  const dataRef = React.useRef<RuleFormValues | undefined>(data)
  React.useEffect(() => {
    dataRef.current = data
  })
  const formId = readContextId(context, 'formId')
  const recordId = readContextId(context, 'recordId')
  const buildProposal = React.useCallback(() => buildRuleBacktestProposal(dataRef.current ?? {}), [])
  const handleCompleted = React.useCallback((runId: string) => {
    if (formId) rememberPendingSimulationRun(formId, { runId, recordId, source: 'dialog' })
  }, [formId, recordId])
  const kind = capabilities.data?.canRun
    ? capabilities.data.kinds.find((candidate) => candidate.kind === RULE_BACKTEST_SIMULATION_KIND) ?? null
    : null
  if (!capabilities.data || !kind) return null
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="rule-simulate-open">
        <FlaskConical className="size-4" aria-hidden="true" />
        {t('insights.simulation.ui.simulate.button')}
      </Button>
      <SimulationRequestDialog
        open={open}
        onOpenChange={setOpen}
        kind={kind.kind}
        artifactId={recordId}
        limits={capabilities.data.limits}
        buildProposal={buildProposal}
        contextId={`insights-simulation:rule:${formId ?? 'form'}`}
        title={t('insights.simulation.ui.simulate.title')}
        description={t('insights.simulation.ui.simulate.description')}
        onCompleted={handleCompleted}
      />
    </>
  )
}
