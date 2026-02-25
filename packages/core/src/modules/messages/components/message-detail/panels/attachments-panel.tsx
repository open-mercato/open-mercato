"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  AttachmentVisualPreview,
  formatAttachmentFileSize,
} from '@open-mercato/ui/backend/detail/AttachmentVisualPreview'
import {
  buildAttachmentImageUrl,
  slugifyAttachmentFileName,
} from '@open-mercato/core/modules/attachments/lib/imageUrls'
import type { MessageAttachment } from '../types'

type AttachmentsPanelProps = {
  attachmentsQuery: { isLoading: boolean; error: unknown }
  attachments: MessageAttachment[] | undefined
}

export function MessageDetailAttachmentsSection(props: AttachmentsPanelProps) {
  const t = useT()

  if (props.attachmentsQuery.isLoading) {
    return (
      <section className="space-y-3 pl-4 py-2">
        <h2 className="text-base font-semibold">{t('messages.attachedFiles', 'Attachments')}</h2>
        <p className="text-sm text-muted-foreground">{t('messages.loading.attachments', 'Loading attachments...')}</p>
      </section>
    )
  }

  if (props.attachmentsQuery.error) {
    return (
      <section className="space-y-3 pl-4 py-2">
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
    <section className="space-y-3 pl-4 py-2">
      <h2 className="text-base font-semibold">{t('messages.attachedFiles', 'Attachments')}</h2>
      <div className="space-y-2">
        {(props.attachments ?? []).map((attachment) => (
          <a
            key={attachment.id}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-muted"
          >
            <AttachmentVisualPreview
              fileName={attachment.fileName}
              mimeType={attachment.mimeType}
              thumbnailUrl={
                attachment.mimeType?.toLowerCase().startsWith('image/')
                  ? buildAttachmentImageUrl(attachment.id, {
                    width: 120,
                    height: 120,
                    slug: slugifyAttachmentFileName(attachment.fileName),
                    cropType: 'cover',
                  })
                  : null
              }
              className="h-11 w-11 shrink-0 overflow-hidden rounded"
              iconClassName="mb-0 h-4 w-4"
              labelClassName="text-[10px]"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate">{attachment.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatAttachmentFileSize(attachment.fileSize)}
              </p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
