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

const VIEW_LIST_HREF = '/backend/customers/deals'

export function ViewTabsRow({ active, className }: ViewTabsRowProps): React.ReactElement {
  const t = useT()
  const labels = {
    kanban: translateWithFallback(t, 'customers.deals.kanban.view.kanban', 'Kanban'),
    list: translateWithFallback(t, 'customers.deals.kanban.view.list', 'List'),
  }

  const baseTab =
    'inline-flex items-center px-[14px] py-[10px] text-[13px] leading-[normal] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
  const activeTab = 'border-b-2 border-foreground font-semibold text-foreground'
  const inactiveTab = 'border-b-2 border-transparent font-normal text-muted-foreground hover:text-foreground'

  return (
    <div
      role="tablist"
      aria-label={translateWithFallback(t, 'customers.deals.kanban.view.tablistLabel', 'Deals views')}
      className={`flex items-end gap-[4px] border-b border-border ${className ?? ''}`.trim()}
    >
      <span
        role="tab"
        aria-selected={active === 'kanban'}
        className={`${baseTab} ${active === 'kanban' ? activeTab : inactiveTab}`}
      >
        {labels.kanban}
      </span>
      <Link
        href={VIEW_LIST_HREF}
        role="tab"
        aria-selected={active === 'list'}
        className={`${baseTab} ${active === 'list' ? activeTab : inactiveTab}`}
      >
        {labels.list}
      </Link>
    </div>
  )
}

export default ViewTabsRow
