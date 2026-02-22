"use client"

import * as React from 'react'
import { Leaf } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import {
  MessageComposer,
  type MessageComposerContextObject,
  type MessageComposerProps,
  type MessageComposerRequiredActionConfig,
} from './MessageComposer'

export type SendEntityMessageDialogProps = {
  entity: MessageComposerContextObject
  defaultValues?: MessageComposerProps['defaultValues']
  lockedType?: string | null
  requiredActionConfig?: MessageComposerRequiredActionConfig | null
  disabled?: boolean
  contextPreview?: React.ReactNode
  children?: React.ReactNode
  onSuccess?: MessageComposerProps['onSuccess']
  renderTrigger?: (params: { openComposer: () => void; disabled: boolean }) => React.ReactNode
}

export function SendEntityMessageDialog({
  entity,
  defaultValues,
  lockedType = null,
  requiredActionConfig = null,
  disabled = false,
  contextPreview = null,
  children = null,
  onSuccess,
  renderTrigger,
}: SendEntityMessageDialogProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const openComposer = React.useCallback(() => {
    if (disabled) return
    setOpen(true)
  }, [disabled])

  const trigger = renderTrigger
    ? renderTrigger({ openComposer, disabled })
    : (
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled={disabled}
        onClick={openComposer}
        aria-label={t('messages.compose', 'Compose message')}
        title={t('messages.compose', 'Compose message')}
      >
        <Leaf className="h-4 w-4" />
      </Button>
    )

  return (
    <>
      {trigger}
      <MessageComposer
        variant="compose"
        open={open}
        onOpenChange={setOpen}
        lockedType={lockedType}
        contextObject={entity}
        requiredActionConfig={requiredActionConfig}
        contextPreview={contextPreview ?? children}
        defaultValues={defaultValues}
        onSuccess={onSuccess}
      />
    </>
  )
}
