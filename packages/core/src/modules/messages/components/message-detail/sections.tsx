"use client"

import * as React from 'react'
import type {
  MessageActionsProps,
  MessageContentProps,
  MessageObjectAction,
} from '@open-mercato/shared/modules/messages/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { MessageComposer } from '@open-mercato/ui/backend/messages'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { MessageRecordObjectPreview } from '../MessageRecordObjectPreview'
import {
  resolveMessageObjectDetailComponent,
  resolveMessageObjectPreviewComponent,
} from '../typeUiRegistry'
import type {
  MessageAction,
  MessageAttachment,
  MessageDetail,
  MessageDetailObject,
  PendingActionConfirmation,
} from './types'
import { formatDateTime, toObjectAction } from './utils'

type HeaderSectionProps = {
  detail: MessageDetail
  updatingState: boolean
  isArchived: boolean
  onReply: () => void
  onForward: () => void
  onToggleRead: () => void
  onToggleArchive: () => void
  onDelete: () => void
}

export function MessageDetailHeaderSection(props: HeaderSectionProps) {
  const t = useT()

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-xl font-semibold">{props.detail.subject}</h1>
        <p className="text-sm text-muted-foreground">
          {t('messages.detail.from', 'From')}: {props.detail.senderName || props.detail.senderEmail || props.detail.senderUserId}
        </p>
        <p className="text-xs text-muted-foreground">{formatDateTime(props.detail.sentAt)}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {props.detail.typeDefinition.allowReply ? (
          <Button type="button" variant="outline" onClick={props.onReply}>
            {t('messages.reply', 'Reply')}
          </Button>
        ) : null}
        {props.detail.typeDefinition.allowForward ? (
          <Button type="button" variant="outline" onClick={props.onForward}>
            {t('messages.forward', 'Forward')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={props.updatingState}
          onClick={props.onToggleRead}
        >
          {props.detail.isRead
            ? t('messages.actions.markUnread', 'Mark unread')
            : t('messages.actions.markRead', 'Mark read')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={props.updatingState}
          onClick={props.onToggleArchive}
        >
          {props.isArchived
            ? t('messages.actions.unarchive', 'Unarchive')
            : t('messages.actions.archive', 'Archive')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={props.updatingState}
          onClick={props.onDelete}
        >
          {t('messages.actions.delete', 'Delete')}
        </Button>
      </div>
    </div>
  )
}

type BodySectionProps = {
  detail: MessageDetail
  contentProps: MessageContentProps
  ContentComponent: React.ComponentType<MessageContentProps> | null
}

export function MessageDetailBodySection(props: BodySectionProps) {
  if (props.ContentComponent) {
    return (
      <div className="rounded border bg-muted/30 p-3">
        <props.ContentComponent {...props.contentProps} />
      </div>
    )
  }

  return (
    <div className="rounded border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
      {props.detail.body}
    </div>
  )
}

export function MessageDetailMetaSection({ detail }: { detail: MessageDetail }) {
  const t = useT()

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {detail.externalEmail ? (
        <div className="space-y-1 rounded border p-3 text-sm">
          <p className="font-medium">{t('messages.externalEmail', 'External email')}</p>
          <p>{detail.externalEmail}</p>
        </div>
      ) : null}
      {detail.sourceEntityType || detail.sourceEntityId ? (
        <div className="space-y-1 rounded border p-3 text-sm">
          <p className="font-medium">{t('messages.detail.source', 'Source')}</p>
          <p>{detail.sourceEntityType || '—'}</p>
          <p className="text-xs text-muted-foreground">{detail.sourceEntityId || '—'}</p>
        </div>
      ) : null}
    </div>
  )
}

type ActionsSectionProps = {
  detail: MessageDetail
  messageActions: MessageAction[]
  executingActionId: string | null
  ActionsComponent: React.ComponentType<MessageActionsProps> | null
  onExecuteActionById: MessageActionsProps['onExecuteAction']
  onExecuteAction: (action: MessageAction, payload?: Record<string, unknown>) => Promise<void>
}

export function MessageDetailActionsSection(props: ActionsSectionProps) {
  const t = useT()

  if (!props.messageActions.length) return null

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
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

type ObjectsSectionProps = {
  detail: MessageDetail
  objectActionsByObjectId: Map<string, Map<string, MessageAction>>
  onExecuteAction: (action: MessageAction, payload?: Record<string, unknown>) => Promise<void>
}

export function MessageDetailObjectsSection(props: ObjectsSectionProps) {
  const t = useT()

  if ((props.detail.objects ?? []).length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">{t('messages.attachedObjects', 'Attached objects')}</h2>
      <div className="space-y-2">
        {(props.detail.objects ?? []).map((item) => {
          const DetailComponent = resolveMessageObjectDetailComponent(item.entityModule, item.entityType)
          const PreviewComponent = resolveMessageObjectPreviewComponent(item.entityModule, item.entityType)
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

          if (PreviewComponent) {
            return (
              <PreviewComponent
                key={item.id}
                entityId={item.entityId}
                entityModule={item.entityModule}
                entityType={item.entityType}
                snapshot={item.snapshot ?? undefined}
                previewData={item.preview ?? undefined}
                actionRequired={item.actionRequired}
                actionType={item.actionType ?? undefined}
                actionLabel={item.actionLabel ?? undefined}
              />
            )
          }

          return (
            <MessageRecordObjectPreview
              key={item.id}
              entityId={item.entityId}
              entityModule={item.entityModule}
              entityType={item.entityType}
              snapshot={item.snapshot ?? undefined}
              previewData={item.preview ?? undefined}
              actionRequired={item.actionRequired}
              actionType={item.actionType ?? undefined}
              actionLabel={item.actionLabel ?? undefined}
            />
          )
        })}
      </div>
    </section>
  )
}

type AttachmentsSectionProps = {
  attachmentsQuery: { isLoading: boolean; error: unknown }
  attachments: MessageAttachment[] | undefined
}

export function MessageDetailAttachmentsSection(props: AttachmentsSectionProps) {
  const t = useT()

  if (props.attachmentsQuery.isLoading) {
    return (
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{t('messages.attachedFiles', 'Attachments')}</h2>
        <p className="text-sm text-muted-foreground">{t('messages.loading.attachments', 'Loading attachments...')}</p>
      </section>
    )
  }

  if (props.attachmentsQuery.error) {
    return (
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">{t('messages.attachedFiles', 'Attachments')}</h2>
        <p className="text-sm text-destructive">
          {props.attachmentsQuery.error instanceof Error
            ? props.attachmentsQuery.error.message
            : t('messages.errors.loadAttachmentsFailed', 'Failed to load attachments.')}
        </p>
      </section>
    )
  }

  if ((props.attachments ?? []).length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">{t('messages.attachedFiles', 'Attachments')}</h2>
      <div className="space-y-2">
        {(props.attachments ?? []).map((attachment) => (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted"
          >
            <span className="truncate">{attachment.fileName}</span>
            <span className="text-xs text-muted-foreground">{Math.round(attachment.fileSize / 1024)} KB</span>
          </a>
        ))}
      </div>
    </section>
  )
}

export function MessageDetailThreadSection({ detail }: { detail: MessageDetail }) {
  const t = useT()

  if ((detail.thread ?? []).length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">{t('messages.detail.thread', 'Thread')}</h2>
      <div className="space-y-3">
        {(detail.thread ?? []).map((threadItem) => (
          <article key={threadItem.id} className="rounded border p-3">
            <p className="text-xs text-muted-foreground">
              {(threadItem.senderName || threadItem.senderEmail || threadItem.senderUserId)} • {formatDateTime(threadItem.sentAt)}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{threadItem.body}</p>

            {/* Show attached objects in thread messages */}
            {(threadItem.objects ?? []).length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">
                  {t('messages.attachedObjects', 'Attached objects')}
                </p>
                {(threadItem.objects ?? []).map((obj: MessageDetailObject) => {
                  const PreviewComponent = resolveMessageObjectPreviewComponent(obj.entityModule, obj.entityType)
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

type ComposerDialogsProps = {
  id: string
  replyOpen: boolean
  setReplyOpen: (value: boolean) => void
  forwardOpen: boolean
  setForwardOpen: (value: boolean) => void
  onSuccessNavigate: (messageId?: string | null) => void
  onRefresh: () => Promise<unknown>
}

export function MessageDetailComposerDialogs(props: ComposerDialogsProps) {
  return (
    <>
      <MessageComposer
        variant="reply"
        messageId={props.id}
        open={props.replyOpen}
        onOpenChange={props.setReplyOpen}
        onSuccess={(result) => {
          props.setReplyOpen(false)
          if (result.id) {
            props.onSuccessNavigate(result.id)
            return
          }
          void props.onRefresh()
        }}
      />

      <MessageComposer
        variant="forward"
        messageId={props.id}
        open={props.forwardOpen}
        onOpenChange={props.setForwardOpen}
        onSuccess={(result) => {
          props.setForwardOpen(false)
          if (result.id) {
            props.onSuccessNavigate(result.id)
            return
          }
          void props.onRefresh()
        }}
      />
    </>
  )
}

type DialogsProps = {
  pendingActionConfirmation: PendingActionConfirmation | null
  setPendingActionConfirmation: (value: PendingActionConfirmation | null) => void
  executingActionId: string | null
  handleConfirmPendingAction: () => Promise<void>
  handleActionConfirmDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  deleteConfirmationOpen: boolean
  setDeleteConfirmationOpen: (value: boolean) => void
  updatingState: boolean
  handleDelete: () => Promise<void>
  handleDeleteDialogKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

export function MessageDetailDialogs(props: DialogsProps) {
  const t = useT()

  return (
    <>
      <Dialog
        open={Boolean(props.pendingActionConfirmation)}
        onOpenChange={(open) => {
          if (!open) props.setPendingActionConfirmation(null)
        }}
      >
        <DialogContent className="sm:max-w-md" onKeyDown={props.handleActionConfirmDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('messages.confirm.actionTitle', 'Confirm action')}</DialogTitle>
            <DialogDescription>
              {props.pendingActionConfirmation?.action.confirmMessage
                || t('messages.confirm.action', 'Are you sure you want to continue?')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setPendingActionConfirmation(null)}
              disabled={props.executingActionId !== null}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant={props.pendingActionConfirmation?.action.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => void props.handleConfirmPendingAction()}
              disabled={props.executingActionId !== null}
            >
              {props.executingActionId === props.pendingActionConfirmation?.action.id
                ? t('messages.actions.executing', 'Executing...')
                : t(
                  props.pendingActionConfirmation?.action.labelKey || props.pendingActionConfirmation?.action.label || 'messages.confirm.actionConfirm',
                  props.pendingActionConfirmation?.action.label || t('messages.confirm.actionConfirm', 'Confirm'),
                )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={props.deleteConfirmationOpen}
        onOpenChange={props.setDeleteConfirmationOpen}
      >
        <DialogContent className="sm:max-w-md" onKeyDown={props.handleDeleteDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('messages.confirm.deleteTitle', 'Delete message')}</DialogTitle>
            <DialogDescription>
              {t('messages.confirm.delete', 'Delete this message from your view?')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => props.setDeleteConfirmationOpen(false)}
              disabled={props.updatingState}
            >
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void props.handleDelete()}
              disabled={props.updatingState}
            >
              {t('messages.actions.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
