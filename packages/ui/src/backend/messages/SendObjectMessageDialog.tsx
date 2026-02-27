"use client"

import * as React from 'react'
import { Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import {
  MessageComposer,
  type MessageComposerContextObject,
  type MessageComposerProps,
  type MessageComposerRequiredActionConfig,
} from './MessageComposer'

export type SendObjectMessageDialogProps = {
  object: MessageComposerContextObject
  defaultValues?: MessageComposerProps['defaultValues']
  lockedType?: string | null
  requiredActionConfig?: MessageComposerRequiredActionConfig | null
  disabled?: boolean
  viewHref?: string | null
  onSuccess?: MessageComposerProps['onSuccess']
}

export function SendObjectMessageDialog({
  object,
  defaultValues,
  lockedType = 'messages.defaultWithObjects',
  requiredActionConfig = null,
  disabled = false,
  viewHref: _viewHref = null,
  onSuccess,
}: SendObjectMessageDialogProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const openComposer = React.useCallback(() => {
    if (disabled) return
    setOpen(true)
  }, [disabled])
  const contextObject = React.useMemo(() => ({
    entityModule: object.entityModule,
    entityType: object.entityType,
    entityId: object.entityId,
    sourceEntityType: object.sourceEntityType ?? null,
    sourceEntityId: object.sourceEntityId ?? null,
    previewData: object.previewData ?? null,
  }), [object.entityId, object.entityModule, object.entityType, object.sourceEntityId, object.sourceEntityType, object.previewData])

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        onClick={openComposer}
        aria-label={t('messages.compose', 'Compose message')}
        title={t('messages.compose', 'Compose message')}
      >
        <Send className="h-4 w-4" />
      </Button>
      <MessageComposer
        variant="compose"
        open={open}
        onOpenChange={setOpen}
        lockedType={lockedType}
        contextObject={contextObject}
        requiredActionConfig={requiredActionConfig}
        defaultValues={defaultValues}
        onSuccess={onSuccess}
      />
    </>
  )
}
