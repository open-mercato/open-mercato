"use client"

import type { MessageObjectAction } from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  resolveMessageObjectDetailComponent,
} from '../../utils/typeUiRegistry'
import type { MessageAction, MessageDetail } from '../types'
import { toObjectAction } from '../utils'

type ObjectsPanelProps = {
  detail: MessageDetail
  objectActionsByObjectId: Map<string, Map<string, MessageAction>>
  onExecuteAction: (action: MessageAction, payload?: Record<string, unknown>) => Promise<void>
}

export function MessageDetailObjectsSection(props: ObjectsPanelProps) {
  const t = useT()

  if ((props.detail.objects ?? []).length === 0) return null

  return (
    <section className="space-y-3 pl-4 py-2">
      <h2 className="text-base font-semibold">{t('messages.attachedObjects', 'Attached objects')}</h2>
      <div className="space-y-2">
        {(props.detail.objects ?? []).map((item) => {
          const DetailComponent = resolveMessageObjectDetailComponent(
            item.entityModule,
            item.entityType,
          )
          const objectActions = props.objectActionsByObjectId.get(item.id)

          if (DetailComponent) {
            const actions: MessageObjectAction[] = objectActions
              ? Array.from(objectActions.entries()).map(([actionId, action]) => toObjectAction(actionId, action))
              : []

            return (
              <DetailComponent
                key={item.id}
                entityId={item.entityId}
                entityModule={item.entityModule}
                entityType={item.entityType}
                snapshot={item.snapshot ?? undefined}
                previewData={item.preview ?? undefined}
                actionRequired={item.actionRequired}
                actionType={item.actionType ?? undefined}
                actionLabel={item.actionLabel ?? undefined}
                actionTaken={props.detail.actionTaken ?? null}
                actionTakenAt={props.detail.actionTakenAt ? new Date(props.detail.actionTakenAt) : null}
                actionTakenByUserId={props.detail.actionTakenByUserId ?? null}
                actions={actions}
                onAction={async (actionId, payload) => {
                  const action = objectActions?.get(actionId)
                  if (!action) return
                  await props.onExecuteAction(action, payload)
                }}
              />
            )
          }
          return null
        })}
      </div>
    </section>
  )
}
