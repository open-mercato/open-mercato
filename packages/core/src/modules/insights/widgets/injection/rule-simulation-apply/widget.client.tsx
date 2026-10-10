"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { readContextId } from '../../../lib/client/context'
import { SIMULATION_RUN_ID_QUERY_PARAM, isSimulationRunId } from '../../../lib/client/simulation/api'
import { setSimulationDecisionTranslator } from '../../../lib/client/simulation/applyDecision'
import { describeSimulationError } from '../../../lib/client/simulation/format'
import { fetchSimulationRun } from '../../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun, usePendingSimulationDecision } from '../../../lib/client/simulation/pendingDecisions'
import { ruleProposalToFormValues, type RuleFormValues } from '../../../lib/client/simulation/ruleBacktest'

export type RuleSimulationApplyContext = {
  formId?: unknown
  recordId?: unknown
}

export function readSimulationRunIdFromLocation(search: string | null | undefined): string | null {
  if (!search) return null
  const value = new URLSearchParams(search).get(SIMULATION_RUN_ID_QUERY_PARAM)
  return isSimulationRunId(value) ? value.toLowerCase() : null
}

/**
 * Applies a simulation in the owning editor: when a run completed in this form session, or the
 * result page linked here with `?simulationRunId=`, a banner says that saving records the
 * decision; for a linked run the simulated proposal can be loaded into the form. The decision is
 * recorded by the module's `onAfterSave` handler after the form's own (optimistic-lock) save; the
 * server verifies whether what was saved matches the simulation.
 */
export default function RuleSimulationApplyWidget({
  context,
  data,
  onDataChange,
}: InjectionWidgetComponentProps<RuleSimulationApplyContext, RuleFormValues>) {
  const t = useT()
  const formId = readContextId(context, 'formId')
  const recordId = readContextId(context, 'recordId')
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    setSimulationDecisionTranslator(t)
    return () => setSimulationDecisionTranslator(null)
  }, [t])

  React.useEffect(() => {
    if (!formId || typeof window === 'undefined') return
    const linkedRunId = readSimulationRunIdFromLocation(window.location.search)
    if (linkedRunId) rememberPendingSimulationRun(formId, { runId: linkedRunId, recordId, source: 'link' })
  }, [formId, recordId])

  const pending = usePendingSimulationDecision(formId, recordId)

  const loadProposal = React.useCallback(async () => {
    if (!pending || loading) return
    setLoading(true)
    try {
      const result = await fetchSimulationRun(pending.runId)
      if (!result.ok) {
        flash(describeSimulationError(result.error, t, 'insights.simulation.ui.apply.loadFailed'), 'error')
        return
      }
      const values = ruleProposalToFormValues(result.body.proposal)
      if (!values || !onDataChange) {
        flash(t('insights.simulation.ui.apply.loadFailed'), 'error')
        return
      }
      onDataChange({ ...(data ?? {}), ...values })
      flash(t('insights.simulation.ui.apply.loaded'), 'success')
    } finally {
      setLoading(false)
    }
  }, [data, loading, onDataChange, pending, t])

  if (!pending) return null
  return (
    <Alert status="information" size="default" data-testid="rule-simulation-apply">
      <AlertTitle>{t('insights.simulation.ui.apply.title')}</AlertTitle>
      <AlertDescription>
        <span className="block">{t('insights.simulation.ui.apply.description')}</span>
        {pending.source === 'link' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => { void loadProposal() }}
            disabled={loading}
            data-testid="rule-simulation-load-proposal"
          >
            {t('insights.simulation.ui.apply.loadProposal')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
