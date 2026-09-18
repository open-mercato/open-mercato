'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { WorkflowSelector } from '@open-mercato/core/modules/workflows/components/WorkflowSelector'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'

export function WorkflowPickerField({ id, value, setValue, disabled, error, resolveLabel }: CrudCustomFieldRenderProps & {
  resolveLabel: (value: string) => Promise<string>
}) {
  const t = useT()
  const workflowId = typeof value === 'string' ? value : ''
  const [open, setOpen] = React.useState(false)
  const [label, setLabel] = React.useState(workflowId)

  React.useEffect(() => {
    let cancelled = false
    setLabel(workflowId)
    if (workflowId) {
      void resolveLabel(workflowId).then((resolved) => {
        if (!cancelled) setLabel(resolved)
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [workflowId, resolveLabel])

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-auto min-h-9 min-w-0 flex-1 justify-start whitespace-normal py-2 text-left"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{workflowId ? label : t('workflows.fieldEditors.workflowSelector.browseWorkflows')}</span>
        </Button>
        {workflowId ? <IconButton type="button" variant="ghost" disabled={disabled} aria-label={t('workflows.common.clear')} onClick={() => setValue('')}><X /></IconButton> : null}
      </div>
      <WorkflowSelector
        isOpen={open && !disabled}
        onClose={() => setOpen(false)}
        title={t('workflows.selectors.workflow.title')}
        description={t('agent_orchestrator.processDefinitions.form.workflowHint')}
        onlyEnabled={false}
        onSelect={(nextId, workflow) => {
          setLabel(`${workflow.workflowName} (${nextId})`)
          setValue(nextId)
          setOpen(false)
        }}
      />
    </div>
  )
}
