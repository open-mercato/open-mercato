"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readContextId } from '../../../lib/client/context'
import { ruleProposalToFormValues, type RuleFormValues } from '../../../lib/client/simulation/ruleBacktest'
import { SimulationApplyBanner } from '../../../components/simulation/SimulationApplyBanner'

export { readSimulationRunIdFromLocation } from '../../../components/simulation/SimulationApplyBanner'

export type RuleSimulationApplyContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * Applies a rule simulation in the business rule editor (`crud-form:business_rules.rule`): the
 * banner of `SimulationApplyBanner`; the decision is recorded by the module's `onAfterSave` handler
 * after the form's own (optimistic-lock) save.
 */
export default function RuleSimulationApplyWidget({
  context,
  data,
  onDataChange,
}: InjectionWidgetComponentProps<RuleSimulationApplyContext, RuleFormValues>) {
  return (
    <SimulationApplyBanner
      formId={readContextId(context, 'formId')}
      recordId={readContextId(context, 'recordId')}
      data={data}
      onDataChange={onDataChange}
      proposalToValues={ruleProposalToFormValues}
      descriptionKey="insights.simulation.ui.apply.description"
      loadedKey="insights.simulation.ui.apply.loaded"
      testId="rule-simulation-apply"
      loadTestId="rule-simulation-load-proposal"
    />
  )
}
