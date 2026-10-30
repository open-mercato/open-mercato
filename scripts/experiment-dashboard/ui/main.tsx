import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Copy,
  Download,
  FileCode2,
  FlaskConical,
  Layers3,
  Radio,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { I18nProvider, useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Card } from '@open-mercato/ui/primitives/card'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@open-mercato/ui/primitives/table'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@open-mercato/ui/primitives/tabs'
import {
  experimentTotals,
  filterCases,
  metricPresentation,
  selectMetrics,
} from './state.mjs'
import type {
  CaseDetail,
  Experiment,
  ExperimentSummary,
  GeneratedFile,
  Metrics,
  Status,
} from './types'
import dictionary from './en.json'

const statuses: Status[] = [
  'pending',
  'running',
  'pass',
  'fail',
  'blocked',
  'error',
  'skipped',
  'not-applicable',
]
const number = (value: number | undefined) =>
  value === undefined
    ? '—'
    : new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)
const time = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value))
    : '—'
const duration = (milliseconds: number) =>
  milliseconds < 60000
    ? `${Math.round(milliseconds / 1000)}s`
    : `${Math.floor(milliseconds / 60000)}m ${Math.round((milliseconds % 60000) / 1000)}s`
const serialized = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

function usePolling<T>(url: string | null, refresh: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      try {
        const response = await apiCall<T>(url!, { signal: controller.signal })
        if (!response.ok || !response.result)
          throw new Error('[internal] Dashboard request failed')
        if (!controller.signal.aborted) {
          setData(response.result)
          setLoadedUrl(url)
          setError(false)
          setSyncedAt(new Date().toISOString())
        }
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 3000)
      }
    }
    void read()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [url, refresh])
  return { data: loadedUrl === url ? data : null, error, syncedAt }
}

function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const tone =
    status === 'pass'
      ? 'success'
      : status === 'fail' || status === 'error'
        ? 'error'
        : status === 'blocked'
          ? 'warning'
          : status === 'running'
            ? 'info'
            : 'neutral'
  return (
    <Badge tone={tone} appearance="lighter" size="sm" dot>
      {t(`status.${status}`)}
    </Badge>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="dashboard-select-content">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MetricCard({
  metrics,
  caseId,
}: {
  metrics: Metrics
  caseId?: string | null
}) {
  const t = useT()
  const presentation = metricPresentation(metrics)
  return (
    <Card className="throughput-card">
      <div className="metric-heading">
        <span>
          <Zap />
          {t('dashboard.throughput')}
        </span>
        <Badge
          tone={
            presentation.kind === 'live' && !presentation.stale
              ? 'info'
              : 'neutral'
          }
          appearance="lighter"
          size="sm"
        >
          {t(`dashboard.metric.${presentation.kind}`)}
        </Badge>
      </div>
      <div className="throughput-value" data-testid="throughput">
        <strong>{number(presentation.rate ?? undefined)}</strong>
        <span>{t('dashboard.tokensPerSecond')}</span>
      </div>
      <p className={presentation.stale ? 'warning-text' : 'muted'}>
        {presentation.stale
          ? t('dashboard.metricStale')
          : caseId
            ? t('dashboard.metricCase', { case: caseId })
            : metrics.sampledAt
              ? t('dashboard.metricSample', { time: time(metrics.sampledAt) })
              : t(`dashboard.metric.${presentation.kind}`)}
      </p>
      <div className="token-grid">
        {(['inputTokens', 'outputTokens', 'totalTokens'] as const).map(
          (key) => (
            <div key={key}>
              <span>{t(`dashboard.${key}`)}</span>
              <strong data-testid={key}>{number(metrics[key])}</strong>
            </div>
          ),
        )}
      </div>
      {metrics.windowSeconds !== undefined && (
        <p className="muted metric-window">
          {t('dashboard.metricWindow', { seconds: metrics.windowSeconds })}
        </p>
      )}
    </Card>
  )
}

function FileViewer({
  files,
  selectedFile,
  onSelect,
}: {
  files: GeneratedFile[]
  selectedFile: string | null
  onSelect: (id: string) => void
}) {
  const t = useT()
  const file = files.find((item) => item.id === selectedFile) ?? files[0]
  const [copyState, setCopyState] = useState('copy')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  useEffect(() => {
    setCopyState('copy')
    if (!file) {
      setDownloadUrl(null)
      return
    }
    const url = URL.createObjectURL(
      new Blob([file.content], { type: 'text/plain;charset=utf-8' }),
    )
    setDownloadUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file?.id, file?.content])
  if (!file)
    return (
      <EmptyState
        title={t('dashboard.noFiles')}
        description={t('dashboard.noFilesDescription')}
        icon={<FileCode2 />}
      />
    )
  return (
    <div className="file-browser">
      <nav aria-label={t('dashboard.filesTab')} className="file-list">
        {files.map((item) => (
          <Button
            type="button"
            variant="ghost"
            key={item.id}
            aria-pressed={item.id === file.id}
            onClick={() => onSelect(item.id)}
          >
            <FileCode2 />
            <span>{item.path}</span>
            <ChevronRight />
          </Button>
        ))}
      </nav>
      <div className="file-content">
        <div className="file-toolbar">
          <div>
            <strong>{file.path}</strong>
            <span>
              {t('dashboard.fileDetails', {
                bytes: number(file.bytes),
                lines: number(file.content.split('\n').length),
              })}
            </span>
          </div>
          <div className="file-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t(`dashboard.${copyState}`)}
              onClick={() => {
                void navigator.clipboard.writeText(file.content).then(
                  () => setCopyState('copied'),
                  () => setCopyState('copyFailed'),
                )
              }}
            >
              {copyState === 'copied' ? <Check /> : <Copy />}
              <span>{t(`dashboard.${copyState}`)}</span>
            </Button>
            {downloadUrl && (
              <a
                className="download-link"
                href={downloadUrl}
                download={file.path.split('/').pop()}
              >
                <Download />
                {t('dashboard.download')}
              </a>
            )}
          </div>
        </div>
        <pre className="source-code" data-testid="file-content">
          {file.content}
        </pre>
      </div>
    </div>
  )
}

function CaseInspector({
  experiment,
  selected,
  onSelect,
  onClose,
  refresh,
}: {
  experiment: Experiment
  selected: { caseId: string; laneId: string }
  onSelect: (selected: { caseId: string; laneId: string }) => void
  onClose: () => void
  refresh: number
}) {
  const t = useT()
  const [tab, setTab] = useState('response')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const url = `/api/experiments/${encodeURIComponent(experiment.id)}/cases/${encodeURIComponent(selected.caseId)}?lane=${encodeURIComponent(selected.laneId)}`
  const detailState = usePolling<CaseDetail>(url, refresh)
  const detail = detailState.data
  const record = experiment.cases.find((item) => item.id === selected.caseId)
  const applicableLanes = experiment.lanes.filter(
    (lane) => record?.lanes[lane.id],
  )
  return (
    <Card
      className="inspector"
      id="case-inspector"
      aria-labelledby="inspection-title"
    >
      <div className="section-heading">
        <div>
          <div className="eyebrow">{t('dashboard.inspection')}</div>
          <h2 id="inspection-title">{record?.title ?? selected.caseId}</h2>
          <div className="inspection-meta">
            <code>{selected.caseId}</code>
            {detail && <StatusBadge status={detail.outcome.status} />}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('dashboard.closeCase')}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="inspection-lane">
        <FilterSelect
          label={t('dashboard.caseLane')}
          value={`lane:${selected.laneId}`}
          onChange={(value) =>
            onSelect({ caseId: selected.caseId, laneId: value.slice(5) })
          }
          options={applicableLanes.map((lane) => ({
            value: `lane:${lane.id}`,
            label: lane.label,
          }))}
        />
      </div>
      {detailState.error && (
        <p role="alert" className="error-banner">
          {t('dashboard.caseError')}
        </p>
      )}
      {!detail ? (
        <LoadingMessage
          className="loading-message"
          label={t('dashboard.caseLoading')}
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab} variant="underline">
          <TabsList aria-label={t('dashboard.detailTabs')}>
            <TabsTrigger value="response" leading={<Terminal />}>
              {t('dashboard.responseTab')}
            </TabsTrigger>
            <TabsTrigger
              value="files"
              leading={<Code2 />}
              count={detail.files.length}
            >
              {t('dashboard.filesTab')}
            </TabsTrigger>
            <TabsTrigger
              value="tools"
              leading={<Activity />}
              count={detail.tools.length}
            >
              {t('dashboard.toolsTab')}
            </TabsTrigger>
            <TabsTrigger value="evaluation" leading={<ShieldCheck />}>
              {t('dashboard.evaluationTab')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="response">
            <div className="detail-stack">
              {detail.prompt && (
                <details className="request">
                  <summary>{t('dashboard.originalRequest')}</summary>
                  <pre>{detail.prompt}</pre>
                </details>
              )}
              {detail.responseNote && (
                <p className="notice">{detail.responseNote}</p>
              )}
              {detail.responses.length ? (
                detail.responses.map((response, index) => (
                  <section className="response-block" key={response.id}>
                    <div className="artifact-label">
                      <Terminal />
                      <span>
                        {t('dashboard.responseNumber', { number: index + 1 })}
                      </span>
                      {response.attemptId && <code>{response.attemptId}</code>}
                    </div>
                    <pre data-testid="agent-response">{response.text}</pre>
                  </section>
                ))
              ) : (
                <EmptyState
                  title={t('dashboard.noResponse')}
                  description={t('dashboard.noResponseDescription')}
                  icon={<Terminal />}
                />
              )}
              {detail.structuredResponse != null && (
                <section>
                  <h3>{t('dashboard.structuredResponse')}</h3>
                  <pre className="evidence-code">
                    {serialized(detail.structuredResponse)}
                  </pre>
                </section>
              )}
            </div>
          </TabsContent>
          <TabsContent value="files">
            <FileViewer
              files={detail.files}
              selectedFile={selectedFile}
              onSelect={setSelectedFile}
            />
          </TabsContent>
          <TabsContent value="tools">
            <div className="detail-stack">
              {detail.tools.length ? (
                detail.tools.map((tool) => (
                  <section className="tool-event" key={tool.id}>
                    <div className="tool-heading">
                      <Terminal />
                      <strong>{tool.name}</strong>
                      {tool.path && <code>{tool.path}</code>}
                      <Badge
                        tone={tool.isError ? 'error' : 'neutral'}
                        size="sm"
                      >
                        {t(
                          tool.isError
                            ? 'dashboard.toolError'
                            : 'dashboard.toolSuccess',
                        )}
                      </Badge>
                    </div>
                    {tool.content && (
                      <pre className="evidence-code">{tool.content}</pre>
                    )}
                  </section>
                ))
              ) : (
                <EmptyState
                  title={t('dashboard.noTools')}
                  description={t('dashboard.noToolsDescription')}
                  icon={<Activity />}
                />
              )}
            </div>
          </TabsContent>
          <TabsContent value="evaluation">
            <div className="detail-stack">
              <div className="evaluation-summary">
                <StatusBadge status={detail.outcome.status} />
                {detail.outcome.attempts !== undefined && (
                  <span>
                    {t('dashboard.attempts', {
                      count: detail.outcome.attempts,
                    })}
                  </span>
                )}
                {detail.outcome.durationMs !== undefined && (
                  <span>
                    {t('dashboard.duration', {
                      duration: duration(detail.outcome.durationMs),
                    })}
                  </span>
                )}
              </div>
              {detail.outcome.diagnostics.length > 0 && (
                <section>
                  <h3>{t('dashboard.diagnostics')}</h3>
                  <ul className="diagnostics">
                    {detail.outcome.diagnostics.map((diagnostic, index) => (
                      <li key={index}>{diagnostic}</li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.evidence != null ? (
                <section>
                  <h3>{t('dashboard.evaluation')}</h3>
                  <pre className="evidence-code">
                    {serialized(detail.evidence)}
                  </pre>
                </section>
              ) : (
                <p className="muted">{t('dashboard.noEvidence')}</p>
              )}
              <MetricCard metrics={detail.outcome.metrics} />
              {detail.notices.map((notice, index) => (
                <p className="notice" key={index}>
                  {notice}
                </p>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </Card>
  )
}

function Dashboard() {
  const t = useT()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [laneFilter, setLaneFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<{
    caseId: string
    laneId: string
  } | null>(null)
  const listing = usePolling<{
    experiments: ExperimentSummary[]
    updatedAt: string
  }>('/api/experiments', refresh)
  const summaries = listing.data?.experiments ?? []
  const currentId = selectedId ?? summaries[0]?.id ?? null
  const runState = usePolling<Experiment>(
    currentId ? `/api/experiments/${encodeURIComponent(currentId)}` : null,
    refresh,
  )
  const experiment = runState.data
  const disconnected = listing.error || runState.error
  const totals = experiment ? experimentTotals(experiment) : null
  const metrics = experiment ? selectMetrics(experiment) : null
  const groups = [
    ...new Set(
      experiment?.cases.map((record) => record.group).filter(Boolean) ?? [],
    ),
  ]
  const cases = useMemo(
    () =>
      filterCases(experiment?.cases ?? [], {
        query,
        laneId: laneFilter === 'all' ? null : laneFilter.slice(5),
        status: statusFilter === 'all' ? null : statusFilter,
        group: groupFilter === 'all' ? null : groupFilter.slice(6),
      }),
    [experiment, query, laneFilter, statusFilter, groupFilter],
  )
  const pageCount = Math.max(1, Math.ceil(cases.length / 50))
  const currentPage = Math.min(page, pageCount - 1)
  const pageCases = cases.slice(currentPage * 50, (currentPage + 1) * 50)
  useEffect(() => {
    setPage(0)
  }, [query, laneFilter, statusFilter, groupFilter, currentId])
  function switchExperiment(id: string) {
    if (id === currentId) return
    setSelectedId(id)
    setSelected(null)
    setQuery('')
    setLaneFilter('all')
    setStatusFilter('all')
    setGroupFilter('all')
  }
  function clearFilters() {
    setQuery('')
    setLaneFilter('all')
    setStatusFilter('all')
    setGroupFilter('all')
  }
  function inspect(caseId: string, laneId: string) {
    setSelected({ caseId, laneId })
    setTimeout(
      () =>
        document
          .getElementById('case-inspector')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    )
  }
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <a className="brand" href="/">
          <img
            className="brand-mark"
            src="/open-mercato.svg"
            alt={t('dashboard.brand')}
            width={32}
            height={32}
          />
          <span>
            <strong>{t('dashboard.brand')}</strong>
            <small>{t('dashboard.brandCaption')}</small>
          </span>
        </a>
        <div className="sidebar-section-label">
          <span>{t('dashboard.experiments')}</span>
          <span>{number(summaries.length)}</span>
        </div>
        <nav
          className="experiment-list"
          aria-label={t('dashboard.experiments')}
        >
          {summaries.map((summary) => (
            <Button
              type="button"
              variant="ghost"
              key={summary.id}
              className="experiment-option"
              aria-current={currentId === summary.id ? 'page' : undefined}
              onClick={() => switchExperiment(summary.id)}
            >
              <span className="experiment-option-top">
                <Layers3 />
                <span>{summary.name}</span>
                <ChevronRight />
              </span>
              <span className="experiment-option-bottom">
                <span>{summary.metadata.model ?? t('dashboard.noModel')}</span>
                <StatusBadge status={summary.status} />
              </span>
            </Button>
          ))}
        </nav>
        <div className="observer-note">
          <ShieldCheck />
          <div>
            <strong>{t('dashboard.readOnly')}</strong>
            <p>{t('dashboard.readOnlyCaption')}</p>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="breadcrumb">
            <Layers3 />
            <span>{t('dashboard.experiments')}</span>
            <ChevronRight />
            <strong>{experiment?.name ?? t('dashboard.headerCaption')}</strong>
          </div>
          <div className="sync-controls">
            <span
              className={`sync-indicator ${disconnected ? 'disconnected' : ''}`}
            >
              <Radio />
              {t(disconnected ? 'dashboard.reconnecting' : 'dashboard.live')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('dashboard.refresh')}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw />
            </Button>
          </div>
        </div>
        <div className="main-content">
          {disconnected && (
            <ErrorMessage
              className="error-banner"
              label={t('dashboard.connectionLost')}
            />
          )}
          {!listing.data ? (
            <LoadingMessage
              className="loading-message"
              label={t('dashboard.loading')}
            />
          ) : !summaries.length ? (
            <EmptyState
              title={t('dashboard.emptyTitle')}
              description={t('dashboard.emptyDescription')}
              icon={<FlaskConical />}
            />
          ) : !experiment || !totals || !metrics ? (
            <LoadingMessage
              className="loading-message"
              label={t('dashboard.loading')}
            />
          ) : (
            <>
              <header className="run-header">
                <div>
                  <div className="eyebrow">{t('dashboard.headerCaption')}</div>
                  <div className="run-title">
                    <h1>{experiment.name}</h1>
                    <StatusBadge status={experiment.status} />
                  </div>
                  <div className="run-metadata">
                    <span>
                      <Code2 />
                      {experiment.metadata.model ?? t('dashboard.noModel')}
                    </span>
                    <span>
                      <Terminal />
                      {experiment.metadata.runner ?? t('dashboard.noRunner')}
                    </span>
                    {experiment.startedAt && (
                      <span>
                        <Clock3 />
                        {t('dashboard.started', {
                          time: time(experiment.startedAt),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <span className="last-sync">
                  {t('dashboard.updated', { time: time(runState.syncedAt) })}
                </span>
              </header>
              {experiment.error && (
                <ErrorMessage
                  className="error-banner"
                  label={experiment.error}
                />
              )}
              {experiment.stale && (
                <p className="notice">{t('dashboard.stale')}</p>
              )}
              <Card className="progress-card">
                <div className="progress-heading">
                  <span>
                    {totals.total
                      ? t('dashboard.progress', {
                          completed: number(totals.completed),
                          total: number(totals.total),
                        })
                      : t('dashboard.noTotal')}
                  </span>
                  <strong>
                    {totals.total
                      ? Math.round((totals.completed / totals.total) * 100)
                      : 0}
                    %
                  </strong>
                </div>
                <Progress
                  value={totals.completed}
                  max={Math.max(totals.total, 1)}
                  aria-label={t('dashboard.headerCaption')}
                />
                <div className="progress-caption">
                  <span>
                    {totals.observed && totals.total > 0
                      ? t('dashboard.observedTotals')
                      : t('dashboard.completedCaption')}
                  </span>
                  <span>
                    {t('dashboard.source', {
                      source: t(
                        `dashboard.source.${experiment.source}`,
                        experiment.source,
                      ),
                    })}
                  </span>
                </div>
              </Card>
              <div className="overview-grid">
                <div className="outcome-grid">
                  {(
                    [
                      { key: 'passed', icon: CheckCircle2, tone: 'success' },
                      { key: 'failed', icon: XCircle, tone: 'error' },
                      { key: 'blocked', icon: ShieldCheck, tone: 'warning' },
                      { key: 'skipped', icon: Circle, tone: 'neutral' },
                    ] as const
                  ).map(({ key, icon: Icon, tone }) => (
                    <Card className="outcome-card" key={key} data-tone={tone}>
                      <div className="outcome-icon">
                        <Icon />
                      </div>
                      <strong>{number(totals[key])}</strong>
                      <span>{t(`dashboard.${key}`)}</span>
                    </Card>
                  ))}
                  <div className="lane-cards">
                    {experiment.lanes.map((lane) => (
                      <Card className="lane-card" key={lane.id}>
                        <div>
                          <strong>{lane.label}</strong>
                          <span>
                            {t('dashboard.laneProgress', {
                              completed: number(lane.completed),
                              total: number(lane.total),
                            })}
                          </span>
                        </div>
                        <Progress
                          value={lane.completed}
                          max={Math.max(lane.total, 1)}
                          aria-label={lane.label}
                          size="sm"
                        />
                        <p>
                          {t('dashboard.laneCounts', {
                            passed: lane.counts.pass,
                            failed: lane.counts.fail + lane.counts.error,
                            running: lane.counts.running,
                          })}
                        </p>
                      </Card>
                    ))}
                  </div>
                </div>
                <MetricCard metrics={metrics.metrics} caseId={metrics.caseId} />
              </div>
              <Card className="activity-card">
                <div className="section-heading">
                  <h2>
                    <Activity />
                    {t('dashboard.activity')}
                  </h2>
                  <Badge
                    tone={experiment.active.length ? 'info' : 'neutral'}
                    size="sm"
                    appearance="lighter"
                  >
                    {t('dashboard.activityCount', {
                      count: experiment.active.length,
                    })}
                  </Badge>
                </div>
                {experiment.active.length ? (
                  <div className="activity-list">
                    {experiment.active.map((active) => {
                      const lane = experiment.lanes.find(
                        (item) => item.id === active.laneId,
                      )
                      const measurement = metricPresentation(active.metrics)
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          className="activity-item"
                          key={`${active.caseId}:${active.laneId}`}
                          aria-label={t('dashboard.openCase', {
                            case: active.caseId,
                            lane: lane?.label ?? active.laneId,
                          })}
                          onClick={() => inspect(active.caseId, active.laneId)}
                        >
                          <span className="activity-dot" />
                          <span className="activity-case">
                            <strong>{active.caseId}</strong>
                            <span>
                              {lane?.label} ·{' '}
                              {active.phase || t('dashboard.phaseFallback')}
                            </span>
                          </span>
                          <span className="activity-metrics">
                            {measurement.kind === 'live' &&
                              measurement.rate !== null && (
                                <strong>
                                  {number(measurement.rate)}{' '}
                                  {t('dashboard.tokensPerSecond')}
                                </strong>
                              )}
                            {active.toolCalls !== undefined && (
                              <span>
                                {t('dashboard.toolCalls', {
                                  count: active.toolCalls,
                                })}
                              </span>
                            )}
                          </span>
                          <ArrowUpRight />
                        </Button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="activity-empty">
                    <Circle />
                    <span>{t('dashboard.noActivity')}</span>
                    <small>{t('dashboard.noActivityDescription')}</small>
                  </div>
                )}
              </Card>
              <Card className="cases-card">
                <div className="section-heading">
                  <div>
                    <h2>{t('dashboard.cases')}</h2>
                    <p>{t('dashboard.casesCaption')}</p>
                  </div>
                  <span className="case-count">
                    {t('dashboard.caseCount', {
                      count: number(cases.length),
                      total: number(experiment.cases.length),
                    })}
                  </span>
                </div>
                <div className="filters">
                  <SearchInput
                    value={query}
                    onChange={setQuery}
                    aria-label={t('dashboard.search')}
                    placeholder={t('dashboard.searchPlaceholder')}
                  />
                  <FilterSelect
                    label={t('dashboard.laneFilter')}
                    value={laneFilter}
                    onChange={setLaneFilter}
                    options={[
                      { value: 'all', label: t('dashboard.allLanes') },
                      ...experiment.lanes.map((lane) => ({
                        value: `lane:${lane.id}`,
                        label: lane.label,
                      })),
                    ]}
                  />
                  <FilterSelect
                    label={t('dashboard.statusFilter')}
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      { value: 'all', label: t('dashboard.allStatuses') },
                      ...statuses.map((status) => ({
                        value: status,
                        label: t(`status.${status}`),
                      })),
                    ]}
                  />
                  {groups.length > 0 && (
                    <FilterSelect
                      label={t('dashboard.groupFilter')}
                      value={groupFilter}
                      onChange={setGroupFilter}
                      options={[
                        { value: 'all', label: t('dashboard.allGroups') },
                        ...groups.map((group) => ({
                          value: `group:${group}`,
                          label: group,
                        })),
                      ]}
                    />
                  )}
                </div>
                {cases.length ? (
                  <div className="table-scroll">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('dashboard.case')}</TableHead>
                          <TableHead>{t('dashboard.task')}</TableHead>
                          {experiment.lanes.map((lane) => (
                            <TableHead key={lane.id}>{lane.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageCases.map((record) => (
                          <TableRow
                            key={record.id}
                            data-selected={selected?.caseId === record.id}
                          >
                            <TableCell>
                              <code>{record.id}</code>
                              {record.group && <small>{record.group}</small>}
                            </TableCell>
                            <TableCell>
                              <strong>{record.title}</strong>
                            </TableCell>
                            {experiment.lanes.map((lane) => (
                              <TableCell key={lane.id}>
                                {record.lanes[lane.id] ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    className="outcome-button"
                                    aria-label={t('dashboard.openCase', {
                                      case: record.id,
                                      lane: lane.label,
                                    })}
                                    onClick={() => inspect(record.id, lane.id)}
                                  >
                                    <StatusBadge
                                      status={record.lanes[lane.id].status}
                                    />
                                    <ArrowUpRight />
                                  </Button>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="pagination">
                      <span>
                        {t('dashboard.page', {
                          page: currentPage + 1,
                          pages: pageCount,
                        })}
                      </span>
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={currentPage === 0}
                          onClick={() => setPage(currentPage - 1)}
                          aria-label={t('dashboard.previous')}
                        >
                          {t('dashboard.previous')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={currentPage + 1 >= pageCount}
                          onClick={() => setPage(currentPage + 1)}
                          aria-label={t('dashboard.next')}
                        >
                          {t('dashboard.next')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    title={t(
                      experiment.cases.length
                        ? 'dashboard.noMatchesTitle'
                        : 'dashboard.noCasesTitle',
                    )}
                    description={t(
                      experiment.cases.length
                        ? 'dashboard.noMatchesDescription'
                        : 'dashboard.noCasesDescription',
                    )}
                    icon={<Layers3 />}
                    actions={
                      experiment.cases.length ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={clearFilters}
                        >
                          {t('dashboard.clearFilters')}
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </Card>
              {selected && (
                <CaseInspector
                  key={experiment.id}
                  experiment={experiment}
                  selected={selected}
                  onSelect={setSelected}
                  onClose={() => setSelected(null)}
                  refresh={refresh}
                />
              )}
              <footer>{t('dashboard.footer')}</footer>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider locale="en" dict={dictionary}>
    <Dashboard />
  </I18nProvider>,
)
