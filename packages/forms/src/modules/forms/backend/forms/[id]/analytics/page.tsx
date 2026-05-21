"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { KpiCard, BarChart, LineChart, type BarChartDataItem } from '@open-mercato/ui/backend/charts'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

type FieldChoiceCount = { value: string; count: number }

type FieldResponseStats = {
  fieldKey: string
  type: string
  sensitive: boolean
  answered: number
  blank: number
  choices?: FieldChoiceCount[]
}

type FormAnalytics = {
  formId: string
  window: { from: string | null; to: string | null }
  scan: { limit: number; scanned: number; capped: boolean }
  funnel: {
    started: number
    submitted: number
    completionRate: number
    byStatus: Record<string, number>
  }
  volume: Array<{ date: string; started: number; submitted: number }>
  timeToComplete: { sampleSize: number; medianSeconds: number | null; averageSeconds: number | null }
  fields: FieldResponseStats[]
  dropOff: Array<{ sectionKey: string; count: number }>
}

type FormSummaryResponse = {
  name?: string
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

const STATUS_ORDER = ['draft', 'submitted', 'reopened', 'archived', 'anonymized'] as const

export default function FormAnalyticsPage({ params }: { params?: { id?: string } }) {
  const formId = params?.id ?? ''
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const [analytics, setAnalytics] = React.useState<FormAnalytics | null>(null)
  const [formName, setFormName] = React.useState<string>('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const [analyticsResp, summaryResp] = await Promise.all([
          apiCall<FormAnalytics>(`/api/forms/${encodeURIComponent(formId)}/analytics`),
          apiCall<{ form: FormSummaryResponse }>(`/api/forms/${encodeURIComponent(formId)}`),
        ])
        if (cancelled) return
        if (!analyticsResp.ok || !analyticsResp.result) {
          setError(t('forms.analytics.error', { fallback: 'Failed to load analytics.' }))
          return
        }
        setAnalytics(analyticsResp.result)
        if (summaryResp.ok && summaryResp.result?.form?.name) {
          setFormName(summaryResp.result.form.name)
        }
      } catch {
        if (!cancelled) setError(t('forms.analytics.error', { fallback: 'Failed to load analytics.' }))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [formId, scopeVersion, t])

  const volumeData = React.useMemo(
    () => (analytics?.volume ?? []).map((point) => ({
      date: point.date,
      started: point.started,
      submitted: point.submitted,
    })),
    [analytics],
  )

  const enumerableFields = React.useMemo(
    () => (analytics?.fields ?? []).filter((field) => Array.isArray(field.choices)),
    [analytics],
  )

  const title = formName
    ? `${formName} · ${t('forms.analytics.title', { fallback: 'Analytics' })}`
    : t('forms.analytics.title', { fallback: 'Analytics' })

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {analytics?.scan.capped ? (
              <Tag variant="warning">
                {t('forms.analytics.partial', 'Partial · most recent {limit} submissions', {
                  limit: analytics.scan.limit,
                })}
              </Tag>
            ) : null}
          </div>

          {isLoading ? (
            <LoadingMessage message={t('forms.analytics.loading', { fallback: 'Loading analytics…' })} />
          ) : error ? (
            <ErrorMessage message={error} />
          ) : analytics ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  title={t('forms.analytics.kpi.started', { fallback: 'Started' })}
                  value={analytics.funnel.started}
                />
                <KpiCard
                  title={t('forms.analytics.kpi.submitted', { fallback: 'Submitted' })}
                  value={analytics.funnel.submitted}
                />
                <KpiCard
                  title={t('forms.analytics.kpi.completion_rate', { fallback: 'Completion rate' })}
                  value={Math.round(analytics.funnel.completionRate * 100)}
                  suffix="%"
                />
                <KpiCard
                  title={t('forms.analytics.kpi.median_time', { fallback: 'Median time to submit' })}
                  value={analytics.timeToComplete.medianSeconds}
                  formatValue={(value) => formatDuration(value)}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{t('forms.analytics.funnel.title', { fallback: 'Submissions by status' })}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_ORDER.map((status) => (
                      <Tag key={status} variant="neutral">
                        {t(`forms.submission.status.${status}`, { fallback: status })}: {analytics.funnel.byStatus[status] ?? 0}
                      </Tag>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <LineChart
                title={t('forms.analytics.volume.title', { fallback: 'Volume over time' })}
                data={volumeData}
                index="date"
                categories={['started', 'submitted']}
                categoryLabels={{
                  started: t('forms.analytics.kpi.started', { fallback: 'Started' }),
                  submitted: t('forms.analytics.kpi.submitted', { fallback: 'Submitted' }),
                }}
                emptyMessage={t('forms.analytics.volume.empty', { fallback: 'No submissions in range.' })}
              />

              <Card>
                <CardHeader>
                  <CardTitle>{t('forms.analytics.fields.title', { fallback: 'Per-field responses' })}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-6">
                    {enumerableFields.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('forms.analytics.fields.empty', {
                          fallback: 'No enumerable, non-sensitive fields to chart.',
                        })}
                      </p>
                    ) : (
                      enumerableFields.map((field) => {
                        const data: BarChartDataItem[] = (field.choices ?? []).map((choice) => ({
                          value: choice.value,
                          count: choice.count,
                        }))
                        return (
                          <BarChart
                            key={field.fieldKey}
                            title={field.fieldKey}
                            data={data}
                            index="value"
                            categories={['count']}
                            layout="horizontal"
                            categoryLabels={{
                              count: t('forms.analytics.fields.responses', { fallback: 'Responses' }),
                            }}
                            emptyMessage={t('forms.analytics.fields.empty_choices', { fallback: 'No responses yet.' })}
                          />
                        )
                      })
                    )}
                    <AnsweredVsBlankTable fields={analytics.fields} />
                  </div>
                </CardContent>
              </Card>

              {analytics.dropOff.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('forms.analytics.dropoff.title', { fallback: 'Draft drop-off by section' })}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-1">
                      {analytics.dropOff.map((point) => (
                        <div key={point.sectionKey} className="flex items-center justify-between text-sm">
                          <span className="text-foreground">{point.sectionKey}</span>
                          <span className="text-muted-foreground">{point.count}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}

function AnsweredVsBlankTable({ fields }: { fields: FieldResponseStats[] }) {
  const t = useT()
  if (fields.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">{t('forms.analytics.fields.field', { fallback: 'Field' })}</th>
            <th className="py-2 pr-4 font-medium">{t('forms.analytics.fields.type', { fallback: 'Type' })}</th>
            <th className="py-2 pr-4 font-medium">{t('forms.analytics.fields.answered', { fallback: 'Answered' })}</th>
            <th className="py-2 font-medium">{t('forms.analytics.fields.blank', { fallback: 'Blank' })}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.fieldKey} className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground">
                <span className="flex items-center gap-2">
                  {field.fieldKey}
                  {field.sensitive ? (
                    <Tag variant="warning">{t('forms.analytics.fields.sensitive', { fallback: 'Sensitive' })}</Tag>
                  ) : null}
                </span>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{field.type}</td>
              <td className="py-2 pr-4 text-foreground">{field.answered}</td>
              <td className="py-2 text-muted-foreground">{field.blank}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
