"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { formatAttachmentFileSize as formatBytes } from '@open-mercato/ui/backend/detail/AttachmentVisualPreview'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Copy, Info, RefreshCw, Trash2 } from 'lucide-react'
import type {
  ModuleResourceUsageEntry,
  ModuleResourceUsageReport,
  ModuleResourceUsageTimeBucket,
  ModuleResourceUsageTimeBucketModule,
} from '@open-mercato/shared/lib/modules/resource-usage'

const API_PATH = '/api/configs/module-telemetry'

type FetchState = {
  loading: boolean
  error: string | null
  report: ModuleTelemetryApiResponse | null
}

type ModuleTelemetryApiResponse = ModuleResourceUsageReport & {
  canClearTelemetry?: boolean
}

type ModuleTelemetryClearResponse = {
  cleared: boolean
}

const HOUR_MS = 60 * 60 * 1000

const REASON_LABEL_KEYS: Record<string, string> = {
  p95_duration: 'configs.moduleTelemetry.reason.p95Duration',
  cpu: 'configs.moduleTelemetry.reason.cpu',
  heap_allocations: 'configs.moduleTelemetry.reason.heapAllocations',
  rss_growth: 'configs.moduleTelemetry.reason.rssGrowth',
  errors: 'configs.moduleTelemetry.reason.errors',
}

const REASON_FALLBACKS: Record<string, string> = {
  p95_duration: 'Slow p95',
  cpu: 'CPU',
  heap_allocations: 'Heap',
  rss_growth: 'RSS growth',
  errors: 'Errors',
}

type UsageRangePreset = 'today' | 'last_1h' | 'last_6h' | 'last_24h' | 'all'

type UsageRange = {
  preset: UsageRangePreset
  startMs: number
  endMs: number
}

type RangeModuleSummary = ModuleResourceUsageTimeBucketModule & {
  stage: ModuleResourceUsageTimeBucket['stage']
}

type RangeModuleGroup = {
  moduleId: string
  stages: RangeModuleSummary[]
  candidateReasons: string[]
  calls: number
  totalCpuMs: number
  positiveRssDeltaBytes: number
}

const USAGE_RANGE_PRESETS: UsageRangePreset[] = ['today', 'last_1h', 'last_6h', 'last_24h', 'all']

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms'
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`
  return `${Math.round(ms)} ms`
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatBucketInterval(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return 'interval'
  if (ms >= 60 * 60 * 1000) {
    const hours = Math.round(ms / (60 * 60 * 1000))
    return `${hours}h`
  }
  const minutes = Math.round(ms / (60 * 1000))
  return `${minutes}m`
}

function bucketIntervalLabel(
  buckets: ModuleResourceUsageTimeBucket[],
  fallbackMs: number | undefined,
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string,
): string {
  const intervals = new Set(
    buckets
      .map((bucket) => bucket.bucketIntervalMs)
      .filter((value) => Number.isFinite(value) && value > 0),
  )
  if (intervals.size === 1) return formatBucketInterval(Array.from(intervals)[0])
  return formatBucketInterval(fallbackMs)
}

function bucketCountLabel(
  buckets: ModuleResourceUsageTimeBucket[],
  fallbackMs: number | undefined,
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string,
): string {
  const intervals = new Set(
    buckets
      .map((bucket) => bucket.bucketIntervalMs)
      .filter((value) => Number.isFinite(value) && value > 0),
  )
  if (intervals.size > 1) {
    return translate(
      'configs.moduleTelemetry.overview.mixedBucketCount',
      '{{count}} buckets · mixed intervals',
      { count: buckets.length },
    )
  }
  return translate(
    'configs.moduleTelemetry.overview.bucketCount',
    '{{count}} {{bucketWord}} ({{interval}} interval)',
    {
      count: buckets.length,
      bucketWord: buckets.length === 1
        ? translate('configs.moduleTelemetry.overview.bucketSingular', 'bucket')
        : translate('configs.moduleTelemetry.overview.bucketPlural', 'buckets'),
      interval: bucketIntervalLabel(buckets, fallbackMs, translate),
    },
  )
}

function formatRangeBoundary(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MetricTitle({
  label,
  tooltip,
}: {
  label: string
  tooltip: string
}) {
  return (
    <div className="inline-flex min-w-0 items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <SimpleTooltip content={tooltip} side="top" align="center" variant="light" size="lg">
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label={tooltip}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </SimpleTooltip>
    </div>
  )
}

function MetricCard({
  label,
  tooltip,
  value,
  subValue,
}: {
  label: string
  tooltip: string
  value: React.ReactNode
  subValue?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <MetricTitle label={label} tooltip={tooltip} />
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {subValue ? <div className="mt-1 text-xs text-muted-foreground">{subValue}</div> : null}
    </div>
  )
}

function firstBucketStartMs(buckets: ModuleResourceUsageTimeBucket[]): number | null {
  const starts = buckets
    .map((bucket) => Date.parse(bucket.bucketStart))
    .filter((value) => Number.isFinite(value))
  return starts.length ? Math.min(...starts) : null
}

function firstBucketEndMs(buckets: ModuleResourceUsageTimeBucket[]): number | null {
  const ends = buckets
    .map((bucket) => Date.parse(bucket.bucketEnd))
    .filter((value) => Number.isFinite(value))
  return ends.length ? Math.min(...ends) : null
}

function firstAvailableTelemetryMs(buckets: ModuleResourceUsageTimeBucket[], startedAtMs: number, nowMs: number): number {
  const firstBucketMs = firstBucketStartMs(buckets)
  if (firstBucketMs === null) return Number.isFinite(startedAtMs) ? startedAtMs : nowMs
  if (!Number.isFinite(startedAtMs)) return firstBucketMs

  const firstBucketEnd = firstBucketEndMs(buckets)
  if (firstBucketEnd !== null && firstBucketEnd > startedAtMs) return startedAtMs
  return firstBucketMs
}

function startOfTodayMs(nowMs: number): number {
  const date = new Date(nowMs)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function resolveUsageRange(
  preset: UsageRangePreset,
  buckets: ModuleResourceUsageTimeBucket[],
  startedAt: string,
  nowMs = Date.now(),
): UsageRange {
  const startedAtMs = Date.parse(startedAt)
  const availableStartMs = firstAvailableTelemetryMs(buckets, startedAtMs, nowMs)
  const rawStartMs = preset === 'today'
    ? startOfTodayMs(nowMs)
    : preset === 'last_1h'
      ? nowMs - HOUR_MS
      : preset === 'last_6h'
        ? nowMs - 6 * HOUR_MS
        : preset === 'last_24h'
          ? nowMs - 24 * HOUR_MS
          : availableStartMs
  const boundedStartMs = preset === 'all' ? rawStartMs : Math.max(rawStartMs, availableStartMs)
  return {
    preset,
    startMs: Math.min(boundedStartMs, nowMs),
    endMs: nowMs,
  }
}

function bucketsInRange(buckets: ModuleResourceUsageTimeBucket[], range: UsageRange): ModuleResourceUsageTimeBucket[] {
  return buckets.filter((bucket) => {
    const bucketStartMs = Date.parse(bucket.bucketStart)
    const bucketEndMs = Date.parse(bucket.bucketEnd)
    if (!Number.isFinite(bucketStartMs) || !Number.isFinite(bucketEndMs)) return false
    return bucketEndMs > range.startMs && bucketStartMs <= range.endMs
  })
}

// Hours of telemetry actually observed in the range (sum of the returned buckets' own
// intervals), not the wall-clock span of the range. Buckets are only created when an
// operation runs, so idle stretches with no tracked calls would otherwise dilute the
// wall-clock denominator and make "per hour" rates incomparable across range presets
// (e.g. "Today" diluted by idle daytime vs. "Last hour" right after a burst).
function activeRangeHours(buckets: ModuleResourceUsageTimeBucket[], bucketIntervalMs: number | undefined): number {
  const fallbackIntervalMs = bucketIntervalMs && Number.isFinite(bucketIntervalMs) && bucketIntervalMs > 0
    ? bucketIntervalMs
    : HOUR_MS
  if (!buckets.length) return fallbackIntervalMs / HOUR_MS
  const totalMs = buckets.reduce((sum, bucket) => {
    const interval = Number.isFinite(bucket.bucketIntervalMs) && bucket.bucketIntervalMs > 0
      ? bucket.bucketIntervalMs
      : fallbackIntervalMs
    return sum + interval
  }, 0)
  return Math.max(fallbackIntervalMs / HOUR_MS, totalMs / HOUR_MS)
}

function formatActiveDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0m'
  if (hours < 1) return `${Math.max(Math.round(hours * 60), 1)}m`
  if (hours < 10) return `${hours.toFixed(1)}h`
  return `${Math.round(hours)}h`
}

function usageRangeLabel(preset: UsageRangePreset, translate: (key: string, fallback?: string) => string): string {
  if (preset === 'today') return translate('configs.moduleTelemetry.range.today', 'Today')
  if (preset === 'last_1h') return translate('configs.moduleTelemetry.range.last1h', 'Last hour')
  if (preset === 'last_6h') return translate('configs.moduleTelemetry.range.last6h', 'Last 6 hours')
  if (preset === 'last_24h') return translate('configs.moduleTelemetry.range.last24h', 'Last 24 hours')
  return translate('configs.moduleTelemetry.range.all', 'All available')
}

function isUsageRangePreset(value: string | null): value is UsageRangePreset {
  return !!value && USAGE_RANGE_PRESETS.includes(value as UsageRangePreset)
}

function readUsageRangePreset(searchParams: { get(name: string): string | null } | null): UsageRangePreset {
  const value = searchParams?.get('range') ?? null
  return isUsageRangePreset(value) ? value : 'today'
}

function usageStageLabel(stage: ModuleResourceUsageTimeBucket['stage'], translate: (key: string, fallback?: string) => string): string {
  if (stage === 'startup') return translate('configs.moduleTelemetry.stage.startup', 'Startup')
  return translate('configs.moduleTelemetry.stage.running', 'Running')
}

function sortStageRows(a: RangeModuleSummary, b: RangeModuleSummary): number {
  if (a.stage !== b.stage) return a.stage === 'startup' ? -1 : 1
  return b.totalCpuMs - a.totalCpuMs
}

function groupRangeModules(modules: RangeModuleSummary[]): RangeModuleGroup[] {
  const groups = new Map<string, RangeModuleSummary[]>()
  for (const module of modules) {
    const group = groups.get(module.moduleId) ?? []
    group.push(module)
    groups.set(module.moduleId, group)
  }

  return Array.from(groups.entries()).map(([moduleId, stages]) => {
    const candidateReasons = Array.from(new Set(stages.flatMap((stage) => stage.candidateReasons)))
    return {
      moduleId,
      stages: [...stages].sort(sortStageRows),
      candidateReasons,
      calls: stages.reduce((sum, stage) => sum + stage.calls, 0),
      totalCpuMs: stages.reduce((sum, stage) => sum + stage.totalCpuMs, 0),
      positiveRssDeltaBytes: stages.reduce((sum, stage) => sum + stage.positiveRssDeltaBytes, 0),
    }
  }).sort((a, b) =>
    b.candidateReasons.length - a.candidateReasons.length
      || b.totalCpuMs - a.totalCpuMs
      || b.positiveRssDeltaBytes - a.positiveRssDeltaBytes
      || b.calls - a.calls
      || a.moduleId.localeCompare(b.moduleId)
  )
}

// Thresholds are sized as "per 5-minute bucket" heavy-usage limits (see
// getModuleResourceUsageThresholds()). A range can span anywhere from one bucket ("Last hour")
// to hundreds ("Today"/"All available"), so comparing a raw range-wide sum against a per-bucket
// threshold makes longer ranges strictly more likely to flag a signal regardless of actual
// per-window intensity. Normalize CPU/heap/RSS/errors to "average per bucket this module was
// active in" before comparing, so the same sustained workload reads the same way at any range.
// p95DurationMs is already a max across buckets (not a sum), so it needs no normalization.
function buildCandidateReasonsForModule(
  module: Pick<ModuleResourceUsageTimeBucketModule, 'p95DurationMs' | 'totalCpuMs' | 'positiveHeapDeltaBytes' | 'positiveRssDeltaBytes' | 'errors'>,
  thresholds: ModuleResourceUsageReport['thresholds'],
  bucketCount: number,
): string[] {
  const divisor = Math.max(1, bucketCount)
  const reasons: string[] = []
  if (module.p95DurationMs >= thresholds.p95DurationMs) reasons.push('p95_duration')
  if (module.totalCpuMs / divisor >= thresholds.cpuMs) reasons.push('cpu')
  if (module.positiveHeapDeltaBytes / divisor >= thresholds.positiveHeapDeltaBytes) reasons.push('heap_allocations')
  if (module.positiveRssDeltaBytes / divisor >= thresholds.positiveRssDeltaBytes) reasons.push('rss_growth')
  if (module.errors / divisor >= thresholds.errors) reasons.push('errors')
  return reasons
}

function mergeRangeOperations(modules: ModuleResourceUsageTimeBucketModule[]) {
  const operations = new Map<string, ModuleResourceUsageTimeBucketModule['topOperations'][number]>()
  for (const module of modules) {
    for (const operation of module.topOperations) {
      const key = `${operation.surface}\u0000${operation.operation}\u0000${operation.resourceId ?? ''}`
      const existing = operations.get(key)
      if (!existing) {
        operations.set(key, { ...operation })
        continue
      }
      existing.calls += operation.calls
      existing.errors += operation.errors
      existing.totalDurationMs += operation.totalDurationMs
      existing.maxDurationMs = Math.max(existing.maxDurationMs, operation.maxDurationMs)
      existing.p95DurationMs = Math.max(existing.p95DurationMs, operation.p95DurationMs)
      existing.totalCpuUserMs += operation.totalCpuUserMs
      existing.totalCpuSystemMs += operation.totalCpuSystemMs
      existing.maxCpuMs = Math.max(existing.maxCpuMs, operation.maxCpuMs)
      existing.totalHeapDeltaBytes += operation.totalHeapDeltaBytes
      existing.positiveHeapDeltaBytes += operation.positiveHeapDeltaBytes
      existing.maxHeapDeltaBytes = Math.max(existing.maxHeapDeltaBytes, operation.maxHeapDeltaBytes)
      existing.totalRssDeltaBytes += operation.totalRssDeltaBytes
      existing.positiveRssDeltaBytes += operation.positiveRssDeltaBytes
      existing.maxRssDeltaBytes = Math.max(existing.maxRssDeltaBytes, operation.maxRssDeltaBytes)
      existing.firstSeenAt = existing.firstSeenAt < operation.firstSeenAt ? existing.firstSeenAt : operation.firstSeenAt
      existing.lastSeenAt = existing.lastSeenAt > operation.lastSeenAt ? existing.lastSeenAt : operation.lastSeenAt
    }
  }
  return Array.from(operations.values())
    .sort((a, b) =>
      (b.totalCpuUserMs + b.totalCpuSystemMs) - (a.totalCpuUserMs + a.totalCpuSystemMs)
        || b.totalDurationMs - a.totalDurationMs
        || b.calls - a.calls
    )
    .slice(0, 5)
}

function mergeRangeSurfaces(modules: ModuleResourceUsageTimeBucketModule[]): ModuleResourceUsageTimeBucketModule['surfaces'] {
  const surfaces = new Map<string, ModuleResourceUsageTimeBucketModule['surfaces'][number]>()
  for (const module of modules) {
    for (const surface of module.surfaces) {
      const existing = surfaces.get(surface.surface)
      if (!existing) {
        surfaces.set(surface.surface, { ...surface })
        continue
      }
      existing.calls += surface.calls
      existing.errors += surface.errors
      existing.totalDurationMs += surface.totalDurationMs
      existing.p95DurationMs = Math.max(existing.p95DurationMs, surface.p95DurationMs)
      existing.totalCpuMs += surface.totalCpuMs
      existing.positiveHeapDeltaBytes += surface.positiveHeapDeltaBytes
      existing.positiveRssDeltaBytes += surface.positiveRssDeltaBytes
    }
  }
  return Array.from(surfaces.values()).sort((a, b) => b.totalCpuMs - a.totalCpuMs || b.totalDurationMs - a.totalDurationMs)
}

function aggregateRangeModules(
  buckets: ModuleResourceUsageTimeBucket[],
  thresholds: ModuleResourceUsageReport['thresholds'],
): RangeModuleSummary[] {
  const grouped = new Map<string, {
    moduleId: string
    stage: ModuleResourceUsageTimeBucket['stage']
    modules: ModuleResourceUsageTimeBucketModule[]
    // Distinct bucketStart values this module+stage appeared in. Tracked explicitly (rather than
    // relying on modules.length) so the "per-bucket average" candidate-signal divisor stays
    // correct even if a future change ever pushes more/fewer than one module entry per bucket.
    bucketKeys: Set<string>
  }>()
  for (const bucket of buckets) {
    for (const module of bucket.modules) {
      const key = `${module.moduleId}\u0000${bucket.stage}`
      const group = grouped.get(key) ?? { moduleId: module.moduleId, stage: bucket.stage, modules: [], bucketKeys: new Set<string>() }
      group.modules.push(module)
      group.bucketKeys.add(bucket.bucketStart)
      grouped.set(key, group)
    }
  }

  return Array.from(grouped.values()).map(({ moduleId, stage, modules, bucketKeys }) => {
    const summaryBase = {
      moduleId,
      stage,
      calls: modules.reduce((sum, module) => sum + module.calls, 0),
      errors: modules.reduce((sum, module) => sum + module.errors, 0),
      totalDurationMs: modules.reduce((sum, module) => sum + module.totalDurationMs, 0),
      p95DurationMs: Math.max(...modules.map((module) => module.p95DurationMs), 0),
      totalCpuMs: modules.reduce((sum, module) => sum + module.totalCpuMs, 0),
      positiveHeapDeltaBytes: modules.reduce((sum, module) => sum + module.positiveHeapDeltaBytes, 0),
      positiveRssDeltaBytes: modules.reduce((sum, module) => sum + module.positiveRssDeltaBytes, 0),
      surfaces: mergeRangeSurfaces(modules),
      topOperations: mergeRangeOperations(modules),
    }
    return {
      ...summaryBase,
      candidateReasons: buildCandidateReasonsForModule(summaryBase, thresholds, bucketKeys.size),
    }
  }).sort((a, b) =>
    b.candidateReasons.length - a.candidateReasons.length
      || b.totalCpuMs - a.totalCpuMs
      || b.positiveRssDeltaBytes - a.positiveRssDeltaBytes
      || b.calls - a.calls
  )
}

function RangeOverview({
  buckets,
  modules,
  range,
  rangePreset,
  onRangePresetChange,
  bucketIntervalMs,
  translate,
}: {
  buckets: ModuleResourceUsageTimeBucket[]
  modules: RangeModuleSummary[]
  range: UsageRange
  rangePreset: UsageRangePreset
  onRangePresetChange: (value: UsageRangePreset) => void
  bucketIntervalMs?: number
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  const selectedHours = activeRangeHours(buckets, bucketIntervalMs)
  const activeDurationLabel = formatActiveDuration(selectedHours)
  const bucketsLabel = bucketCountLabel(buckets, bucketIntervalMs, translate)
  const totalHeapGrowthBytes = modules.reduce((sum, module) => sum + module.positiveHeapDeltaBytes, 0)
  const totalRssGrowthBytes = modules.reduce((sum, module) => sum + module.positiveRssDeltaBytes, 0)
  const totals = {
    modules: new Set(modules.map((module) => module.moduleId)).size,
    calls: modules.reduce((sum, module) => sum + module.calls, 0),
    totalCpuMs: modules.reduce((sum, module) => sum + module.totalCpuMs, 0),
    avgHeapGrowthPerHour: totalHeapGrowthBytes / selectedHours,
    avgRssGrowthPerHour: totalRssGrowthBytes / selectedHours,
  }
  const growthTooltip = translate(
    'configs.moduleTelemetry.overview.growthTooltip',
    'Average positive growth per hour of measured activity in the selected range: total growth divided by the hours actually covered by tracked buckets, not the full wall-clock span. Idle stretches with no tracked calls do not dilute this rate, so it stays comparable across range presets. This is allocation pressure over time, not the current live process memory.',
  )
  const heapSubValue = translate(
    'configs.moduleTelemetry.overview.growthSubValue',
    '{{total}} total over {{duration}}',
    { total: formatBytes(totalHeapGrowthBytes), duration: activeDurationLabel },
  )
  const rssSubValue = translate(
    'configs.moduleTelemetry.overview.growthSubValue',
    '{{total}} total over {{duration}}',
    { total: formatBytes(totalRssGrowthBytes), duration: activeDurationLabel },
  )

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{translate('configs.moduleTelemetry.overview.title', 'Usage overview')}</h3>
          <p className="text-sm text-muted-foreground">
            {translate(
              'configs.moduleTelemetry.overview.description',
              'From {{from}} to now · {{buckets}}',
              {
                from: formatRangeBoundary(range.startMs),
                buckets: bucketsLabel,
              },
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <SegmentedControl
            value={rangePreset}
            onValueChange={(value) => onRangePresetChange(value as UsageRangePreset)}
            aria-label={translate('configs.moduleTelemetry.range.label', 'Time range')}
            size="sm"
            className="max-w-full flex-wrap overflow-x-auto rounded-lg"
          >
            {USAGE_RANGE_PRESETS.map((option) => (
              <SegmentedControlItem key={option} value={option}>
                {usageRangeLabel(option, translate)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={translate('configs.moduleTelemetry.overview.modules', 'Modules')}
          tooltip={translate('configs.moduleTelemetry.overview.modulesTooltip', 'Unique modules with tracked activity in the selected range. Startup and running are shown as separate rows inside each module group.')}
          value={formatCount(totals.modules)}
        />
        <MetricCard
          label={translate('configs.moduleTelemetry.overview.calls', 'Calls')}
          tooltip={translate('configs.moduleTelemetry.overview.callsTooltip', 'Total tracked operation calls in the selected range.')}
          value={formatCount(totals.calls)}
        />
        <MetricCard
          label={translate('configs.moduleTelemetry.overview.cpu', 'CPU')}
          tooltip={translate('configs.moduleTelemetry.overview.cpuTooltip', 'Total CPU time attributed to tracked module operations in the selected range.')}
          value={formatMs(totals.totalCpuMs)}
        />
        <MetricCard
          label={translate('configs.moduleTelemetry.overview.heapPerHour', 'Heap / hour')}
          tooltip={growthTooltip}
          value={formatBytes(totals.avgHeapGrowthPerHour)}
          subValue={heapSubValue}
        />
        <MetricCard
          label={translate('configs.moduleTelemetry.overview.rssPerHour', 'RSS / hour')}
          tooltip={growthTooltip}
          value={formatBytes(totals.avgRssGrowthPerHour)}
          subValue={rssSubValue}
        />
      </div>
    </div>
  )
}

function CandidateBadges({
  module,
  translate,
}: {
  module: ModuleResourceUsageTimeBucketModule
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  if (!module.candidateReasons.length) {
    return (
      <StatusBadge variant="neutral" dot>
        {translate('configs.moduleTelemetry.table.normal', 'Normal')}
      </StatusBadge>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {module.candidateReasons.map((reason) => (
        <StatusBadge key={reason} variant="warning" dot>
          {translate(REASON_LABEL_KEYS[reason] ?? `configs.moduleTelemetry.reason.${reason}`, REASON_FALLBACKS[reason] ?? reason)}
        </StatusBadge>
      ))}
    </div>
  )
}

function StageBadge({
  stage,
  translate,
}: {
  stage: ModuleResourceUsageTimeBucket['stage']
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  return (
    <StatusBadge variant={stage === 'startup' ? 'info' : 'neutral'} dot>
      {usageStageLabel(stage, translate)}
    </StatusBadge>
  )
}

function copyRowStats(module: RangeModuleSummary, translate: (key: string, fallback?: string) => string): void {
  const json = JSON.stringify(module, null, 2)
  navigator.clipboard
    .writeText(json)
    .then(() => {
      flash(translate('configs.moduleTelemetry.table.copySuccess', 'Row stats copied to clipboard.'), 'success')
    })
    .catch((err) => {
      console.warn('[ModuleTelemetryPanel] clipboard write failed', err)
      flash(translate('configs.moduleTelemetry.table.copyError', 'Failed to copy row stats.'), 'error')
    })
}

function TopOperationsBreakdown({
  operations,
  translate,
}: {
  operations: ModuleResourceUsageEntry[]
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  return (
    <div className="w-[26rem] max-w-[80vw] space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {translate('configs.moduleTelemetry.table.topOperationsBreakdown', 'Top operations in this range')}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="pb-1 pr-2 text-left font-medium">{translate('configs.moduleTelemetry.table.topOperation', 'Top operation')}</th>
            <th className="pb-1 pr-2 text-right font-medium">{translate('configs.moduleTelemetry.table.calls', 'Calls')}</th>
            <th className="pb-1 pr-2 text-right font-medium">{translate('configs.moduleTelemetry.table.worstP95', 'Worst p95')}</th>
            <th className="pb-1 pr-2 text-right font-medium">{translate('configs.moduleTelemetry.table.cpu', 'CPU')}</th>
            <th className="pb-1 pr-2 text-right font-medium">{translate('configs.moduleTelemetry.table.heap', 'Heap growth')}</th>
            <th className="pb-1 text-right font-medium">{translate('configs.moduleTelemetry.table.rss', 'RSS growth')}</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((operation, index) => (
            <tr key={`${operation.surface} ${operation.operation} ${index}`} className="border-t border-border/50">
              <td className="py-1 pr-2 align-top">
                <div className="font-medium text-foreground">{operation.operation}</div>
                <div className="text-muted-foreground">
                  {operation.surface}
                  {operation.errors > 0
                    ? ` · ${translate('configs.moduleTelemetry.table.errorCount', '{{count}} errors', { count: operation.errors })}`
                    : ''}
                </div>
                {operation.concurrentCalls > 0 ? (
                  <div className="text-muted-foreground">
                    {translate(
                      'configs.moduleTelemetry.table.concurrentOverlap',
                      '{{percent}}% overlapped other calls — CPU/heap/RSS less certain',
                      { percent: Math.round((operation.concurrentCalls / Math.max(operation.calls, 1)) * 100) },
                    )}
                  </div>
                ) : null}
              </td>
              <td className="py-1 pr-2 text-right align-top">{formatCount(operation.calls)}</td>
              <td className="py-1 pr-2 text-right align-top">{formatMs(operation.p95DurationMs)}</td>
              <td className="py-1 pr-2 text-right align-top">{formatMs(operation.totalCpuUserMs + operation.totalCpuSystemMs)}</td>
              <td className="py-1 pr-2 text-right align-top">{formatBytes(operation.positiveHeapDeltaBytes)}</td>
              <td className="py-1 text-right align-top">{formatBytes(operation.positiveRssDeltaBytes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RangeModuleTable({
  modules,
  translate,
}: {
  modules: RangeModuleSummary[]
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  if (!modules.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate('configs.moduleTelemetry.modules.empty', 'No module activity has been recorded for this range yet.')}
      </p>
    )
  }

  const groups = groupRangeModules(modules)

  return (
    <TooltipProvider delayDuration={200}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">{translate('configs.moduleTelemetry.table.module', 'Module')}</th>
              <th className="px-3 py-2 text-left">{translate('configs.moduleTelemetry.table.stage', 'Stage')}</th>
              <th className="px-3 py-2 text-left">
                <MetricTitle
                  label={translate('configs.moduleTelemetry.table.signals', 'Signals')}
                  tooltip={translate(
                    'configs.moduleTelemetry.table.signalsTooltip',
                    'Flags a module whose CPU, heap growth, RSS growth, or errors average at or above a heavy-usage threshold per 5-minute bucket it was active in during this range. This is a per-bucket average, not a raw range-wide total, so the same sustained workload looks the same regardless of the selected time range.',
                  )}
                />
              </th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.calls', 'Calls')}</th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.worstP95', 'Worst p95')}</th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.cpu', 'CPU')}</th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.heap', 'Heap growth')}</th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.rss', 'RSS growth')}</th>
              <th className="px-3 py-2 text-left">{translate('configs.moduleTelemetry.table.topOperation', 'Top operation')}</th>
              <th className="px-3 py-2 text-right">{translate('configs.moduleTelemetry.table.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <React.Fragment key={group.moduleId}>
                {group.stages.map((module, stageIndex) => {
                  const topOperation = module.topOperations[0]
                  const topSurface = module.surfaces[0]
                  return (
                    <tr
                      key={`${module.moduleId}:${module.stage}`}
                      className={stageIndex === 0 ? 'border-t' : 'border-t border-border/50'}
                    >
                      {stageIndex === 0 ? (
                        <td className="w-56 px-3 py-3 align-top" rowSpan={group.stages.length}>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium">{group.moduleId}</span>
                            <span className="text-xs text-muted-foreground">
                              {translate(
                                'configs.moduleTelemetry.table.stageCount',
                                '{{count}} stage rows',
                                { count: group.stages.length },
                              )}
                            </span>
                          </div>
                        </td>
                      ) : null}
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col gap-1">
                          <StageBadge stage={module.stage} translate={translate} />
                          <span className="text-xs text-muted-foreground">
                            {topSurface
                              ? translate(
                                'configs.moduleTelemetry.table.surfaceSummary',
                                '{{surface}} · {{calls}} calls',
                                { surface: topSurface.surface, calls: topSurface.calls },
                              )
                              : translate('configs.moduleTelemetry.table.noSurface', 'No surface data')}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <CandidateBadges module={module} translate={translate} />
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <div className="flex flex-col gap-1">
                          <span>{formatCount(module.calls)}</span>
                          {module.errors > 0 ? (
                            <span className="text-xs text-destructive">
                              {translate('configs.moduleTelemetry.table.errorCount', '{{count}} errors', { count: module.errors })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top text-right">{formatMs(module.p95DurationMs)}</td>
                      <td className="px-3 py-3 align-top text-right">{formatMs(module.totalCpuMs)}</td>
                      <td className="px-3 py-3 align-top text-right">{formatBytes(module.positiveHeapDeltaBytes)}</td>
                      <td className="px-3 py-3 align-top text-right">{formatBytes(module.positiveRssDeltaBytes)}</td>
                      <td className="px-3 py-3 align-top">
                        {topOperation ? (
                          <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                              <div className="flex cursor-default flex-col gap-1">
                                <span className="font-medium underline decoration-dotted decoration-muted-foreground underline-offset-2">
                                  {topOperation.operation}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {translate(
                                    'configs.moduleTelemetry.table.topOperationMeta',
                                    '{{surface}} · {{cpu}} CPU · {{calls}} calls',
                                    {
                                      surface: topOperation.surface,
                                      cpu: formatMs(topOperation.totalCpuUserMs + topOperation.totalCpuSystemMs),
                                      calls: topOperation.calls,
                                    },
                                  )}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="left" align="start" variant="light" className="max-w-none p-3">
                              <TopOperationsBreakdown operations={module.topOperations} translate={translate} />
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">{translate('configs.moduleTelemetry.table.none', 'None')}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-right">
                        <SimpleTooltip
                          content={translate('configs.moduleTelemetry.table.copyStats', 'Copy row stats for debugging')}
                          side="top"
                          align="center"
                          variant="light"
                        >
                          <IconButton
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={translate('configs.moduleTelemetry.table.copyStats', 'Copy row stats for debugging')}
                            onClick={() => copyRowStats(module, translate)}
                          >
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          </IconButton>
                        </SimpleTooltip>
                      </td>
                    </tr>
                  )
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}

function RangeModuleSection({
  modules,
  range,
  bucketIntervalMs,
  bucketsLabel,
  translate,
}: {
  modules: RangeModuleSummary[]
  range: UsageRange
  bucketIntervalMs?: number
  bucketsLabel: string
  translate: (key: string, fallback?: string, values?: Record<string, string | number>) => string
}) {
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{translate('configs.moduleTelemetry.modules.title', 'Modules')}</h3>
        <p className="text-sm text-muted-foreground">
          {translate(
            'configs.moduleTelemetry.modules.description',
            'Aggregated module stats from {{from}} to now across {{buckets}}. Startup and running rows are separated.',
            {
              from: formatRangeBoundary(range.startMs),
              buckets: bucketsLabel,
            },
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {translate(
            'configs.moduleTelemetry.modules.interval',
            'Startup is the first {{interval}} bucket after telemetry starts. Later buckets are running.',
            { interval: formatBucketInterval(bucketIntervalMs) },
          )}
        </p>
      </div>
      <RangeModuleTable modules={modules} translate={translate} />
    </div>
  )
}

export function ModuleTelemetryPanel() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, report: null })
  const [clearingTelemetry, setClearingTelemetry] = React.useState(false)
  const rangeParam = searchParams.get('range')
  const [usageRangePreset, setUsageRangePreset] = React.useState<UsageRangePreset>(() => readUsageRangePreset(searchParams))
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: 'configs-module-telemetry',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const clearMutationContext = React.useMemo(
    () => ({
      formId: 'configs-module-telemetry',
      resourceKind: 'configs.moduleTelemetry',
      retryLastMutation,
    }),
    [retryLastMutation],
  )

  const loadReport = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const report = await readApiResultOrThrow<ModuleTelemetryApiResponse>(API_PATH, undefined, {
        errorMessage: t('configs.moduleTelemetry.loadError', 'Failed to load module telemetry.'),
      })
      setState({ loading: false, error: null, report })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.moduleTelemetry.loadError', 'Failed to load module telemetry.')
      setState({ loading: false, error: message, report: null })
    }
  }, [t])

  React.useEffect(() => {
    loadReport().catch(() => {})
  }, [loadReport])

  React.useEffect(() => {
    const nextRange = readUsageRangePreset(searchParams)
    setUsageRangePreset((current) => current === nextRange ? current : nextRange)
  }, [rangeParam, searchParams])

  const handleUsageRangeChange = React.useCallback((value: UsageRangePreset) => {
    setUsageRangePreset(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set('range', value)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const handleRefresh = React.useCallback(() => {
    loadReport().catch(() => {})
  }, [loadReport])

  const handleClearTelemetry = React.useCallback(async () => {
    if (clearingTelemetry) return
    const confirmed = await confirm({
      title: t('configs.moduleTelemetry.clear.confirmTitle', 'Clear all telemetry data?'),
      text: t(
        'configs.moduleTelemetry.clear.confirmText',
        'This removes current module telemetry and local process telemetry files for this development instance.',
      ),
      confirmText: t('configs.moduleTelemetry.clear.confirmButton', 'Clear telemetry'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setClearingTelemetry(true)
    try {
      await runMutation({
        operation: () =>
          readApiResultOrThrow<ModuleTelemetryClearResponse>(
            API_PATH,
            { method: 'DELETE' },
            {
              errorMessage: t('configs.moduleTelemetry.clear.error', 'Failed to clear module telemetry.'),
              allowNullResult: true,
            },
          ),
        context: clearMutationContext,
        mutationPayload: {},
      })
      await loadReport()
      flash(t('configs.moduleTelemetry.clear.success', 'Module telemetry data cleared.'), 'success')
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.moduleTelemetry.clear.error', 'Failed to clear module telemetry.')
      flash(message, 'error')
    } finally {
      setClearingTelemetry(false)
    }
  }, [clearMutationContext, clearingTelemetry, confirm, loadReport, runMutation, t])

  if (state.loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.moduleTelemetry.title', 'Module telemetry')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.moduleTelemetry.description', 'Preview module-level resource attribution collected in this process.')}
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('configs.moduleTelemetry.loading', 'Loading module telemetry…')}
        </div>
      </section>
    )
  }

  if (state.error) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.moduleTelemetry.title', 'Module telemetry')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.moduleTelemetry.description', 'Preview module-level resource attribution collected in this process.')}
          </p>
        </header>
        <ErrorMessage label={state.error} />
        <Button type="button" variant="outline" onClick={() => loadReport().catch(() => {})}>
          {t('configs.moduleTelemetry.retry', 'Retry')}
        </Button>
      </section>
    )
  }

  const report = state.report
  if (!report) return null
  const usageRange = resolveUsageRange(usageRangePreset, report.buckets ?? [], report.startedAt)
  const rangeBuckets = bucketsInRange(report.buckets ?? [], usageRange)
  const rangeModules = aggregateRangeModules(rangeBuckets, report.thresholds)
  const bucketsLabel = bucketCountLabel(rangeBuckets, report.bucketIntervalMs, t)
  const telemetryStartedAtMs = firstAvailableTelemetryMs(report.buckets ?? [], Date.parse(report.startedAt), Date.now())

  return (
    <section className="space-y-6 rounded-lg border bg-background p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.moduleTelemetry.title', 'Module telemetry')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.moduleTelemetry.description', 'Preview module-level resource attribution collected in this process.')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'configs.moduleTelemetry.generatedAt',
              'Report generated {{timestamp}}',
              { timestamp: new Date(report.generatedAt).toLocaleString() },
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'configs.moduleTelemetry.startedAt',
              'Collecting since {{timestamp}}',
              { timestamp: new Date(telemetryStartedAtMs).toLocaleString() },
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {report.canClearTelemetry ? (
            <Button
              type="button"
              variant="destructive-outline"
              onClick={() => { void handleClearTelemetry() }}
              disabled={clearingTelemetry}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {clearingTelemetry
                ? t('configs.moduleTelemetry.clear.clearing', 'Clearing...')
                : t('configs.moduleTelemetry.clear.button', 'Clear all telemetry data')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('configs.moduleTelemetry.refresh', 'Refresh')}
          </Button>
        </div>
      </header>

      <RangeOverview
        buckets={rangeBuckets}
        modules={rangeModules}
        range={usageRange}
        rangePreset={usageRangePreset}
        onRangePresetChange={handleUsageRangeChange}
        bucketIntervalMs={report.bucketIntervalMs}
        translate={t}
      />
      <RangeModuleSection
        modules={rangeModules}
        range={usageRange}
        bucketIntervalMs={report.bucketIntervalMs}
        bucketsLabel={bucketsLabel}
        translate={t}
      />

      {ConfirmDialogElement}
    </section>
  )
}

export default ModuleTelemetryPanel
