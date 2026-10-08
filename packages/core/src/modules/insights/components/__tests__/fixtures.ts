import enDictionary from '../../i18n/en.json'
import type {
  ExplainCauseView,
  ExplainChainEntryView,
  ExplainFieldResponse,
  ExplainLogResponse,
  ExplainOverviewResponse,
  ExplainResourceDescriptorView,
  ExplainValueView,
} from '../../lib/client/types'

export const DICT: Record<string, string> = {
  ...enDictionary,
  'customers.insights.resources.deal': 'Deal',
  'customers.insights.fields.status': 'Status',
  'customers.insights.fields.title': 'Title',
}

export const DEAL_ID = '6f1c1d6e-1b2a-4c3d-8e9f-0a1b2c3d4e5f'
export const OTHER_DEAL_ID = '7a2d2e7f-2c3b-4d4e-9fa0-1b2c3d4e5f60'
export const LOG_NEWEST = '11111111-1111-4111-8111-111111111111'
export const LOG_OLDER = '22222222-2222-4222-8222-222222222222'
export const LOG_OLDEST = '33333333-3333-4333-8333-333333333333'

export function value(raw: unknown, overrides: Partial<ExplainValueView> = {}): ExplainValueView {
  return { value: raw, display: null, valueKind: 'dictionary', source: 'snapshot', redacted: false, ...overrides }
}

export function redactedValue(): ExplainValueView {
  return { value: null, display: null, valueKind: 'dictionary', source: 'snapshot', redacted: true }
}

export function cause(overrides: Partial<ExplainCauseView> = {}): ExplainCauseView {
  return {
    kind: 'user',
    id: null,
    ref: null,
    label: null,
    href: null,
    available: true,
    labelKey: 'insights.explain.causeKinds.user',
    legacy: false,
    derivedFromActor: false,
    frames: [],
    ...overrides,
  }
}

export function chainEntry(overrides: Partial<ExplainChainEntryView> = {}): ExplainChainEntryView {
  return {
    logId: LOG_NEWEST,
    at: '2026-10-01T10:15:00.000Z',
    state: 'done',
    action: 'update',
    commandId: 'customers.deals.update',
    from: value('open'),
    to: value('won'),
    actor: { kind: 'user', id: 'user-1', label: 'Alice Admin', isSelf: false, redacted: false },
    onBehalfOf: null,
    cause: cause(),
    causedBy: null,
    correlationId: '44444444-4444-4444-8444-444444444444',
    undoneBy: null,
    confidence: 'proven',
    ...overrides,
  }
}

export function fieldResponse(overrides: Partial<ExplainFieldResponse> = {}): ExplainFieldResponse {
  return {
    resourceKind: 'customers.deal',
    resourceId: DEAL_ID,
    field: 'status',
    itemId: null,
    labelKey: 'customers.insights.fields.status',
    current: { value: 'won', display: null, valueKind: 'dictionary' },
    verdict: 'explained',
    confidence: 'proven',
    summary: {
      key: 'insights.explain.summary.explained',
      params: { logId: LOG_NEWEST, causeKind: 'user', at: '2026-10-01T10:15:00.000Z', changes: 1 },
    },
    chain: [chainEntry()],
    gaps: [],
    hints: [],
    dependencies: [],
    page: { limit: 20, nextBefore: null, scanned: 1, truncated: false, continuation: false },
    viewer: { canSeeActors: true, canSeePastValues: true, canSeeOwnValues: true },
    ...overrides,
  }
}

export function overviewResponse(overrides: Partial<ExplainOverviewResponse> = {}): ExplainOverviewResponse {
  return {
    resourceKind: 'customers.deal',
    resourceId: DEAL_ID,
    fields: [
      {
        field: 'status',
        labelKey: 'customers.insights.fields.status',
        valueKind: 'dictionary',
        verdict: 'explained',
        confidence: 'proven',
        lastChangeAt: '2026-10-01T10:15:00.000Z',
      },
      {
        field: 'title',
        labelKey: 'customers.insights.fields.title',
        valueKind: 'text',
        verdict: 'no_history',
        confidence: 'unknown',
        lastChangeAt: null,
      },
    ],
    coverage: { scanned: 1, truncated: false, legacyRows: 0, causeKinds: { user: 1 }, noHistory: null, unloggedWriters: [] },
    viewer: { canSeeActors: true, canSeePastValues: true, canSeeOwnValues: true },
    ...overrides,
  }
}

export function logResponse(overrides: Partial<ExplainLogResponse> = {}): ExplainLogResponse {
  return {
    logId: LOG_NEWEST,
    at: '2026-10-01T10:15:00.000Z',
    resourceKind: 'customers.deal',
    resourceId: DEAL_ID,
    commandId: 'customers.deals.update',
    action: 'update',
    state: 'done',
    actor: { kind: 'user', id: 'user-1', label: 'Alice Admin', isSelf: false, redacted: false },
    onBehalfOf: null,
    cause: cause({ kind: 'workflow', id: 'wf-1', label: 'Order approval', href: '/backend/workflows/instances/wf-1', labelKey: 'insights.explain.causeKinds.workflow' }),
    causedBy: null,
    correlationId: null,
    confidence: 'proven',
    viewer: { canSeeActors: true, canSeePastValues: true, canSeeOwnValues: true },
    ...overrides,
  }
}

export function dealDescriptor(overrides: Partial<ExplainResourceDescriptorView> = {}): ExplainResourceDescriptorView {
  return {
    resourceKind: 'customers.deal',
    labelKey: 'customers.insights.resources.deal',
    formEntityIds: ['customers.deal'],
    fields: [
      { key: 'status', labelKey: 'customers.insights.fields.status', valueKind: 'dictionary', derived: false, dependsOn: [], provider: null },
      { key: 'title', labelKey: 'customers.insights.fields.title', valueKind: 'text', derived: false, dependsOn: [], provider: null },
    ],
    collections: [],
    customFields: null,
    noHistory: null,
    ...overrides,
  }
}

export type MockApiResult = {
  ok: boolean
  status: number
  result: unknown
  response: Response
  cacheStatus: null
}

export function apiOk(result: unknown): MockApiResult {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

export function apiStatus(status: number, result: unknown = { error: 'x' }): MockApiResult {
  return { ok: false, status, result, response: {} as Response, cacheStatus: null }
}

export type Deferred<TValue> = {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
}

export function deferred<TValue>(): Deferred<TValue> {
  let resolve: (value: TValue) => void = () => undefined
  const promise = new Promise<TValue>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
