import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryOptions, QueryResult } from './types'

/**
 * Payload passed to synchronous query lifecycle subscribers.
 *
 * Before-event (`*.querying`): `result` is undefined.
 * After-event (`*.queried`): `result` contains the query output.
 */
export interface SyncQueryEventPayload {
  eventId: string
  entity: string
  timing: 'before' | 'after'
  engine: 'basic' | 'hybrid'
  query: QueryOptions
  result?: QueryResult<Record<string, unknown>>
  userId?: string
  organizationId?: string | null
  tenantId: string
  em: EntityManager
}

/**
 * Return value from synchronous query lifecycle subscribers.
 *
 * Before-event subscribers may block (`ok: false`) or modify query options.
 * After-event subscribers may modify the query result.
 */
export interface SyncQueryEventResult {
  ok?: boolean
  message?: string
  status?: number
  modifiedQuery?: Partial<QueryOptions>
  modifiedResult?: QueryResult<Record<string, unknown>>
}
