"use client"

import { MessageComposer } from '@open-mercato/ui/backend/messages'
import type { MessageAttachment, MessageDetail } from '../types'

type ComposerDialogsProps = {
  id: string
  detail: MessageDetail
  attachments: MessageAttachment[] | undefined
  editOpen: boolean
  setEditOpen: (value: boolean) => void
  onRefresh: () => Promise<unknown>
}

export function MessageDetailComposerDialogs(props: ComposerDialogsProps) {
  return (
    <MessageComposer
      variant="compose"
      messageId={props.id}
      open={props.editOpen && props.detail.isDraft && props.detail.canEditDraft}
      onOpenChange={props.setEditOpen}
      defaultValues={{
        type: props.detail.type,
        recipients: props.detail.recipients.map((recipient) => recipient.userId),
        subject: props.detail.subject,
        body: props.detail.body,
        bodyFormat: props.detail.bodyFormat,
        priority: props.detail.priority as 'low' | 'normal' | 'high' | 'urgent',
        visibility: props.detail.visibility ?? 'internal',
        sourceEntityType: props.detail.sourceEntityType ?? null,
        sourceEntityId: props.detail.sourceEntityId ?? null,
        externalEmail: props.detail.externalEmail ?? null,
        externalName: props.detail.externalName ?? null,
        attachmentIds: props.attachments?.map((attachment) => attachment.id) ?? [],
      }}
      onSuccess={() => {
        props.setEditOpen(false)
        void props.onRefresh()
      }}
    />
  )
}
