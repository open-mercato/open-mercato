"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { XRAY_WORKFLOW_ID_PATTERN } from '../../lib/client/xray/draft'

export type XrayWorkflowIdFieldProps = {
  initialValue: string
  disabled?: boolean
  onApply: (workflowId: string) => void
}

/** Another workflow id for a draft whose generated id is taken; the draft is validated again with it. */
export function XrayWorkflowIdField({ initialValue, disabled = false, onApply }: XrayWorkflowIdFieldProps) {
  const t = useT()
  const [value, setValue] = React.useState(initialValue)
  const valid = XRAY_WORKFLOW_ID_PATTERN.test(value)
  return (
    <div className="flex flex-wrap items-end gap-2">
      <FormField
        className="min-w-0 flex-1"
        label={t('insights.xray.ui.draft.workflowId')}
        description={t('insights.xray.ui.draft.workflowIdHelp')}
        error={valid ? undefined : t('insights.xray.ui.draft.workflowIdInvalid')}
        disabled={disabled}
      >
        <Input value={value} onChange={(event) => setValue(event.target.value.trim().toLowerCase())} />
      </FormField>
      <Button type="button" variant="outline" disabled={disabled || !valid} onClick={() => onApply(value)}>
        {t('insights.xray.ui.draft.checkAgain')}
      </Button>
    </div>
  )
}
