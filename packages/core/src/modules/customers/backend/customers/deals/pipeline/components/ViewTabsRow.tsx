"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type KanbanView = 'kanban' | 'list'

type ViewTabsRowProps = {
  active: KanbanView
  className?: string
}

const VIEW_KANBAN_HREF = '/backend/customers/deals/pipeline'
const VIEW_LIST_HREF = '/backend/customers/deals'

export function ViewTabsRow({ active, className }: ViewTabsRowProps): React.ReactElement {
  const t = useT()
  const labels = {
    kanban: translateWithFallback(t, 'customers.deals.kanban.view.kanban', 'Kanban'),
    list: translateWithFallback(t, 'customers.deals.kanban.view.list', 'List'),
  }

  // Link-based tab row (two routes), so the Tabs primitive (state-driven,
  // onValueChange) does not fit — real <Link> semantics must stay. Classes
  // mirror the Tabs underline variant: accent-indigo active border,
  // shadow-focus halo.
  const baseTab =
    'inline-flex items-center px-3.5 py-2.5 text-sm leading-normal transition-colors focus-visible:outline-none focus-visible:shadow-focus'
  const activeTab = 'border-b-2 border-accent-indigo font-semibold text-foreground'
  const inactiveTab = 'border-b-2 border-transparent font-normal text-muted-foreground hover:text-foreground'

  // Renders the active tab as a non-navigating `<span>` and the inactive tab as a `<Link>`,
  // so the user can always round-trip between kanban and list from either page. Previously
  // the kanban tab was a hardcoded `<span>` because the row was only rendered on the kanban
  // page — adding it to the list page (item 7 of the SPEC-048 UX review) requires it to
  // navigate back to /pipeline.
  const isKanbanActive = active === 'kanban'
  const isListActive = active === 'list'

  return (
    <div
      role="tablist"
      aria-label={translateWithFallback(t, 'customers.deals.kanban.view.tablistLabel', 'Deals views')}
      className={`flex items-end gap-1 border-b border-border ${className ?? ''}`.trim()}
    >
      {isKanbanActive ? (
        <span
          role="tab"
          aria-selected={true}
          className={`${baseTab} ${activeTab}`}
        >
          {labels.kanban}
        </span>
      ) : (
        <Link
          href={VIEW_KANBAN_HREF}
          role="tab"
          aria-selected={false}
          className={`${baseTab} ${inactiveTab}`}
        >
          {labels.kanban}
        </Link>
      )}
      {isListActive ? (
        <span
          role="tab"
          aria-selected={true}
          className={`${baseTab} ${activeTab}`}
        >
          {labels.list}
        </span>
      ) : (
        <Link
          href={VIEW_LIST_HREF}
          role="tab"
          aria-selected={false}
          className={`${baseTab} ${inactiveTab}`}
        >
          {labels.list}
        </Link>
      )}
    </div>
  )
}

export default ViewTabsRow
