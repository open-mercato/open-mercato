"use client"

import * as React from 'react'
import type { PluggableList } from 'unified'

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

let markdownPluginsPromise: Promise<PluggableList> | null = null

async function loadMarkdownPlugins(): Promise<PluggableList> {
  if (isTestEnv) return []
  if (!markdownPluginsPromise) {
    markdownPluginsPromise = import('remark-gfm')
      .then((mod) => [mod.default ?? mod] as PluggableList)
      .catch(() => [])
  }
  return markdownPluginsPromise
}

export function useMarkdownRemarkPlugins(providedPlugins?: PluggableList): PluggableList {
  const [plugins, setPlugins] = React.useState<PluggableList>(() => providedPlugins ?? [])

  React.useEffect(() => {
    if (providedPlugins) {
      setPlugins(providedPlugins)
      return
    }
    let mounted = true
    void loadMarkdownPlugins().then((resolved) => {
      if (!mounted) return
      setPlugins(resolved)
    })
    return () => {
      mounted = false
    }
  }, [providedPlugins])

  return providedPlugins ?? plugins
}
