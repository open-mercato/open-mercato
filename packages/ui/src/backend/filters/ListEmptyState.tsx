'use client'
import * as React from 'react'
import Link from 'next/link'
import { Inbox, Plus } from 'lucide-react'
import { Button } from '../../primitives/button'
import { EmptyState } from '../../primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ListEmptyStateProps = {
  /** Plural entity label, e.g. "companies". Used to build the default title. */
  entityName?: string
  /** Overrides the generated title. */
  title?: string
  /** Overrides the generated description. */
  description?: string
  /** Create link target; renders the primary "create" action. */
  createHref?: string
  /** Create click handler (alternative to createHref). */
  onCreate?: () => void
  /** Label for the create action (defaults to a generic "Create"). */
  createLabel?: string
  /** Optional leading icon (defaults to a neutral inbox glyph). */
  icon?: React.ReactNode
}

/**
 * Standardized zero-records empty state for list views (DataTable `emptyState`).
 * Use this when a list has no records yet (no active search/filter). For
 * no-results-after-search the DataTable renders SearchEmptyResults, and for
 * no-results-after-filter it renders FilteredEmptyResults.
 */
export function ListEmptyState({
  entityName,
  title,
  description,
  createHref,
  onCreate,
  createLabel,
  icon,
}: ListEmptyStateProps) {
  const t = useT()
  const entity = entityName ?? t('ui.dataTable.empty.genericEntity', 'records')
  const resolvedTitle = title ?? t('ui.dataTable.empty.title', 'No {entity} yet', { entity })
  const resolvedDescription = description ?? t('ui.dataTable.empty.description', 'Items you add will show up here.')
  const resolvedCreateLabel = createLabel ?? t('ui.dataTable.empty.create', 'Create')
  const action = createHref ? (
    <Button asChild>
      <Link href={createHref}>
        <Plus className="size-4" aria-hidden />
        {resolvedCreateLabel}
      </Link>
    </Button>
  ) : onCreate ? (
    <Button type="button" onClick={onCreate}>
      <Plus className="size-4" aria-hidden />
      {resolvedCreateLabel}
    </Button>
  ) : null
  return (
    <EmptyState
      variant="subtle"
      size="lg"
      icon={icon ?? <Inbox className="size-7" aria-hidden />}
      title={resolvedTitle}
      description={resolvedDescription}
      actions={action}
    />
  )
}
