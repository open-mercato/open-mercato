"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ListChecks, Settings } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import {
  XRAY_API_BASE,
  XRAY_PAGE_BASE,
  XRAY_SETTINGS_PAGE_PATH,
  buildQueryString,
  xrayAnalyticsUrl,
  xrayProcessPagePath,
  type XrayFilterState,
} from '../../lib/client/xray/api'
import { useXrayPermissions, useXrayResource } from '../../lib/client/xray/hooks'
import type { XrayDurationsResponse, XrayProcessesResponse } from '../../lib/client/xray/types'
import { XRAY_PROCESS_TABS, readProcessUrlState, writeProcessUrlState, type XrayProcessTab } from '../../lib/client/xray/urlState'
import { serializeWindow, windowQueryParams, type XrayWindowState } from '../../lib/client/xray/window'
import { XrayCycleTimeKpis } from './XrayCycleTimeKpis'
import { XrayErrorNotice, describeXrayError } from './XrayErrorNotice'
import { XrayFilterBar } from './XrayFilterBar'
import { XraySuggestionsSection } from './XraySuggestionsSection'
import { XrayWindowSelector } from './XrayWindowSelector'
import { XrayBottlenecksTab } from './tabs/XrayBottlenecksTab'
import { XrayBreakdownTab } from './tabs/XrayBreakdownTab'
import { XrayConformanceTab } from './tabs/XrayConformanceTab'
import { XrayMapTab } from './tabs/XrayMapTab'
import { XrayReworkTab } from './tabs/XrayReworkTab'
import { XrayVariantsTab } from './tabs/XrayVariantsTab'

export type XrayProcessPageClientProps = {
  processKey: string
}

/**
 * One process: headline figures and the analyses as tabs (map, variants, bottlenecks, rework,
 * conformance, breakdown, suggestions) over one window and one set of filters, all kept in the
 * URL. An unknown process and one the viewer may not see look the same (not found).
 */
export function XrayProcessPageClient({ processKey }: XrayProcessPageClientProps) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const permissions = useXrayPermissions()
  const state = React.useMemo(() => readProcessUrlState(searchParams), [searchParams])

  const update = React.useCallback((patch: Partial<{ tab: XrayProcessTab; window: XrayWindowState; filters: XrayFilterState }>) => {
    const next = { ...state, ...patch }
    router.replace(`${pathname ?? xrayProcessPagePath(processKey)}?${writeProcessUrlState(next)}`, { scroll: false })
  }, [pathname, processKey, router, state])

  const windowParams = windowQueryParams(state.window)
  const processes = useXrayResource<XrayProcessesResponse>(windowParams ? `${XRAY_API_BASE}/processes${buildQueryString(windowParams)}` : null, { keepPreviousData: true })
  const durations = useXrayResource<XrayDurationsResponse>(xrayAnalyticsUrl(processKey, 'durations', state.window, state.filters))
  const summary = processes.data?.items.find((item) => item.processKey === processKey) ?? null
  const clearActorFilters = React.useCallback(() => {
    update({ filters: { ...state.filters, actorRoleIds: [], actorTeamIds: [] } })
  }, [state.filters, update])

  if (processes.loading && !processes.data) return <LoadingMessage label={t('insights.xray.ui.loading')} />
  if (processes.error) return <XrayErrorNotice error={processes.error} onRetry={processes.reload} />
  if (processes.data && !summary) {
    return (
      <RecordNotFoundState
        label={t('insights.xray.errors.process_not_found')}
        description={t('insights.xray.ui.process.notFoundDescription')}
        backHref={XRAY_PAGE_BASE}
        backLabel={t('insights.xray.ui.process.backToList')}
      />
    )
  }

  const tabProps = { processKey, window: state.window, filters: state.filters, onClearActorFilters: clearActorFilters }
  const title = summary ? t(summary.labelKey) : processKey
  return (
    <div className="space-y-6" data-testid="xray-process-page">
      <PageHeader
        title={title}
        description={t('insights.xray.ui.process.description')}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={`${xrayProcessPagePath(processKey, 'cases')}?w=${encodeURIComponent(serializeWindow(state.window))}`}>
                <ListChecks className="size-4" aria-hidden="true" />
                {t('insights.xray.ui.process.cases')}
              </Link>
            </Button>
            {permissions.canManage ? (
              <Button asChild variant="outline">
                <Link href={XRAY_SETTINGS_PAGE_PATH}>
                  <Settings className="size-4" aria-hidden="true" />
                  {t('insights.xray.ui.process.settings')}
                </Link>
              </Button>
            ) : null}
          </>
        )}
      />
      <XrayFilterBar
        filters={state.filters}
        onChange={(filters) => update({ filters })}
        leadingItems={<XrayWindowSelector value={state.window} onChange={(window) => update({ window })} />}
      />
      <XrayCycleTimeKpis
        summary={summary}
        durations={durations.data}
        loading={durations.loading}
        error={durations.error ? describeXrayError(durations.error, t) : null}
      />
      <Tabs value={state.tab} onValueChange={(next) => { if ((XRAY_PROCESS_TABS as readonly string[]).includes(next)) update({ tab: next as XrayProcessTab }) }} variant="underline">
        <TabsList aria-label={t('insights.xray.ui.process.tabsLabel')}>
          {XRAY_PROCESS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>{t(`insights.xray.ui.tabs.${tab}`)}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="map"><XrayMapTab {...tabProps} /></TabsContent>
        <TabsContent value="variants"><XrayVariantsTab {...tabProps} permissions={permissions} /></TabsContent>
        <TabsContent value="bottlenecks"><XrayBottlenecksTab {...tabProps} /></TabsContent>
        <TabsContent value="rework"><XrayReworkTab {...tabProps} /></TabsContent>
        <TabsContent value="conformance"><XrayConformanceTab {...tabProps} canManage={permissions.canManage} /></TabsContent>
        <TabsContent value="breakdown"><XrayBreakdownTab {...tabProps} canViewIndividuals={permissions.canViewIndividuals} /></TabsContent>
        <TabsContent value="suggestions"><XraySuggestionsSection processKey={processKey} permissions={permissions} /></TabsContent>
      </Tabs>
    </div>
  )
}

