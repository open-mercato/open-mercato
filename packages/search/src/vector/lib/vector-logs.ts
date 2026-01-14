import type { EntityManager } from '@mikro-orm/postgresql'
import { recordIndexerLog } from '@/lib/indexers/status-log'
import type { VectorIndexOperationResult } from '../services/vector-index.service'

type LogArgs = {
  em?: EntityManager | null
  handler: string
  entityType: string
  recordId: string
  result: VectorIndexOperationResult | null | undefined
  source?: 'vector' | 'query_index'
}

export async function logVectorOperation({
  em,
  handler,
  entityType,
  recordId,
  result,
  source = 'vector',
}: LogArgs): Promise<void> {
  if (!result) return
  const action = result.action
  if (action !== 'indexed' && action !== 'deleted') return
  if (action === 'deleted' && !result.existed) return

  const op =
    action === 'indexed'
      ? result.created ? 'created' : 'updated'
      : 'removed'
  const message = `Vector embedding ${op} for ${entityType}#${recordId}`

  await recordIndexerLog(
    { em: em ?? undefined },
    {
      source,
      handler,
      message,
      entityType,
      recordId,
      tenantId: result.tenantId ?? null,
      organizationId: result.organizationId ?? null,
      details: result,
    },
  ).catch(() => undefined)
}
