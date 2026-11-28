import { loadEntityRecordScope } from '@open-mercato/shared/lib/db/recordScope'
import type { Queue } from '@open-mercato/queue'
import type { FulltextIndexJobPayload } from '../../../queue/fulltext-indexing'
import { searchDebugWarn, searchError } from '../../../lib/debug'

export const metadata = { event: 'search.index_record', persistent: false }

type Payload = {
  entityId?: string
  recordId?: string
  organizationId?: string | null
  tenantId?: string | null
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
  const entityType = String(payload?.entityId ?? '')
  const recordId = String(payload?.recordId ?? '')

  if (!entityType || !recordId) {
    return
  }

  let organizationId = payload?.organizationId ?? null
  let tenantId = payload?.tenantId ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let em: any | null = null
  try {
    em = ctx.resolve('em')
  } catch {
    em = null
  }

  // Resolve missing scope from DB if needed (same pattern as vector_upsert.ts)
  if ((organizationId == null || tenantId == null) && em) {
    try {
      const lookupEm = typeof em.fork === 'function' ? em.fork() : em
      const scope = await loadEntityRecordScope(lookupEm, entityType, recordId)
      if (organizationId == null) organizationId = scope?.organizationId ?? organizationId
      if (tenantId == null) tenantId = scope?.tenantId ?? tenantId
    } catch {
      // Ignore lookup errors
    }
  }

  if (!tenantId) {
    return
  }

  // The auto-indexing switch (OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING and its tenant setting)
  // is vector-only, so it must not stop full-text records from being queued.
  let queue: Queue<FulltextIndexJobPayload>
  try {
    queue = ctx.resolve<Queue<FulltextIndexJobPayload>>('fulltextIndexQueue')
  } catch {
    searchDebugWarn('search.fulltext', 'fulltextIndexQueue not available, skipping fulltext indexing')
    return
  }

  try {
    await queue.enqueue({
      jobType: 'index',
      entityType,
      recordId,
      tenantId: String(tenantId),
      organizationId: organizationId ? String(organizationId) : null,
    })
  } catch (error) {
    searchError('search.fulltext', 'Failed to enqueue fulltext index job', {
      entityType,
      recordId,
      error: error instanceof Error ? error.message : error,
    })
    throw error
  }
}
