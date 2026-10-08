import { hasAllFeatures } from '@open-mercato/shared/security/features'
import type { CausationEnvelope } from '@open-mercato/shared/lib/causation/types'
import type {
  ExplainLoadContext,
  ExplainModuleConfig,
} from '@open-mercato/shared/modules/insights/explain'
import type {
  ActionLogFieldHistoryEntry,
  ActionLogFieldHistoryQuery,
  ActionLogScopeReference,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { registerExplainConfigEntries, resetExplainRegistryForTests } from '../lib/explain-registry'
import { ExplainService } from '../services/explainService'
import type { ExplainViewer } from '../lib/viewer'

export const TENANT_ID = '11111111-0000-4000-8000-000000000001'
export const ORG_A = '22222222-0000-4000-8000-00000000000a'
export const ORG_B = '22222222-0000-4000-8000-00000000000b'
export const VIEWER_ID = '33333333-0000-4000-8000-000000000001'
export const OTHER_USER_ID = '33333333-0000-4000-8000-000000000002'
export const DEAL_ID = '44444444-0000-4000-8000-000000000001'
export const OTHER_ORG_DEAL_ID = '44444444-0000-4000-8000-000000000002'
export const WORKFLOW_ID = '55555555-0000-4000-8000-000000000001'
export const CORRELATION_ID = '66666666-0000-4000-8000-000000000001'

let logCounter = 0

export function testLogId(): string {
  logCounter += 1
  return `77777777-0000-4000-8000-${String(logCounter).padStart(12, '0')}`
}

export type DealRow = {
  id: string
  organizationId: string
  status: string
  updatedAt: string
  ownerUserId?: string | null
  'cf:priority'?: string | null
}

export const deals: Record<string, DealRow> = {}

export function resetDeals(): void {
  for (const key of Object.keys(deals)) delete deals[key]
  deals[DEAL_ID] = { id: DEAL_ID, organizationId: ORG_A, status: 'won', updatedAt: '2026-10-08T08:00:00.000Z', 'cf:priority': 'high' }
  deals[OTHER_ORG_DEAL_ID] = { id: OTHER_ORG_DEAL_ID, organizationId: ORG_B, status: 'open', updatedAt: '2026-10-08T08:00:00.000Z' }
}

async function loadDealCurrent(ctx: ExplainLoadContext, id: string): Promise<Record<string, unknown> | null> {
  const deal = deals[id.toLowerCase()]
  if (!deal) return null
  if (ctx.scope.organizationIds !== null && !ctx.scope.organizationIds.includes(deal.organizationId)) return null
  return { ...deal }
}

export const workflowResolver = jest.fn(async (_ctx: ExplainLoadContext, ids: string[]) => ids.map((id) => ({
  kind: 'workflow' as const,
  id,
  label: `Workflow ${id.slice(0, 4)}`,
  href: `/backend/instances/${id}`,
  organizationId: id === WORKFLOW_ID ? ORG_A : ORG_B,
})))

export const statusReferenceResolver = jest.fn(async (_ctx: ExplainLoadContext, ids: string[]) => ids.map((id) => ({
  kind: 'test.status',
  id,
  label: `Label ${id}`,
  href: null,
  organizationId: ORG_A as string | null,
})))

export function testExplainConfig(): ExplainModuleConfig {
  return {
    version: 1,
    resources: [{
      resourceKind: 'test.deal',
      labelKey: 'test.deal',
      requiredFeatures: ['test.deals.view'],
      loadCurrent: loadDealCurrent,
      fields: [
        {
          key: 'status',
          labelKey: 'test.fields.status',
          valueKind: 'enum',
          snapshotPaths: ['deal.status'],
          currentPath: 'status',
          referenceKind: 'test.status',
        },
        {
          key: 'secret',
          labelKey: 'test.fields.secret',
          valueKind: 'text',
          snapshotPaths: ['deal.secret'],
          requiredFeatures: ['test.deals.secret'],
        },
      ],
      customFields: { entityId: 'test:deal', snapshotContainers: ['custom'], allowKeys: ['priority'] },
      collections: [{
        key: 'lines',
        labelKey: 'test.lines',
        snapshotPath: 'lines',
        itemIdPath: 'id',
        fields: [{ key: 'price', labelKey: 'test.lines.price', valueKind: 'money', snapshotPaths: ['price'] }],
      }],
    }],
    causeResolvers: [{ kind: 'workflow', requiredFeatures: ['workflows.instances.view'], resolve: workflowResolver }],
    referenceResolvers: [{ kind: 'test.status', requiredFeatures: ['test.deals.view'], resolve: statusReferenceResolver }],
  }
}

export function registerTestExplainConfig(config: ExplainModuleConfig = testExplainConfig()): void {
  resetExplainRegistryForTests()
  registerExplainConfigEntries([{ moduleId: 'test', config }])
}

export function workflowEnvelope(): CausationEnvelope {
  return { correlationId: CORRELATION_ID, frames: [{ kind: 'user' }, { kind: 'workflow', id: WORKFLOW_ID, ref: 'approve' }] }
}

export function historyEntry(overrides: Partial<ActionLogFieldHistoryEntry> & { from?: string; to?: string } = {}): ActionLogFieldHistoryEntry {
  const { from = 'open', to = 'won', ...rest } = overrides
  const logId = rest.logId ?? testLogId()
  const at = rest.at ?? '2026-10-08T07:00:00.000Z'
  return {
    logId,
    at,
    cursorAt: at.replace(/Z$/, '000Z'),
    commandId: 'test.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: OTHER_USER_ID,
    resourceKind: 'test.deal',
    resourceId: DEAL_ID,
    changedFields: ['deal.status'],
    snapshotBefore: { deal: { status: from } },
    snapshotAfter: { deal: { status: to } },
    changes: { 'deal.status': { from, to } },
    causeKind: 'workflow',
    causeId: WORKFLOW_ID,
    organizationId: ORG_A,
    actionLabel: 'Update deal',
    onBehalfOfUserId: null,
    parentResourceKind: null,
    parentResourceId: null,
    correlationId: CORRELATION_ID,
    causedByLogId: null,
    causation: workflowEnvelope(),
    historyAction: null,
    sourceLogId: null,
    actorKind: 'user',
    ...rest,
  }
}

export type HistoryStore = {
  entries: ActionLogFieldHistoryEntry[]
  scopes: ActionLogScopeReference[]
}

export function createActionLogServiceMock(store: HistoryStore) {
  const inScope = (entry: { organizationId: string | null }, organizationIds: string[] | null) =>
    organizationIds === null || (entry.organizationId !== null && organizationIds.includes(entry.organizationId))
  return {
    findFieldHistory: jest.fn(async (query: ActionLogFieldHistoryQuery) => {
      if (Array.isArray(query.organizationIds) && query.organizationIds.length === 0) return { entries: [], nextBefore: null }
      const matching = store.entries
        .filter((entry) => inScope(entry, query.organizationIds))
        .filter((entry) => (
          (query.resourceKinds.includes(entry.resourceKind ?? '') && entry.resourceId === query.resourceId)
          || (query.includeChildren === true
            && query.resourceKinds.includes(entry.parentResourceKind ?? '')
            && entry.parentResourceId === query.resourceId)
        ))
        .sort((left, right) => right.at.localeCompare(left.at) || right.logId.localeCompare(left.logId))
      const startIndex = query.before
        ? matching.findIndex((entry) => entry.logId === query.before?.id) + 1
        : 0
      const slice = matching.slice(startIndex, startIndex + query.limit)
      const last = slice.at(-1)
      return {
        entries: slice,
        nextBefore: slice.length === query.limit && last ? { at: last.cursorAt, id: last.logId } : null,
      }
    }),
    findHistoryEntryById: jest.fn(async (params: { tenantId: string; organizationIds: string[] | null; id: string }) => {
      if (Array.isArray(params.organizationIds) && params.organizationIds.length === 0) return null
      const entry = store.entries.find((candidate) => candidate.logId === params.id)
      if (!entry || !inScope(entry, params.organizationIds)) return null
      return entry
    }),
    findLogScopes: jest.fn(async (params: { tenantId: string; ids: string[] }) =>
      store.scopes.filter((scope) => params.ids.includes(scope.id)),
    ),
  }
}

export type GrantedFeatures = (organizationId: string | null) => string[]

export function createRbacMock(granted: GrantedFeatures) {
  return {
    userHasAllFeatures: jest.fn(async (
      _userId: string,
      required: string[],
      scope: { tenantId: string | null; organizationId: string | null },
    ) => hasAllFeatures(granted(scope.organizationId), required)),
  }
}

export function buildViewer(overrides: Partial<ExplainViewer> = {}): ExplainViewer {
  return {
    auth: { sub: VIEWER_ID, tenantId: TENANT_ID, orgId: ORG_A },
    subject: { kind: 'user', storageId: VIEWER_ID, subject: VIEWER_ID },
    tenantId: TENANT_ID,
    organizationIds: [ORG_A],
    rbacOrganizationId: ORG_A,
    locale: 'en',
    ...overrides,
  }
}

export function buildService(
  store: HistoryStore,
  granted: GrantedFeatures,
  options: { now?: Date; scanMax?: number } = {},
) {
  const actionLogService = createActionLogServiceMock(store)
  const rbacService = createRbacMock(granted)
  const now = options.now ?? new Date('2026-10-08T12:00:00.000Z')
  const service = new ExplainService({
    em: {} as never,
    rbacService: rbacService as never,
    actionLogService: actionLogService as never,
    now: () => now,
    scanMax: options.scanMax ?? 500,
  })
  return { service, actionLogService, rbacService }
}
