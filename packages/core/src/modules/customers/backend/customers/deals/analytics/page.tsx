"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type FunnelStage = {
  stage: string
  dealCount: number
  conversionRate: number
}

type ForecastEntry = {
  month: string
  dealCount: number
  totalValue: number
  weightedValue: number
}

type VelocityStage = {
  stage: string
  averageDays: number
}

type SourceEntry = {
  source: string
  dealCount: number
  totalValue: number
  winRate: number
}

type FunnelResponse = { stages: FunnelStage[] }
type ForecastResponse = { entries: ForecastEntry[] }
type VelocityResponse = { stages: VelocityStage[] }
type SourcesResponse = { sources: SourceEntry[] }

function getDefaultDateFrom(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return date.toISOString().slice(0, 10)
}

function getDefaultDateTo(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function DealsAnalyticsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [dateFrom, setDateFrom] = React.useState(getDefaultDateFrom)
  const [dateTo, setDateTo] = React.useState(getDefaultDateTo)

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <FormHeader
            mode="detail"
            backHref="/backend/customers/deals"
            backLabel={t('customers.deals.analytics.backToDeals', 'Back to deals')}
            title={t('customers.deals.analytics.title', 'Sales Analytics')}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground">
              {t('customers.deals.analytics.dateFrom', 'From')}
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <label className="text-sm font-medium text-muted-foreground">
              {t('customers.deals.analytics.dateTo', 'To')}
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ConversionFunnelCard
              dateFrom={dateFrom}
              dateTo={dateTo}
              scopeVersion={scopeVersion}
            />
            <RevenueForecastCard
              dateFrom={dateFrom}
              dateTo={dateTo}
              scopeVersion={scopeVersion}
            />
            <DealVelocityCard
              dateFrom={dateFrom}
              dateTo={dateTo}
              scopeVersion={scopeVersion}
            />
            <SourceEffectivenessCard
              dateFrom={dateFrom}
              dateTo={dateTo}
              scopeVersion={scopeVersion}
            />
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

type CardProps = {
  dateFrom: string
  dateTo: string
  scopeVersion: number
}

function ConversionFunnelCard({ dateFrom, dateTo, scopeVersion }: CardProps) {
  const t = useT()

  const { data, isLoading, error } = useQuery<FunnelResponse>({
    queryKey: ['customers', 'deals', 'analytics', 'funnel', scopeVersion, dateFrom, dateTo],
    queryFn: () =>
      readApiResultOrThrow<FunnelResponse>(
        `/api/customers/deals/analytics/funnel?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
        undefined,
        { errorMessage: t('customers.deals.analytics.funnel.error', 'Failed to load conversion funnel') },
      ),
  })

  const maxDealCount = React.useMemo(() => {
    if (!data?.stages?.length) return 1
    return Math.max(...data.stages.map((stage) => stage.dealCount), 1)
  }, [data])

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">
        {t('customers.deals.analytics.funnel.title', 'Conversion Funnel')}
      </h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">
          {t('customers.deals.analytics.funnel.error', 'Failed to load conversion funnel')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {data?.stages?.map((stage) => (
            <div key={stage.stage} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage.stage}</span>
                <span className="text-muted-foreground">
                  {stage.dealCount} {t('customers.deals.analytics.funnel.deals', 'deals')} &middot;{' '}
                  {stage.conversionRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${(stage.dealCount / maxDealCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!data?.stages?.length && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('customers.deals.analytics.noData', 'No data available for the selected period')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function RevenueForecastCard({ dateFrom, dateTo, scopeVersion }: CardProps) {
  const t = useT()

  const { data, isLoading, error } = useQuery<ForecastResponse>({
    queryKey: ['customers', 'deals', 'analytics', 'forecast', scopeVersion, dateFrom, dateTo],
    queryFn: () =>
      readApiResultOrThrow<ForecastResponse>(
        `/api/customers/deals/analytics/forecast?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
        undefined,
        { errorMessage: t('customers.deals.analytics.forecast.error', 'Failed to load revenue forecast') },
      ),
  })

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">
        {t('customers.deals.analytics.forecast.title', 'Revenue Forecast')}
      </h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">
          {t('customers.deals.analytics.forecast.error', 'Failed to load revenue forecast')}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {data?.entries?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">
                    {t('customers.deals.analytics.forecast.month', 'Month')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    {t('customers.deals.analytics.forecast.deals', 'Deals')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    {t('customers.deals.analytics.forecast.totalValue', 'Total Value')}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t('customers.deals.analytics.forecast.weightedValue', 'Weighted Value')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.month} className="border-b last:border-0">
                    <td className="py-2 pr-4">{entry.month}</td>
                    <td className="py-2 pr-4 text-right">{entry.dealCount}</td>
                    <td className="py-2 pr-4 text-right">{entry.totalValue.toLocaleString()}</td>
                    <td className="py-2 text-right">{entry.weightedValue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('customers.deals.analytics.noData', 'No data available for the selected period')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DealVelocityCard({ dateFrom, dateTo, scopeVersion }: CardProps) {
  const t = useT()

  const { data, isLoading, error } = useQuery<VelocityResponse>({
    queryKey: ['customers', 'deals', 'analytics', 'velocity', scopeVersion, dateFrom, dateTo],
    queryFn: () =>
      readApiResultOrThrow<VelocityResponse>(
        `/api/customers/deals/analytics/velocity?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
        undefined,
        { errorMessage: t('customers.deals.analytics.velocity.error', 'Failed to load deal velocity') },
      ),
  })

  const maxDays = React.useMemo(() => {
    if (!data?.stages?.length) return 1
    return Math.max(...data.stages.map((stage) => stage.averageDays), 1)
  }, [data])

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">
        {t('customers.deals.analytics.velocity.title', 'Deal Velocity')}
      </h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">
          {t('customers.deals.analytics.velocity.error', 'Failed to load deal velocity')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {data?.stages?.map((stage) => (
            <div key={stage.stage} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{stage.stage}</span>
                <span className="text-muted-foreground">
                  {stage.averageDays.toFixed(1)} {t('customers.deals.analytics.velocity.days', 'days')}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${(stage.averageDays / maxDays) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!data?.stages?.length && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('customers.deals.analytics.noData', 'No data available for the selected period')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SourceEffectivenessCard({ dateFrom, dateTo, scopeVersion }: CardProps) {
  const t = useT()

  const { data, isLoading, error } = useQuery<SourcesResponse>({
    queryKey: ['customers', 'deals', 'analytics', 'sources', scopeVersion, dateFrom, dateTo],
    queryFn: () =>
      readApiResultOrThrow<SourcesResponse>(
        `/api/customers/deals/analytics/sources?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`,
        undefined,
        { errorMessage: t('customers.deals.analytics.sources.error', 'Failed to load source effectiveness') },
      ),
  })

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold uppercase text-muted-foreground">
        {t('customers.deals.analytics.sources.title', 'Source Effectiveness')}
      </h3>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : error ? (
        <p className="py-4 text-sm text-destructive">
          {t('customers.deals.analytics.sources.error', 'Failed to load source effectiveness')}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {data?.sources?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">
                    {t('customers.deals.analytics.sources.source', 'Source')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    {t('customers.deals.analytics.sources.deals', 'Deals')}
                  </th>
                  <th className="pb-2 pr-4 text-right font-medium">
                    {t('customers.deals.analytics.sources.value', 'Value')}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t('customers.deals.analytics.sources.winRate', 'Win Rate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.source} className="border-b last:border-0">
                    <td className="py-2 pr-4">{source.source}</td>
                    <td className="py-2 pr-4 text-right">{source.dealCount}</td>
                    <td className="py-2 pr-4 text-right">{source.totalValue.toLocaleString()}</td>
                    <td className="py-2 text-right">{source.winRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('customers.deals.analytics.noData', 'No data available for the selected period')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
