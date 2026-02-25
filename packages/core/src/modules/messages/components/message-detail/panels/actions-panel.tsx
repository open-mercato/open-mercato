"use client"

import type { ComponentType } from 'react'
import type { MessageActionsProps } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { MessageAction, MessageDetail } from '../types'
import { formatDateTime } from '../utils'

type ActionsPanelProps = {
  detail: MessageDetail
  messageActions: MessageAction[]
  executingActionId: string | null
  ActionsComponent: ComponentType<MessageActionsProps> | null
  onExecuteActionById: MessageActionsProps['onExecuteAction']
  onExecuteAction: (action: MessageAction, payload?: Record<string, unknown>) => Promise<void>
}

export function MessageDetailActionsSection(props: ActionsPanelProps) {
  const t = useT()

  if (!props.messageActions.length) return null

  return (
    <section className="space-y-3 border-l pl-4 py-2">
      <h2 className="text-base font-semibold">{t('messages.actions.title', 'Actions')}</h2>
      {props.ActionsComponent ? (
        <props.ActionsComponent
          message={{
            id: props.detail.id,
            type: props.detail.type,
            actionData: {
              ...(props.detail.actionData ?? {}),
              actions: props.messageActions,
            },
            actionTaken: props.detail.actionTaken ?? null,
          }}
          onExecuteAction={props.onExecuteActionById}
          isExecuting={props.executingActionId !== null}
          executingActionId={props.executingActionId}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {props.messageActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant={action.variant ?? 'default'}
              disabled={Boolean(props.detail.actionTaken) || props.executingActionId !== null}
              onClick={() => void props.onExecuteAction(action)}
            >
              {props.executingActionId === action.id
                ? t('messages.actions.executing', 'Executing...')
                : t(action.labelKey || action.label, action.label)}
            </Button>
          ))}
        </div>
      )}
      {props.detail.actionTaken ? (
        <p className="text-xs text-muted-foreground">
          {t('messages.actions.taken', 'Action taken')}: {props.detail.actionTaken} ({formatDateTime(props.detail.actionTakenAt)})
        </p>
      ) : null}
    </section>
  )
}
