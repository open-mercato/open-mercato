"use client"

/**
 * Screen 13 — report configuration.
 *
 * The four notes on the mockup are the four decisions this screen exists to
 * make:
 *
 *  1. **Every number recomputes on the server as the period moves** (note 1).
 *     The pick-list would be guesswork otherwise. The page never adds up money
 *     itself: `POST .../reports/preview` owns D-7 and the screen renders what it
 *     answers, so a figure beside a project and the grand total can never come
 *     from two different rules.
 *  2. **A project with no entries in the period stays listed** (note 2),
 *     unticked and muted. Hiding it leaves the user asking where the UX workshop
 *     project went.
 *  3. **Presets fill an editable range** (note 3 → D-4). Week/Month/Year seed
 *     From and To; moving either date drops the preset to `custom`, because a
 *     highlighted "Month" over a 1 June – 19 July range would be a lie.
 *  4. **An hour already frozen in another report is excluded by default**
 *     (note 4 → D-5). This deviates from the mockup, which drew silent
 *     inclusion. The panel names the count, the minutes and the reports
 *     responsible, and the opt-in ships unticked — re-billing the same hour must
 *     be a deliberate act.
 *
 * The currency rule (R2) is enforced twice and surfaced once: the server refuses
 * a mixed selection with `422 report_currency_conflict`, and the screen renders
 * the offending projects it names rather than a generic failure.
 */

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, FileText, Info } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerPicker, type CustomerSelection } from '../../../../../lib/time-tracking-ui/CustomerPicker'
import {
  applyBound,
  applyPreset,
  defaultReportTitle,
  initialReportPeriod,
  isValidReportPeriod,
  REPORT_PERIOD_PRESETS,
  spansMultipleMonths,
  type ReportPeriodState,
} from '../../../../../lib/timesheets-reports/reportConfigState'
import {
  parseReportPreview,
  readCurrencyConflict,
  toCandidateProject,
  type CurrencyConflict,
  type ReportCandidateProject,
  type ReportPreview,
} from '../../../../../lib/timesheets-reports/reportConfigData'
import { formatReportMinutes } from '../../../../../lib/timesheets-reports/reportTotals'

const logger = createLogger('staff').child({ component: 'time-tracking/reports/create' })

const REPORTS_HREF = '/backend/staff/time-tracking/reports'
const PROJECTS_API = '/api/staff/timesheets/time-projects'
const PREVIEW_API = '/api/staff/timesheets/reports/preview'
const REPORTS_API_PATH = 'staff/timesheets/reports'
const RATES_FEATURE = 'staff.timesheets.rates.view'
const MUTATION_CONTEXT_ID = 'staff.time_tracking.reportCreate'
const RESOURCE_KIND = 'staff.timesheets.time_report'
const CANDIDATE_PAGE_SIZE = 100

type Grouping = 'project_task' | 'project_person' | 'project_day'
type NonbillableMode = 'separate' | 'exclude'

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

function readPreselectedProjectIds(params: URLSearchParams): string[] {
  const raw = params.get('projectIds')
  return raw ? raw.split(',').map((id) => id.trim()).filter(Boolean) : []
}

function readRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return []
  const items = (payload as { items?: unknown }).items
  return Array.isArray(items) ? (items.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>) : []
}

export default function TimeTrackingReportCreatePage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload } = useBackendChrome()
  const canSeeMoney = hasFeature(payload?.grantedFeatures, RATES_FEATURE)

  const [customer, setCustomer] = React.useState<CustomerSelection | null>(null)
  const [customerId, setCustomerId] = React.useState<string | null>(() => searchParams.get('customerId'))
  const [period, setPeriod] = React.useState<ReportPeriodState>(() => initialReportPeriod())
  const [candidates, setCandidates] = React.useState<ReportCandidateProject[]>([])
  const [candidatesLoading, setCandidatesLoading] = React.useState(false)
  const preselectedIds = React.useMemo(() => readPreselectedProjectIds(searchParams), [searchParams])
  const [selectedIds, setSelectedIds] = React.useState<string[]>(preselectedIds)
  // Note 2 forbids a pre-ticked project with no entries in the period, and the
  // entry counts only arrive with the candidate preview. So the default tick is
  // owed rather than applied: this flag says the screen still has to decide it
  // once the counts are in. An explicit `?projectIds=` preselection settles the
  // question up front and never becomes pending.
  const [defaultSelectionPending, setDefaultSelectionPending] = React.useState(preselectedIds.length === 0)
  const [grouping, setGrouping] = React.useState<Grouping>('project_task')
  const [nonbillableMode, setNonbillableMode] = React.useState<NonbillableMode>('separate')
  const [showRates, setShowRates] = React.useState(true)
  const [includeAlreadyReported, setIncludeAlreadyReported] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [titleTouched, setTitleTouched] = React.useState(false)

  const [candidatePreview, setCandidatePreview] = React.useState<ReportPreview | null>(null)
  const [preview, setPreview] = React.useState<ReportPreview | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [conflict, setConflict] = React.useState<CurrencyConflict | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const labels = React.useMemo(
    () => ({
      customer: t('staff.time_tracking.reports.create.customer', 'Customer'),
      customerHint: t(
        'staff.time_tracking.reports.create.customerHint',
        'Report currency: {currency} — it comes from this customer projects.',
      ),
      unknownCustomer: t('staff.time_tracking.reports.create.unknownCustomer', 'Customer'),
      previewError: t('staff.time_tracking.reports.errors.previewFailed', 'Could not compute the report totals.'),
      createError: t('staff.time_tracking.reports.errors.createFailed', 'Could not create the report.'),
    }),
    [t],
  )

  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: labels.createError,
  })

  const selectedIdsRef = React.useRef<string[]>(selectedIds)
  React.useEffect(() => {
    selectedIdsRef.current = selectedIds
  }, [selectedIds])

  React.useEffect(() => {
    if (!customer) return
    setCustomerId(customer.id)
  }, [customer])

  React.useEffect(() => {
    if (titleTouched) return
    setTitle(defaultReportTitle(customer?.name ?? null, period, labels.unknownCustomer))
  }, [customer?.name, labels.unknownCustomer, period, titleTouched])

  // The customer's whole project list, not just what is ticked: note 2 keeps an
  // empty project visible so nobody wonders where it went.
  React.useEffect(() => {
    if (!customerId) {
      setCandidates([])
      return
    }
    let cancelled = false
    setCandidatesLoading(true)
    const params = new URLSearchParams({
      page: '1',
      pageSize: String(CANDIDATE_PAGE_SIZE),
      customerId,
    })
    void readApiResultOrThrow<Record<string, unknown>>(`${PROJECTS_API}?${params.toString()}`, undefined, {
      allowNullResult: true,
      errorMessage: labels.previewError,
    })
      .then((result) => {
        if (cancelled) return
        const rows = readRows(result)
          .map(toCandidateProject)
          .filter((project): project is ReportCandidateProject => project !== null)
        setCandidates(rows)
        const allowed = new Set(rows.map((project) => project.id))
        const kept = selectedIdsRef.current.filter((id) => allowed.has(id))
        setSelectedIds(kept)
        setDefaultSelectionPending(kept.length === 0)
      })
      .catch((err) => {
        if (cancelled) return
        logger.error('staff.time_tracking.reports candidate projects failed', { err })
        setCandidates([])
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customerId, labels.previewError, scopeVersion])

  const runPreview = React.useCallback(
    async (projectIds: string[], signal: AbortSignal): Promise<ReportPreview | null> => {
      if (projectIds.length === 0 || !isValidReportPeriod(period)) return null
      const call = await apiCall<Record<string, unknown>>(
        PREVIEW_API,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customerId,
            periodKind: period.kind,
            periodFrom: period.from,
            periodTo: period.to,
            grouping,
            nonbillableMode,
            includeAlreadyReported,
            showRates,
            timeProjectIds: projectIds,
          }),
          signal,
        },
      )
      if (!call.ok) {
        const currencyConflict = readCurrencyConflict(call.result)
        if (currencyConflict) {
          setConflict(currencyConflict)
          return null
        }
        const message =
          (call.result && typeof call.result === 'object' && typeof (call.result as { error?: unknown }).error === 'string'
            ? ((call.result as { error: string }).error)
            : null) ?? labels.previewError
        throw new Error(message)
      }
      setConflict(null)
      return parseReportPreview(call.result)
    },
    [customerId, grouping, includeAlreadyReported, labels.previewError, nonbillableMode, period, showRates],
  )

  // Per-project figures depend only on (project, period), never on the ticks, so
  // they are fetched once for the whole candidate set and stay put while the
  // user changes the selection.
  React.useEffect(() => {
    if (candidates.length === 0) {
      setCandidatePreview(null)
      return
    }
    const controller = new AbortController()
    void runPreview(candidates.map((project) => project.id), controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCandidatePreview(result)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        logger.error('staff.time_tracking.reports candidate preview failed', { err })
      })
    return () => controller.abort()
  }, [candidates, runPreview])

  React.useEffect(() => {
    if (selectedIds.length === 0) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    const controller = new AbortController()
    setPreviewLoading(true)
    setPreviewError(null)
    void runPreview(selectedIds, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPreview(null)
        setPreviewError(err instanceof Error ? err.message : labels.previewError)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false)
      })
    return () => controller.abort()
  }, [labels.previewError, runPreview, selectedIds])

  const projectFigures = React.useMemo(() => {
    const map = new Map<string, { entryCount: number; minutes: number; amount: number | null }>()
    for (const row of candidatePreview?.projects ?? []) {
      map.set(row.id, {
        entryCount: row.entryCount,
        minutes: row.billableMinutes + row.nonbillableMinutes,
        amount: row.amount,
      })
    }
    return map
  }, [candidatePreview])

  // The counts decide the default: every project with time in the period is
  // ticked, the empty ones stay listed and untouched. Whatever the user ticked
  // while the counts were in flight is merged in rather than overwritten — the
  // screen settles the default once and then leaves the selection alone.
  React.useEffect(() => {
    if (!defaultSelectionPending || !candidatePreview || candidates.length === 0) return
    const withEntries = candidates
      .filter((project) => (projectFigures.get(project.id)?.entryCount ?? 0) > 0)
      .map((project) => project.id)
    setSelectedIds((current) => Array.from(new Set([...current, ...withEntries])))
    setDefaultSelectionPending(false)
  }, [candidatePreview, candidates, defaultSelectionPending, projectFigures])

  const currencyCode = preview?.currencyCode ?? candidatePreview?.currencyCode ?? null

  const money = React.useCallback(
    (amount: number | null | undefined) => {
      if (amount === null || amount === undefined) return '—'
      return formatCurrency(amount, currencyCode ?? undefined) ?? '—'
    },
    [currencyCode],
  )

  const toggleProject = React.useCallback((projectId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked ? Array.from(new Set([...current, projectId])) : current.filter((id) => id !== projectId),
    )
  }, [])

  const canSubmit =
    Boolean(customerId) &&
    selectedIds.length > 0 &&
    isValidReportPeriod(period) &&
    title.trim().length > 0 &&
    !conflict &&
    !submitting

  const handleSubmit = React.useCallback(async () => {
    if (!customerId || selectedIds.length === 0) return
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: () =>
          apiCall<{ id?: string | null }>(
            `/api/${REPORTS_API_PATH}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                customerId,
                title: title.trim(),
                periodKind: period.kind,
                periodFrom: period.from,
                periodTo: period.to,
                grouping,
                nonbillableMode,
                includeAlreadyReported,
                showRates,
                timeProjectIds: selectedIds,
              }),
            },
          ),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: RESOURCE_KIND,
          resourceId: 'new',
          retryLastMutation,
        },
        mutationPayload: { customerId, timeProjectIds: selectedIds },
      })
      if (!call.ok) {
        const currencyConflict = readCurrencyConflict(call.result)
        if (currencyConflict) {
          setConflict(currencyConflict)
          return
        }
        const message =
          call.result && typeof call.result === 'object' && typeof (call.result as { error?: unknown }).error === 'string'
            ? (call.result as { error: string }).error
            : labels.createError
        flash(message, 'error')
        return
      }
      const reportId = call.result?.id ?? null
      flash(t('staff.time_tracking.reports.create.created', 'Report generated.'), 'success')
      router.push(reportId ? `${REPORTS_HREF}/${reportId}` : REPORTS_HREF)
    } catch (err) {
      logger.error('staff.time_tracking.reports create failed', { err })
      flash(err instanceof Error ? err.message : labels.createError, 'error')
    } finally {
      setSubmitting(false)
    }
  }, [
    customerId,
    grouping,
    includeAlreadyReported,
    labels.createError,
    nonbillableMode,
    period,
    retryLastMutation,
    router,
    runMutation,
    selectedIds,
    showRates,
    t,
    title,
  ])

  return (
    <Page>
      <PageBody>
        <FormHeader
          mode="detail"
          title={t('staff.time_tracking.reports.create.title', 'New report')}
          subtitle={t('staff.time_tracking.reports.create.subtitle', 'A report always covers one customer.')}
          backHref={REPORTS_HREF}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <Label htmlFor="report-customer">{labels.customer}</Label>
              <CustomerPicker
                value={customerId}
                snapshot={customer}
                onChange={(selection) => {
                  setCustomer(selection)
                  setCustomerId(selection?.id ?? null)
                  setSelectedIds([])
                  setDefaultSelectionPending(true)
                  setConflict(null)
                }}
              />
              {currencyCode ? (
                <p className="text-xs text-muted-foreground">
                  {labels.customerHint.replace('{currency}', currencyCode)}
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <Label htmlFor="report-title">
                {t('staff.time_tracking.reports.create.reportTitle', 'Report title')}
              </Label>
              <Input
                id="report-title"
                value={title}
                onChange={(event) => {
                  setTitleTouched(true)
                  setTitle(event.target.value)
                }}
              />
            </section>

            <section className="flex flex-col gap-3">
              <Label>{t('staff.time_tracking.reports.create.period', 'Period')}</Label>
              <SegmentedControl
                value={period.kind === 'custom' ? '' : period.kind}
                onValueChange={(value) => {
                  if (value === 'week' || value === 'month' || value === 'year') {
                    setPeriod((current) => applyPreset(current, value))
                  }
                }}
              >
                {REPORT_PERIOD_PRESETS.map((preset) => (
                  <SegmentedControlItem key={preset} value={preset}>
                    {t(`staff.time_tracking.reports.create.preset.${preset}`, preset)}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-from">{t('staff.time_tracking.reports.create.from', 'From')}</Label>
                  <Input
                    id="report-from"
                    type="date"
                    value={period.from}
                    onChange={(event) => setPeriod((current) => applyBound(current, 'from', event.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-to">{t('staff.time_tracking.reports.create.to', 'To')}</Label>
                  <Input
                    id="report-to"
                    type="date"
                    value={period.to}
                    onChange={(event) => setPeriod((current) => applyBound(current, 'to', event.target.value))}
                  />
                </div>
              </div>
              {!isValidReportPeriod(period) ? (
                <p className="text-xs text-status-error-text">
                  {t('staff.time_tracking.reports.create.invalidPeriod', 'The end date must not precede the start date.')}
                </p>
              ) : spansMultipleMonths(period) ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'staff.time_tracking.reports.create.spansMonths',
                    'This range covers more than one month — adjust the dates if you only want one of them.',
                  )}
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <div>
                <Label>{t('staff.time_tracking.reports.create.projects', 'Customer projects')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('staff.time_tracking.reports.create.projectsHint', 'Tick the projects this report should cover.')}
                </p>
              </div>
              {candidatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  {t('staff.time_tracking.reports.create.loadingProjects', 'Loading projects…')}
                </div>
              ) : candidates.length === 0 ? (
                <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                  {customerId
                    ? t('staff.time_tracking.reports.create.noProjects', 'This customer has no time projects yet.')
                    : t('staff.time_tracking.reports.create.pickCustomer', 'Pick a customer to see their projects.')}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {candidates.map((project) => {
                    const figures = projectFigures.get(project.id)
                    const empty = (figures?.entryCount ?? 0) === 0
                    const checked = selectedIds.includes(project.id)
                    const isOffender = conflict?.offenders.some((offender) => offender.id === project.id) ?? false
                    return (
                      <li
                        key={project.id}
                        className={`flex items-center gap-3 p-3 ${empty && !checked ? 'opacity-60' : ''}`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleProject(project.id, value === true)}
                          aria-label={project.name}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{project.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {[
                              canSeeMoney && project.hourlyRate !== null
                                ? `${money(project.hourlyRate)}/h`
                                : null,
                              t('staff.time_tracking.reports.create.entriesInPeriod', '{count} entries in period').replace(
                                '{count}',
                                String(figures?.entryCount ?? 0),
                              ),
                              isOffender && project.currencyCode ? project.currencyCode : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <span className="font-mono text-sm tabular-nums">
                          {formatReportMinutes(figures?.minutes ?? 0)}
                        </span>
                        <span className="w-28 text-right font-mono text-sm tabular-nums text-muted-foreground">
                          {canSeeMoney ? money(figures?.amount ?? null) : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <Label>{t('staff.time_tracking.reports.create.presentation', 'Presentation')}</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-grouping">
                    {t('staff.time_tracking.reports.create.grouping', 'Grouping')}
                  </Label>
                  <Select value={grouping} onValueChange={(value) => setGrouping(value as Grouping)}>
                    <SelectTrigger id="report-grouping">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project_task">
                        {t('staff.time_tracking.reports.grouping.project_task', 'Project → task')}
                      </SelectItem>
                      <SelectItem value="project_person">
                        {t('staff.time_tracking.reports.grouping.project_person', 'Project → person')}
                      </SelectItem>
                      <SelectItem value="project_day">
                        {t('staff.time_tracking.reports.grouping.project_day', 'Project → day')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="report-nonbillable">
                    {t('staff.time_tracking.reports.create.nonbillable', 'Non-billable time')}
                  </Label>
                  <Select
                    value={nonbillableMode}
                    onValueChange={(value) => setNonbillableMode(value as NonbillableMode)}
                  >
                    <SelectTrigger id="report-nonbillable">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="separate">
                        {t('staff.time_tracking.reports.nonbillable.separate', 'Show separately, at no cost')}
                      </SelectItem>
                      <SelectItem value="exclude">
                        {t('staff.time_tracking.reports.nonbillable.exclude', 'Leave it out entirely')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Switch
                  checked={showRates}
                  onCheckedChange={(value) => setShowRates(value === true)}
                  aria-label={t('staff.time_tracking.reports.create.showRates', 'Show hourly rates')}
                  disabled={!canSeeMoney}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {t('staff.time_tracking.reports.create.showRates', 'Show hourly rates')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      'staff.time_tracking.reports.create.showRatesHint',
                      'Turn off if the client should see amounts only.',
                    )}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('staff.time_tracking.reports.create.summary', 'Range summary')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <SummaryRow
                  label={t('staff.time_tracking.reports.create.summaryProjects', 'Projects')}
                  value={`${selectedIds.length} / ${candidates.length}`}
                />
                <SummaryRow
                  label={t('staff.time_tracking.reports.create.summaryEntries', 'Entries')}
                  value={String(preview?.totals.entryCount ?? 0)}
                  mono
                />
                <SummaryRow
                  label={t('staff.time_tracking.reports.create.summaryBillable', 'Billable time')}
                  value={formatReportMinutes(preview?.totals.billableMinutes ?? 0)}
                  mono
                />
                <SummaryRow
                  label={t('staff.time_tracking.reports.create.summaryNonbillable', 'Non-billable')}
                  value={formatReportMinutes(preview?.totals.nonbillableMinutes ?? 0)}
                  mono
                />
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t('staff.time_tracking.reports.create.summaryTotal', 'To invoice')}
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {previewLoading ? <Spinner className="size-4" /> : money(preview?.totals.totalAmount ?? null)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {conflict ? (
              <Alert status="error">
                <AlertTitle>
                  {t('staff.time_tracking.reports.errors.currencyConflictTitle', 'Mixed currencies in this selection')}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {t(
                      'staff.time_tracking.reports.errors.currencyConflict',
                      'A report always covers one currency. Selected projects use {currencies}.',
                    ).replace('{currencies}', conflict.currencies.join(', '))}
                  </p>
                  <ul className="mt-2 list-disc pl-4">
                    {conflict.offenders.map((offender) => (
                      <li key={offender.id}>
                        {offender.name} — {offender.currencyCode ?? '—'}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {previewError ? <ErrorMessage label={previewError} /> : null}

            {(preview?.alreadyReportedCount ?? 0) > 0 || includeAlreadyReported ? (
              <Alert status="warning" icon={<AlertTriangle aria-hidden="true" />}>
                <AlertTitle>
                  {t(
                    'staff.time_tracking.reports.alreadyReported.title',
                    '{count} entries are already in another report',
                  ).replace('{count}', String(preview?.alreadyReportedCount ?? 0))}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {t(
                      'staff.time_tracking.reports.alreadyReported.body',
                      'They are excluded from this report so the same hour is not billed twice. Including them adds {hours} at the values frozen when those reports were closed.',
                    ).replace('{hours}', formatReportMinutes(preview?.alreadyReportedMinutes ?? 0))}
                  </p>
                  {(preview?.alreadyReportedIn.length ?? 0) > 0 ? (
                    <ul className="mt-2 list-disc pl-4">
                      {preview?.alreadyReportedIn.map((source) => (
                        <li key={source.reportId}>
                          <a className="underline" href={`${REPORTS_HREF}/${source.reportId}`}>
                            {source.reference ?? source.title ?? source.reportId}
                          </a>{' '}
                          — {source.entryCount} · {formatReportMinutes(source.minutes)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <label className="mt-3 flex items-start gap-2">
                    <Checkbox
                      checked={includeAlreadyReported}
                      onCheckedChange={(value) => setIncludeAlreadyReported(value === true)}
                    />
                    <span className="text-sm">
                      {t(
                        'staff.time_tracking.reports.alreadyReported.optIn',
                        'Include them anyway, at their frozen values',
                      )}
                    </span>
                  </label>
                </AlertDescription>
              </Alert>
            ) : null}

            <Alert status="information" icon={<Info aria-hidden="true" />}>
              <AlertDescription>
                {t(
                  'staff.time_tracking.reports.create.roundingNotice',
                  'Rounding: {rule} (global). Every amount above is rounded at the entry and then summed, so the printed lines add up to the total.',
                ).replace(
                  '{rule}',
                  preview?.rounding.unitMinutes || candidatePreview?.rounding.unitMinutes
                    ? t('staff.time_tracking.reports.create.roundingRule', '{minutes} min, {direction}')
                        .replace(
                          '{minutes}',
                          String(preview?.rounding.unitMinutes ?? candidatePreview?.rounding.unitMinutes ?? 0),
                        )
                        .replace(
                          '{direction}',
                          (preview?.rounding.direction ?? candidatePreview?.rounding.direction) === 'nearest'
                            ? t('staff.time_tracking.reports.create.roundingNearest', 'to the nearest')
                            : t('staff.time_tracking.reports.create.roundingUp', 'always up'),
                        )
                    : t('staff.time_tracking.reports.create.roundingOff', 'off'),
                )}
              </AlertDescription>
            </Alert>
          </aside>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push(REPORTS_HREF)}>
            {t('staff.time_tracking.reports.create.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            <FileText aria-hidden="true" />
            {t('staff.time_tracking.reports.create.submit', 'Generate preview')}
          </Button>
        </div>
      </PageBody>
    </Page>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-sm tabular-nums' : 'text-sm font-medium'}>{value}</span>
    </div>
  )
}
