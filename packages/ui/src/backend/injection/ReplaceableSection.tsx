'use client'

import * as React from 'react'
import type { ComponentType } from 'react'
import { useComponentOverride } from './useComponentOverride'

type ReplaceableSectionProps<TProps extends Record<string, unknown>> = {
  componentId: string
  component: ComponentType<TProps>
  props: TProps
  module?: string
}

/**
 * Wrapper that makes a named section replaceable via the UMES component registry.
 *
 * Usage:
 * ```tsx
 * <ReplaceableSection
 *   componentId="section:customers.notes"
 *   component={NotesSection}
 *   props={{ entityType: 'person', entityId: id }}
 *   module="customers"
 * />
 * ```
 *
 * If an override is registered, the override component renders with the same props.
 */
export function ReplaceableSection<TProps extends Record<string, unknown>>({
  componentId,
  component: Original,
  props,
  module,
}: ReplaceableSectionProps<TProps>) {
  const Override = useComponentOverride(
    componentId,
    Original,
    { module, description: `Section: ${componentId}` },
  )

  const Component = Override ?? Original
  return React.createElement(Component, props)
}
