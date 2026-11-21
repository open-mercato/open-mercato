"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH } from '../../../../data/validators'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import {
  ViewTabsRow,
  VIEW_TABS_ROW_COMPONENT_ID,
  type ViewTabsRowProps,
} from '../pipeline/components/ViewTabsRow'
import { DealsTimelineBoard, useTimelinePermissions } from './components/DealsTimelineBoard'
import { buildTimelineHref, useTimelineUrlState } from './components/useTimelineUrlState'

const SEARCH_DEBOUNCE_MS = 300

export default function DealsTimelinePage(): React.ReactElement {
  const t = useT()
  const DealsViewTabsRow = useRegisteredComponent<ViewTabsRowProps>(VIEW_TABS_ROW_COMPONENT_ID, ViewTabsRow)
  const { state, update } = useTimelineUrlState()
  const permissions = useTimelinePermissions()
  const urlSearch = state.filters.search ?? ''
  const [search, setSearch] = React.useState(urlSearch)

  const pushedSearchRef = React.useRef(urlSearch.trim())

  React.useEffect(() => {
    if (urlSearch.trim() === pushedSearchRef.current) return
    pushedSearchRef.current = urlSearch.trim()
    setSearch(urlSearch)
  }, [urlSearch])

  React.useEffect(() => {
    if (search.trim() === urlSearch.trim()) return
    const handle = window.setTimeout(() => {
      pushedSearchRef.current = search.trim()
      update((current) => ({ filters: { ...current.filters, search: search.trim() || undefined } }))
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [search, update, urlSearch])

  const title = translateWithFallback(t, 'customers.nav.deals.timeline', 'Deals Timeline')
  const returnTo = buildTimelineHref({ ...state, dealId: null })

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-2">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/backend">
                    {translateWithFallback(t, 'customers.deals.kanban.breadcrumb.dashboard', 'Dashboard')}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/backend/customers/deals">
                    {translateWithFallback(t, 'customers.deals.kanban.breadcrumb.deals', 'Deals')}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">{title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                maxLength={DEAL_TIMELINE_SAVED_VIEW_MAX_SEARCH_LENGTH}
                placeholder={translateWithFallback(t, 'customers.deals.kanban.search.placeholder', 'Search deals…')}
                className="w-64"
              />
              {permissions.canManage ? (
                <Button asChild>
                  <Link href={`/backend/customers/deals/create?returnTo=${encodeURIComponent(returnTo)}`}>
                    <Plus className="size-4" aria-hidden="true" />
                    {translateWithFallback(t, 'customers.deals.kanban.cta.newDeal', 'New deal')}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <DealsViewTabsRow active="timeline" className="mt-4" />

        <DealsTimelineBoard state={state} update={update} permissions={permissions} />
      </PageBody>
    </Page>
  )
}
