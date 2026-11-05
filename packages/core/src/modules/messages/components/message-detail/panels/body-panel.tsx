"use client"

import * as React from 'react'
import type { MessageContentProps } from '@open-mercato/shared/modules/messages/types'
import { MarkdownContent } from '@open-mercato/ui/backend/markdown/MarkdownContent'
import type { MessageDetail } from '../types'

type BodyPanelProps = {
  detail: MessageDetail
  contentProps: MessageContentProps
  ContentComponent: React.ComponentType<MessageContentProps> | null
}

export function MessageDetailBodySection(props: BodyPanelProps) {
  if (props.ContentComponent) {
    return (
      <div className="rounded border bg-muted/30 p-3">
        <props.ContentComponent {...props.contentProps} />
      </div>
    )
  }

  return (
    <div className="rounded border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
      <MarkdownContent
        body={props.detail.body}
        format={props.detail.bodyFormat}
        className="text-sm whitespace-pre-wrap [&>*]:mb-2 [&>*:last-child]:mb-0 [&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs"
      />
    </div>
  )
}
