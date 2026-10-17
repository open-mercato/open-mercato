"use client"

import * as React from 'react'
import { FlaskConical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { readContextId } from '../../../lib/client/context'
import { useSimulationCapabilities } from '../../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun } from '../../../lib/client/simulation/pendingDecisions'
import {
  PRICE_BACKTEST_SIMULATION_KIND,
  buildPriceBacktestProposal,
  type PriceFormValues,
} from '../../../lib/client/simulation/priceBacktest'
import { SimulationRequestDialog } from '../../../components/simulation/SimulationRequestDialog'

export type PriceSimulateContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * "Simulate impact" on the catalog price row edit form header (`crud-form:catalog.catalog_product_price:header`):
 * submits the CURRENT, unsaved amount of the row as a price backtest (the amount the row's save
 * will store: net when it is filled in, else gross) and follows the run in a dialog. Shown only
 * for a saved row and when the viewer may run the price backtest. A completed run is remembered
 * for the form's save to record the `applied` decision (`price-simulation-apply`).
 */
export default function PriceSimulateWidget({ context, data, disabled }: InjectionWidgetComponentProps<PriceSimulateContext, PriceFormValues>) {
  const t = useT()
  const capabilities = useSimulationCapabilities()
  const [open, setOpen] = React.useState(false)
  const dataRef = React.useRef<PriceFormValues | undefined>(data)
  React.useEffect(() => {
    dataRef.current = data
  })
  const formId = readContextId(context, 'formId')
  const recordId = readContextId(context, 'recordId')
  const buildProposal = React.useCallback(
    () => buildPriceBacktestProposal(dataRef.current ?? {}, recordId),
    [recordId],
  )
  const handleCompleted = React.useCallback((runId: string) => {
    if (formId) rememberPendingSimulationRun(formId, { runId, recordId, source: 'dialog' })
  }, [formId, recordId])
  const kind = capabilities.data?.canRun
    ? capabilities.data.kinds.find((candidate) => candidate.kind === PRICE_BACKTEST_SIMULATION_KIND) ?? null
    : null
  if (!capabilities.data || !kind || !recordId) return null
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled} data-testid="price-simulate-open">
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
        contextId={`insights-simulation:price:${formId ?? 'form'}`}
        title={t('insights.simulation.ui.priceSimulate.title')}
        description={t('insights.simulation.ui.priceSimulate.description')}
        decisionHint={t('insights.simulation.ui.priceSimulate.decisionHint')}
        onCompleted={handleCompleted}
      />
    </>
  )
}
