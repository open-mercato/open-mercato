'use client'

import * as React from 'react'
import { useComponentOverride } from './useComponentOverride'

type ReplaceablePageProps = {
  componentId: string
  module?: string
  description?: string
  children: React.ReactNode
}

/**
 * Wrapper that makes a backend page replaceable via the UMES component registry.
 *
 * Usage:
 * ```tsx
 * export default function MyPage() {
 *   return (
 *     <ReplaceablePage componentId="page:customers.people.detail" module="customers">
 *       {/* original page content *\/}
 *     </ReplaceablePage>
 *   )
 * }
 * ```
 *
 * If an override is registered for the componentId, the override renders instead.
 */
export function ReplaceablePage({ componentId, module, description, children }: ReplaceablePageProps) {
  const PageContent = React.useCallback(
    (props: Record<string, unknown>) => React.createElement(React.Fragment, null, props.children),
    [],
  )
  PageContent.displayName = `Page(${componentId})`

  const Override = useComponentOverride(
    componentId,
    PageContent,
    { module, description },
  )

  if (Override) {
    return React.createElement(Override, { children })
  }

  return <>{children}</>
}
