"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

export type KanbanView = 'kanban' | 'list' | 'map'

/**
 * Canonical left-to-right order of the deals views. `visibleViews` selects a
 * subset of these; it never reorders them, so a host that hides one view keeps
 * the same tab order as every other deployment.
 */
export const DEALS_VIEWS: readonly KanbanView[] = ['kanban', 'list', 'map']

export type ViewTabsRowProps = {
  active: KanbanView
  className?: string
  /**
   * Views exposed in the tab row. Defaults to all of `DEALS_VIEWS`; pass a
   * subset to hide a view a deployment has no use for (e.g. omit `'map'` when
   * deal addresses are never geocoded). Unknown and duplicated entries are
   * ignored, and `active` is always rendered — a tab row that omits the page it
   * is sitting on would show no selected tab at all.
   */
  visibleViews?: readonly KanbanView[]
}

/**
 * Registered component id for the deals view switcher. Downstream apps can
 * target it from `widgets/components.ts` to replace or wrap the row, or — the
 * reason it is resolved through the registry at all — to transform its props
 * from one place instead of forking each of the three pages that render it:
 *
 * ```ts
 * export const componentOverrides: ComponentOverride[] = [{
 *   target: { componentId: 'section:customers.deals.viewTabs' },
 *   priority: 50,
 *   metadata: { module: 'my_module' },
 *   propsTransform: (props) => ({ ...props, visibleViews: ['kanban', 'list'] }),
 * }]
 * ```
 *
 * Hiding a tab does not unpublish its route; an app that also wants the page
 * gone disables it through `entry.overrides.pages` (#5923).
 */
export const VIEW_TABS_ROW_COMPONENT_ID = 'section:customers.deals.viewTabs'

const VIEW_HREFS: Record<KanbanView, string> = {
  kanban: '/backend/customers/deals/pipeline',
  list: '/backend/customers/deals',
  map: '/backend/customers/deals/map',
}

/**
 * Narrows `visibleViews` to the tabs this row renders, in canonical order.
 * Exported so the contract — canonical order, deduplication, unknown entries
 * dropped, `active` always kept — is testable without rendering.
 */
export function resolveVisibleViews(
  active: KanbanView,
  visibleViews?: readonly KanbanView[],
): KanbanView[] {
  if (!visibleViews) return [...DEALS_VIEWS]
  const requested = new Set<KanbanView>(visibleViews.filter((view) => DEALS_VIEWS.includes(view)))
  requested.add(active)
  return DEALS_VIEWS.filter((view) => requested.has(view))
}

export function ViewTabsRow({ active, className, visibleViews }: ViewTabsRowProps): React.ReactElement {
  const t = useT()
  const labels: Record<KanbanView, string> = {
    kanban: translateWithFallback(t, 'customers.deals.kanban.view.kanban', 'Kanban'),
    list: translateWithFallback(t, 'customers.deals.kanban.view.list', 'List'),
    map: translateWithFallback(t, 'customers.deals.kanban.view.map', 'Map'),
  }

  // Link-based tab row (three routes), so the Tabs primitive (state-driven,
  // onValueChange) does not fit — real <Link> semantics must stay. Classes
  // mirror the Tabs underline variant: accent-indigo active border,
  // shadow-focus halo.
  const baseTab =
    'inline-flex items-center px-3.5 py-2.5 text-sm leading-normal transition-colors focus-visible:outline-none focus-visible:shadow-focus'
  const activeTab = 'border-b-2 border-accent-indigo font-semibold text-foreground'
  const inactiveTab = 'border-b-2 border-transparent font-normal text-muted-foreground hover:text-foreground'

  // The active tab renders as a non-navigating `<span>` and every other tab as a
  // `<Link>`, so the user can always round-trip between the views from any page.
  const views = resolveVisibleViews(active, visibleViews)

  return (
    <div
      role="tablist"
      aria-label={translateWithFallback(t, 'customers.deals.kanban.view.tablistLabel', 'Deals views')}
      className={`flex items-end gap-1 border-b border-border ${className ?? ''}`.trim()}
    >
      {views.map((view) => (view === active ? (
        <span
          key={view}
          role="tab"
          aria-selected={true}
          className={`${baseTab} ${activeTab}`}
        >
          {labels[view]}
        </span>
      ) : (
        <Link
          key={view}
          href={VIEW_HREFS[view]}
          role="tab"
          aria-selected={false}
          className={`${baseTab} ${inactiveTab}`}
        >
          {labels[view]}
        </Link>
      )))}
    </div>
  )
}

export default ViewTabsRow
