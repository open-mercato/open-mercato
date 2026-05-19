/**
 * @deprecated Import `EmptyState` from `@open-mercato/ui/primitives/empty-state` instead.
 *
 * This shim preserves the legacy import path
 * `@open-mercato/ui/backend/EmptyState` for existing consumers
 * (TabEmptyState, customers/auth/sales backend pages, …) while the
 * EmptyState is promoted to a primitive in DS Foundation v3. Public API
 * is preserved 1:1 — same props, same default outline button render
 * for the legacy `action` / `actionLabel + onAction` shapes.
 */

"use client"

export { EmptyState } from '../primitives/empty-state'
export type { EmptyStateProps } from '../primitives/empty-state'
