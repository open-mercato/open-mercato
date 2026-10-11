"use client"

import * as React from 'react'
import { FlaskConical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { Button } from '@open-mercato/ui/primitives/button'
import { readContextId } from '../../../lib/client/context'
import { ROLE_ACL_PREVIEW_SIMULATION_KIND } from '../../../lib/client/simulation/api'
import { useSimulationCapabilities } from '../../../lib/client/simulation/hooks'
import { rememberPendingSimulationRun } from '../../../lib/client/simulation/pendingDecisions'
import { buildRoleAclProposal, type RoleAclEditorValues } from '../../../lib/client/simulation/roleAclPreview'
import { SimulationRequestDialog } from '../../../components/simulation/SimulationRequestDialog'

export type RoleAclSimulateContext = {
  formId?: unknown
  recordId?: unknown
}

/**
 * "Simulate impact" on the role editor's Access section (`auth.role.acl:toolbar`): submits the
 * CURRENT, unsaved ACL of the role as a role permission preview (computed at once from the current
 * users, roles and API keys) and shows who would gain or lose access in a dialog. Shown only when
 * the viewer may run the preview here. A preview completed in this editor session is remembered for
 * the role save to record the `applied` decision (`role-acl-simulation-apply`).
 */
export default function RoleAclSimulateWidget({ context, data, disabled }: InjectionWidgetComponentProps<RoleAclSimulateContext, RoleAclEditorValues>) {
  const t = useT()
  const capabilities = useSimulationCapabilities()
  const [open, setOpen] = React.useState(false)
  const dataRef = React.useRef<RoleAclEditorValues | undefined>(data)
  React.useEffect(() => {
    dataRef.current = data
  })
  const formId = readContextId(context, 'formId')
  const recordId = readContextId(context, 'recordId')
  const buildProposal = React.useCallback(() => buildRoleAclProposal(dataRef.current ?? {}), [])
  const handleCompleted = React.useCallback((runId: string) => {
    if (formId) rememberPendingSimulationRun(formId, { runId, recordId, source: 'dialog' })
  }, [formId, recordId])
  const kind = capabilities.data?.canRun
    ? capabilities.data.kinds.find((candidate) => candidate.kind === ROLE_ACL_PREVIEW_SIMULATION_KIND) ?? null
    : null
  if (!capabilities.data || !kind || !recordId) return null
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid="role-acl-simulate-open"
      >
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
        contextId={`insights-simulation:role-acl:${formId ?? 'editor'}`}
        title={t('insights.simulation.ui.roleAclSimulate.title')}
        description={t('insights.simulation.ui.roleAclSimulate.description')}
        decisionHint={t('insights.simulation.ui.roleAclSimulate.decisionHint')}
        execution={kind.execution}
        onCompleted={handleCompleted}
      />
    </div>
  )
}
