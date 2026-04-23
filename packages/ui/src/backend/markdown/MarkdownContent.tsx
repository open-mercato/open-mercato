"use client"

import * as React from 'react'
import type { PluggableList } from 'unified'
import { useMarkdownRemarkPlugins } from './useMarkdownRemarkPlugins'

type ReactMarkdownProps = {
  children: React.ReactNode
  remarkPlugins?: PluggableList
}

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined')

const TestMarkdownComponent: React.ComponentType<ReactMarkdownProps> = ({ children }) => <>{children}</>

let loadedReactMarkdownComponent: React.ComponentType<ReactMarkdownProps> | null = isTestEnv
  ? TestMarkdownComponent
  : null
let reactMarkdownComponentPromise: Promise<React.ComponentType<ReactMarkdownProps>> | null = null

function loadReactMarkdownComponent(): Promise<React.ComponentType<ReactMarkdownProps>> {
  if (loadedReactMarkdownComponent) {
    return Promise.resolve(loadedReactMarkdownComponent)
  }

  if (!reactMarkdownComponentPromise) {
    reactMarkdownComponentPromise = import('react-markdown').then((mod) => {
      const component = mod.default as React.ComponentType<ReactMarkdownProps>
      loadedReactMarkdownComponent = component
      return component
    })
  }

  return reactMarkdownComponentPromise
}

function ReactMarkdownComponent(props: ReactMarkdownProps) {
  const [Component, setComponent] = React.useState<React.ComponentType<ReactMarkdownProps> | null>(
    () => loadedReactMarkdownComponent,
  )

  React.useEffect(() => {
    if (Component) {
      return
    }

    let active = true

    void loadReactMarkdownComponent().then((resolved) => {
      if (active) {
        setComponent(() => resolved)
      }
    })

    return () => {
      active = false
    }
  }, [Component])

  if (!Component) {
    return null
  }

  return <Component {...props} />
}

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
