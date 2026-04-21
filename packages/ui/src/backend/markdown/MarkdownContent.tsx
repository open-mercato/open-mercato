"use client"

import * as React from 'react'
import dynamic from 'next/dynamic.js'
import type { PluggableList } from 'unified'
import { useMarkdownRemarkPlugins } from './useMarkdownRemarkPlugins'

type ReactMarkdownProps = {
  children: React.ReactNode
  remarkPlugins?: PluggableList
}

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

const ReactMarkdownComponent: React.ComponentType<ReactMarkdownProps> = isTestEnv
  ? ({ children }) => <>{children}</>
  : (dynamic(() => import('react-markdown').then((mod) => mod.default as React.ComponentType<ReactMarkdownProps>), {
      ssr: false,
      loading: () => null,
    }) as unknown as React.ComponentType<ReactMarkdownProps>)

export type MarkdownContentProps = {
  body: string
  format?: 'text' | 'markdown'
  className?: string
  remarkPlugins?: PluggableList
}

export type MarkdownPreviewProps = {
  children: string
  className?: string
  remarkPlugins?: PluggableList
}

const EMPTY_PLUGINS: PluggableList = []

export function MarkdownPreview({ children, className, remarkPlugins }: MarkdownPreviewProps) {
  return (
    <div className={className}>
      <ReactMarkdownComponent remarkPlugins={remarkPlugins}>{children}</ReactMarkdownComponent>
    </div>
  )
}

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
    <MarkdownPreview className={className} remarkPlugins={plugins}>
      {body}
    </MarkdownPreview>
  )
}
