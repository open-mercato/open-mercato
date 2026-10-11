"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { readContextId } from '../../../lib/client/context'
import { roleAclProposalToValues, type RoleAclEditorValues } from '../../../lib/client/simulation/roleAclPreview'
import { SimulationApplyBanner } from '../../../components/simulation/SimulationApplyBanner'

export type RoleAclSimulationApplyContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * Applies a role permission preview in the role editor (`auth.role.acl:banner`): the banner of
 * `SimulationApplyBanner` (a linked run can load its permissions into the ACL editor); the role
 * editor's own save (optimistic lock, or the fingerprint check when the ACL has no `updatedAt`)
 * dispatches `onAfterSave`, which records the `applied` decision the server then verifies.
 */
export default function RoleAclSimulationApplyWidget({
  context,
  data,
  onDataChange,
}: InjectionWidgetComponentProps<RoleAclSimulationApplyContext, RoleAclEditorValues>) {
  const recordId = readContextId(context, 'recordId')
  const proposalToValues = React.useCallback((proposal: unknown) => roleAclProposalToValues(proposal, recordId), [recordId])
  return (
    <SimulationApplyBanner
      formId={readContextId(context, 'formId')}
      recordId={recordId}
      data={data}
      onDataChange={onDataChange}
      proposalToValues={proposalToValues}
      descriptionKey="insights.simulation.ui.roleAclApply.description"
      loadedKey="insights.simulation.ui.roleAclApply.loaded"
      testId="role-acl-simulation-apply"
      loadTestId="role-acl-simulation-load-proposal"
    />
  )
}
