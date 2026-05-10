/**
 * @deprecated Import `EmptyState` from `@open-mercato/ui/primitives/empty-state`
 * directly with `variant="subtle"` and `size="lg"` (matches the previous
 * portal layout). The standalone `PortalEmptyState` is replaced by the
 * unified primitive in DS Foundation v3.
 *
 * This shim preserves the legacy import path
 * `@open-mercato/ui/portal/components/PortalEmptyState` for existing
 * portal consumers — it forwards to the primitive with the portal-style
 * variant + size pre-set.
 */

"use client"

import * as React from 'react'
import { EmptyState } from '../../primitives/empty-state'

export type PortalEmptyStateProps = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

/** @deprecated Use `EmptyState` from `@open-mercato/ui/primitives/empty-state` with `variant="subtle"` and `size="lg"`. */
export function PortalEmptyState({ icon, title, description, action }: PortalEmptyStateProps) {
  return (
    <EmptyState
      variant="subtle"
      size="lg"
      icon={icon}
      title={title}
      description={description}
      actions={action}
    />
  )
}
