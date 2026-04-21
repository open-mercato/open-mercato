"use client"

import * as React from 'react'
import type { PluggableList } from 'unified'
import { useMarkdownRemarkPlugins } from './useMarkdownRemarkPlugins'

const ReactMarkdown = React.lazy(() => import('react-markdown'))

export type MarkdownContentProps = {
  body: string
  format?: 'text' | 'markdown'
  className?: string
  remarkPlugins?: PluggableList
}

const EMPTY_PLUGINS: PluggableList = []

export function MarkdownContent({
  body,
  format = 'text',
  className,
  remarkPlugins,
}: MarkdownContentProps) {
  const shouldRenderMarkdown = format === 'markdown'
  const plugins = useMarkdownRemarkPlugins(
    shouldRenderMarkdown ? remarkPlugins : EMPTY_PLUGINS,
  )

  if (!shouldRenderMarkdown) {
    return <div className={className}>{body}</div>
  }

  return (
    <React.Suspense fallback={<div className={className}>{body}</div>}>
      <ReactMarkdown className={className} remarkPlugins={plugins}>
        {body}
      </ReactMarkdown>
    </React.Suspense>
  )
}
