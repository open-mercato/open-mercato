"use client"

import * as React from 'react'
import { Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
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
  buttonVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'muted' | 'link'
  buttonSize?: 'default' | 'sm' | 'lg' | 'icon'
  buttonClassName?: string
  buttonLabel?: string
  viewHref?: string | null
  onSuccess?: MessageComposerProps['onSuccess']
}

export function SendObjectMessageDialog({
  object,
  defaultValues,
  lockedType = 'messages.defaultWithObjects',
  requiredActionConfig = null,
  disabled = false,
  buttonVariant = 'ghost',
  buttonSize = 'icon',
  buttonClassName,
  buttonLabel,
  viewHref: _viewHref = null,
  onSuccess,
}: SendObjectMessageDialogProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const label = buttonLabel ?? t('messages.compose', 'Compose message')

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

  const trigger = buttonSize === 'icon' && (buttonVariant === 'outline' || buttonVariant === 'ghost')
    ? (
      <IconButton
        type="button"
        size="default"
        variant={buttonVariant}
        className={buttonClassName}
        disabled={disabled}
        onClick={openComposer}
        aria-label={label}
        title={label}
      >
        <Send className="size-4" />
      </IconButton>
    )
    : (
      <Button
        type="button"
        size={buttonSize}
        variant={buttonVariant}
        className={buttonClassName}
        disabled={disabled}
        onClick={openComposer}
        aria-label={label}
        title={label}
      >
        <Send className="size-4" />
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
        contextObject={contextObject}
        requiredActionConfig={requiredActionConfig}
        defaultValues={defaultValues}
        onSuccess={onSuccess}
      />
    </>
  )
}
