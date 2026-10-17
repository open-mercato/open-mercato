"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readContextId } from '../../../lib/client/context'
import { priceBacktestProposalToFormValues, type PriceFormValues } from '../../../lib/client/simulation/priceBacktest'
import { SimulationApplyBanner } from '../../../components/simulation/SimulationApplyBanner'

export type PriceSimulationApplyContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * Applies a price backtest in the catalog price row edit form (`crud-form:catalog.catalog_product_price`):
 * the banner of `SimulationApplyBanner` (a linked run can load its simulated amounts into the form);
 * the form's own optimistic-lock save dispatches `onAfterSave`, which records the `applied` decision
 * the server then verifies against the saved row.
 */
export default function PriceSimulationApplyWidget({
  context,
  data,
  onDataChange,
}: InjectionWidgetComponentProps<PriceSimulationApplyContext, PriceFormValues>) {
  return (
    <SimulationApplyBanner
      formId={readContextId(context, 'formId')}
      recordId={readContextId(context, 'recordId')}
      data={data}
      onDataChange={onDataChange}
      proposalToValues={priceBacktestProposalToFormValues}
      descriptionKey="insights.simulation.ui.priceApply.description"
      loadedKey="insights.simulation.ui.priceApply.loaded"
      testId="price-simulation-apply"
      loadTestId="price-simulation-load-proposal"
    />
  )
}
