"use client"

import type { MessageActionsProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

export function MessageConfirmationActions({
  message,
  onExecuteAction,
  isExecuting,
  executingActionId,
}: MessageActionsProps) {
  const t = useT()
  const confirmationAction = (message.actionData?.actions ?? []).find((action) => action.id === 'confirmation')

  if (!confirmationAction) return null

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant={confirmationAction.variant ?? 'default'}
        size="sm"
        onClick={() => onExecuteAction(confirmationAction.id)}
        disabled={isExecuting || !!message.actionTaken}
      >
        {isExecuting && executingActionId === confirmationAction.id
          ? t('messages.actions.executing', 'Executing...')
          : t(confirmationAction.labelKey ?? 'messages.actions.confirmation', confirmationAction.label)}
      </Button>
    </div>
  )
}

export default MessageConfirmationActions
