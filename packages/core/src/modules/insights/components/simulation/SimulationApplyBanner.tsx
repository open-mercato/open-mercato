"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { SIMULATION_RUN_ID_QUERY_PARAM, isSimulationRunId } from '../../lib/client/simulation/api'
import { setSimulationDecisionTranslator } from '../../lib/client/simulation/applyDecision'
import { describeSimulationError } from '../../lib/client/simulation/format'
import { fetchSimulationRun } from '../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun, usePendingSimulationDecision } from '../../lib/client/simulation/pendingDecisions'

export function readSimulationRunIdFromLocation(search: string | null | undefined): string | null {
  if (!search) return null
  const value = new URLSearchParams(search).get(SIMULATION_RUN_ID_QUERY_PARAM)
  return isSimulationRunId(value) ? value.toLowerCase() : null
}

/** A linked run applies only to the artifact it simulated (both unsaved, or the same id). */
function isSameArtifact(runArtifactId: string | null | undefined, recordId: string | null): boolean {
  const left = typeof runArtifactId === 'string' && runArtifactId.length > 0 ? runArtifactId.toLowerCase() : null
  const right = recordId ? recordId.toLowerCase() : null
  return left === right
}

export type SimulationApplyBannerProps = {
  formId: string | null
  recordId: string | null
  data: Record<string, unknown> | undefined
  onDataChange?: (data: Record<string, unknown>) => void
  /** The owning editor's values of a simulated proposal (merged into `data`), or null when it is not one. */
  proposalToValues: (proposal: unknown) => Record<string, unknown> | null
  descriptionKey: string
  loadedKey: string
  testId: string
  loadTestId: string
  className?: string
}

/**
 * Applies a simulation in the owning editor: when a run completed in this editor session, or the
 * result page linked here with `?simulationRunId=`, a banner says that saving records the
 * decision; for a linked run the simulated proposal can be loaded into the editor (only when the run
 * simulated this same artifact, or both are unsaved). The decision is
 * recorded by the widget's `onAfterSave` handler after the editor's own (optimistic-lock) save; the
 * server verifies whether what was saved matches the simulation.
 */
export function SimulationApplyBanner({
  formId,
  recordId,
  data,
  onDataChange,
  proposalToValues,
  descriptionKey,
  loadedKey,
  testId,
  loadTestId,
  className,
}: SimulationApplyBannerProps) {
  const t = useT()
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
      const values = isSameArtifact(result.body.artifactId, recordId) ? proposalToValues(result.body.proposal) : null
      if (!values || !onDataChange) {
        flash(t('insights.simulation.ui.apply.loadFailed'), 'error')
        return
      }
      onDataChange({ ...(data ?? {}), ...values })
      flash(t(loadedKey), 'success')
    } finally {
      setLoading(false)
    }
  }, [data, loadedKey, loading, onDataChange, pending, proposalToValues, t])

  if (!pending) return null
  const banner = (
    <Alert status="information" size="default" data-testid={testId}>
      <AlertTitle>{t('insights.simulation.ui.apply.title')}</AlertTitle>
      <AlertDescription>
        <span className="block">{t(descriptionKey)}</span>
        {pending.source === 'link' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => { void loadProposal() }}
            disabled={loading}
            data-testid={loadTestId}
          >
            {t('insights.simulation.ui.apply.loadProposal')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
  return className ? <div className={className}>{banner}</div> : banner
}
