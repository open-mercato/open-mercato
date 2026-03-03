import type { OperationProgressEvent } from '@open-mercato/shared/modules/widgets/injection-progress'
import type { ReindexLockType } from './reindex-lock'

type EventBusLike = {
  emit?: (event: string, payload: unknown) => Promise<void>
  emitEvent?: (event: string, payload: unknown, options?: { persistent?: boolean }) => Promise<void>
}

type ProgressStatus = OperationProgressEvent['status']

export const SEARCH_REINDEX_PROGRESS_EVENTS: Record<ReindexLockType, string> = {
  fulltext: 'search.reindex.fulltext.progress',
  vector: 'search.reindex.vector.progress',
}

const SEARCH_REINDEX_OPERATION_TYPES: Record<ReindexLockType, string> = {
  fulltext: 'search.reindex.fulltext',
  vector: 'search.reindex.vector',
}

function getOperationId(
  type: ReindexLockType,
  tenantId: string,
  organizationId?: string | null,
): string {
  return `${SEARCH_REINDEX_OPERATION_TYPES[type]}:${tenantId}:${organizationId ?? 'global'}`
}

export async function emitSearchReindexProgressEvent(
  eventBus: EventBusLike,
  params: {
    type: ReindexLockType
    tenantId: string
    organizationId?: string | null
    status: ProgressStatus
    action: string
    processedCount: number
    totalCount: number
    startedAt: number
  },
): Promise<void> {
  const payload: OperationProgressEvent & {
    tenantId: string
    organizationId?: string | null
    action: string
  } = {
    operationId: getOperationId(params.type, params.tenantId, params.organizationId),
    operationType: SEARCH_REINDEX_OPERATION_TYPES[params.type],
    status: params.status,
    progress: params.totalCount > 0
      ? Math.max(0, Math.min(100, Math.round((params.processedCount / params.totalCount) * 100)))
      : (params.status === 'completed' ? 100 : 0),
    processedCount: Math.max(0, params.processedCount),
    totalCount: Math.max(0, params.totalCount),
    currentStep: params.action,
    errors: 0,
    startedAt: params.startedAt,
    metadata: {
      reindexType: params.type,
    },
    tenantId: params.tenantId,
    organizationId: params.organizationId ?? null,
    action: params.action,
  }

  if (typeof eventBus.emitEvent === 'function') {
    await eventBus.emitEvent(SEARCH_REINDEX_PROGRESS_EVENTS[params.type], payload, { persistent: false })
    return
  }

  if (typeof eventBus.emit === 'function') {
    await eventBus.emit(SEARCH_REINDEX_PROGRESS_EVENTS[params.type], payload)
  }
}
