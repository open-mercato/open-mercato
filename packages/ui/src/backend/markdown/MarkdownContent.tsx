"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import type { PluggableList } from 'unified'
import { useMarkdownRemarkPlugins } from './useMarkdownRemarkPlugins'

const ReactMarkdown = dynamic(() => import('react-markdown'), {
  ssr: false,
  loading: () => null,
})

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
    <ReactMarkdown className={className} remarkPlugins={plugins}>
      {body}
    </ReactMarkdown>
  )
}
