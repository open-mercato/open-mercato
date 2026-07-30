import { type DateRangePreset, isValidDateRangePreset } from '@open-mercato/ui/backend/date-range'
import type { WidgetDataRequest } from '../../../services/widgetDataService'

// Deal statuses that mean the deal is closed and must stop counting as current pipeline.
//
// This is a denylist, not an allowlist: `customer_deals.status` is a lenient `text` column
// fed by the per-tenant `deal_status` dictionary, so a status unknown to code counts as OPEN
// and keeps contributing to the chart. That keeps tenant-specific stages visible and mirrors
// `customers/lib/interactionStatus.ts`, which treats an unknown interaction status as open.
//
// Every vocabulary that reaches the column has to be listed here:
//   - `win` / `loose` are written by the deal closure UI and the kanban board.
//   - `won` / `lost` are written verbatim by the `customers.update_deal_stage` AI tool, whose
//     free-form `toStage` is passed straight through to `status`.
//   - `closed` is a seeded `deal_status` dictionary value, persisted by the dashboards
//     analytics seed and treated as terminal by the demo-data generator.
export const CLOSED_DEAL_STATUSES = ['win', 'loose', 'won', 'lost', 'closed'] as const

// A deal is also closed when `closure_outcome` records the outcome, which the deals-summary
// KPI already treats as terminal: `api/deals/summary/route.ts` counts a deal as won or lost
// when EITHER `status` OR `closure_outcome` says so. The two columns can disagree — the CRUD
// API accepts `closureOutcome` on its own, and the AI tool writes `status` without ever setting
// it — so the chart has to test both signals to agree with those KPI cards (#4668).
//
// The `closure_outcome` side is expressed as `IS NULL` rather than as a `neq` denylist for two
// reasons, and swapping it for `neq` would be a silent regression:
//   - `closure_outcome` is nullable, and every OPEN deal holds NULL there. `neq` renders as
//     `column != ?`, and in SQL `NULL != 'won'` is NULL, not true — a `neq` filter would drop
//     every open deal and empty the chart. `status` has no such problem: it is `text not null
//     default 'open'`, which is why the status side stays a denylist.
//   - Unlike `status`, this column is not fed by a per-tenant dictionary. Every write path
//     validates it against the same closed `z.enum(['won', 'lost'])` (`data/validators.ts`,
//     `api/deals/[id]/route.ts`, `api/deals/[id]/stats/route.ts`), so a non-null value always
//     means closed and there is no tenant-specific vocabulary to keep visible.
export const OPEN_DEAL_CLOSURE_OUTCOME_FILTER = {
  field: 'closureOutcome',
  operator: 'is_null',
} as const

export const PIPELINE_STATUS_SCOPES = ['open', 'all'] as const

export type PipelineStatusScope = typeof PIPELINE_STATUS_SCOPES[number]

export type PipelineSummarySettings = {
  dateRange: DateRangePreset
  statusScope: PipelineStatusScope
}

export const DEFAULT_SETTINGS: PipelineSummarySettings = {
  dateRange: 'this_month',
  statusScope: 'open',
}

function isValidStatusScope(value: unknown): value is PipelineStatusScope {
  return typeof value === 'string' && (PIPELINE_STATUS_SCOPES as readonly string[]).includes(value)
}

export function hydrateSettings(raw: unknown): PipelineSummarySettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const obj = raw as Record<string, unknown>
  return {
    dateRange: isValidDateRangePreset(obj.dateRange) ? obj.dateRange : DEFAULT_SETTINGS.dateRange,
    statusScope: isValidStatusScope(obj.statusScope) ? obj.statusScope : DEFAULT_SETTINGS.statusScope,
  }
}

export function dehydrateSettings(settings: PipelineSummarySettings): Record<string, unknown> {
  return {
    dateRange: settings.dateRange,
    statusScope: settings.statusScope,
  }
}

export function buildPipelineDataRequest(settings: PipelineSummarySettings): WidgetDataRequest {
  const request: WidgetDataRequest = {
    entityType: 'customers:deals',
    metric: {
      field: 'valueAmount',
      aggregate: 'sum',
    },
    groupBy: {
      field: 'pipelineStage',
      resolveLabels: true,
    },
    dateRange: {
      field: 'createdAt',
      preset: settings.dateRange,
    },
  }

  if (settings.statusScope === 'open') {
    request.filters = [
      ...CLOSED_DEAL_STATUSES.map((status) => ({
        field: 'status',
        operator: 'neq' as const,
        value: status,
      })),
      { ...OPEN_DEAL_CLOSURE_OUTCOME_FILTER },
    ]
  }

  return request
}
