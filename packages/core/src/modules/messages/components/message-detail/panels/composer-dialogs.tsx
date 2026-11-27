"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageComposer, useComposeScheduling } from '@open-mercato/ui/backend/messages'
import { useComposeSenderOptions } from '@open-mercato/core/modules/messages/components/useComposeSenderOptions'
import type { MessageAttachment, MessageDetail } from '../types'

type ComposerDialogsProps = {
  id: string
  detail: MessageDetail
  attachments: MessageAttachment[] | undefined
  editOpen: boolean
  setEditOpen: (value: boolean) => void
}

export function MessageDetailComposerDialogs(props: ComposerDialogsProps) {
  const queryClient = useQueryClient()
  const editable = props.editOpen && props.detail.isDraft && props.detail.canEditDraft
  const senderOptions = useComposeSenderOptions(editable)
  const scheduling = useComposeScheduling(editable)

  // The attachments query key is nested under the detail key, so one prefix covers both.
  const invalidateDetail = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['messages', 'detail', props.id] }),
    [props.id, queryClient],
  )

  return (
    <MessageComposer
      variant="compose"
      messageId={props.id}
      expectedUpdatedAt={props.detail.updatedAt}
      open={editable}
      onOpenChange={(next) => {
        props.setEditOpen(next)
        if (!next) void invalidateDetail()
      }}
      senderOptions={senderOptions}
      scheduling={scheduling}
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
        externalEmails: (props.detail.externalParticipants ?? [])
          .filter((participant) => participant.role === 'to')
          .map((participant) => participant.email),
        sendSeparately: props.detail.emailSendSeparately ?? false,
        externalName: props.detail.externalName ?? null,
        senderChannelId: props.detail.senderChannelId ?? null,
        scheduledAt: props.detail.scheduledAt ?? null,
        attachmentIds: props.attachments?.map((attachment) => attachment.id) ?? [],
      }}
      onSuccess={() => {
        props.setEditOpen(false)
        void invalidateDetail()
      }}
    />
  )
}
