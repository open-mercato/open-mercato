"use client"

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import type { PluggableList } from 'unified'
import { useMarkdownRemarkPlugins } from './useMarkdownRemarkPlugins'

export type MarkdownContentProps = {
  body: string
  format?: 'text' | 'markdown'
  className?: string
  remarkPlugins?: PluggableList
}

export function MarkdownContent({
  body,
  format = 'text',
  className,
  remarkPlugins,
}: MarkdownContentProps) {
  const plugins = useMarkdownRemarkPlugins(remarkPlugins)

  if (format !== 'markdown') {
    return <div className={className}>{body}</div>
  }

  return (
    <ReactMarkdown className={className} remarkPlugins={plugins}>
      {body}
    </ReactMarkdown>
  )
}
