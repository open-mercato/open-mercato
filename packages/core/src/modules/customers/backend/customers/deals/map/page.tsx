"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { useRegisteredComponent } from '@open-mercato/ui/backend/injection/useRegisteredComponent'
import {
  ViewTabsRow,
  VIEW_TABS_ROW_COMPONENT_ID,
  type ViewTabsRowProps,
} from '../pipeline/components/ViewTabsRow'
import { DealsMapView } from './components/DealsMapView'

export default function DealsMapPage(): React.ReactElement {
  const t = useT()
  // Resolved through the component registry so downstream apps can hide a view
  // (or replace the whole switcher) without forking this page.
  const DealsViewTabsRow = useRegisteredComponent<ViewTabsRowProps>(
    VIEW_TABS_ROW_COMPONENT_ID,
    ViewTabsRow,
  )
  const [search, setSearch] = React.useState('')

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
                <BreadcrumbPage>
                  {translateWithFallback(t, 'customers.nav.deals.map', 'Deals Map')}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">
              {translateWithFallback(t, 'customers.nav.deals.map', 'Deals Map')}
            </h1>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={translateWithFallback(
                t,
                'customers.deals.kanban.search.placeholder',
                'Search deals…',
              )}
              className="w-64"
            />
          </div>
        </div>

        <DealsViewTabsRow active="map" className="mt-4" />

        <DealsMapView search={search} />
      </PageBody>
    </Page>
  )
}
