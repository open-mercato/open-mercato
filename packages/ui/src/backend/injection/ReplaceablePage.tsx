'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import { useComponentOverride } from './useComponentOverride'

type ReplaceablePageProps = {
  componentId: string
  module?: string
  description?: string
  children: React.ReactNode
}

function PagePassthrough(props: Record<string, unknown>) {
  return React.createElement(React.Fragment, null, props.children as React.ReactNode)
}

/**
 * Wrapper that makes a backend page replaceable via the UMES component registry.
 *
 * Usage:
 * ```tsx
 * export default function MyPage() {
 *   return (
 *     <ReplaceablePage componentId="page:customers.people.detail" module="customers">
 *       ... original page content ...
 *     </ReplaceablePage>
 *   )
 * }
 * ```
 *
 * If an override is registered for the componentId, the override renders instead.
 */
export function ReplaceablePage({ componentId, module, description, children }: ReplaceablePageProps) {
  const Override = useComponentOverride(
    componentId,
    PagePassthrough as ComponentType<Record<string, unknown>>,
    { module, description },
  )

  if (Override) {
    return React.createElement(Override, { children } as Record<string, unknown>)
  }

  return <>{children}</>
}
