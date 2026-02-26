"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import { getMessageUiComponentRegistry } from '../../utils/typeUiRegistry'
import { getMessageObjectType } from '../../../lib/message-objects-registry'
import type { MessageDetail, MessageDetailObject } from '../types'
import { formatDateTime } from '../utils'

export function MessageDetailThreadSection({ detail }: { detail: MessageDetail }) {
  const t = useT()
  const messageUiRegistry = getMessageUiComponentRegistry()

  if ((detail.thread ?? []).length === 0) return null

  return (
    <section className="space-y-3 border-l pl-4 py-2">
      <h2 className="text-base font-semibold">{t('messages.detail.thread', 'Thread')}</h2>
      <div className="space-y-3">
        {(detail.thread ?? []).map((threadItem) => (
          <article key={threadItem.id} className="rounded border p-3">
            <p className="text-xs text-muted-foreground">
              {(threadItem.senderName || threadItem.senderEmail || threadItem.senderUserId)} • {formatDateTime(threadItem.sentAt)}
            </p>
            <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
              <MarkdownContent
                body={threadItem.body}
                format={threadItem.bodyFormat ?? 'text'}
                className="text-sm whitespace-pre-wrap [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
              />
            </div>

            {(threadItem.objects ?? []).length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">
                  {t('messages.attachedObjects', 'Attached objects')}
                </p>
                {(threadItem.objects ?? []).map((obj: MessageDetailObject) => {
                  const componentKey = `${obj.entityModule}:${obj.entityType}`
                  const PreviewComponent = messageUiRegistry.objectPreviewComponents[componentKey]
                    ?? messageUiRegistry.objectPreviewComponents['messages:default']
                  const objectType = getMessageObjectType(obj.entityModule, obj.entityType)
                  if (!PreviewComponent) return null

                  return (
                    <div key={obj.id} className="scale-95 origin-left">
                      <PreviewComponent
                        entityId={obj.entityId}
                        entityModule={obj.entityModule}
                        entityType={obj.entityType}
                        snapshot={obj.snapshot ?? undefined}
                        previewData={obj.preview ?? undefined}
                        actionRequired={obj.actionRequired}
                        actionType={obj.actionType ?? undefined}
                        actionLabel={obj.actionLabel ?? undefined}
                        icon={objectType?.icon}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
