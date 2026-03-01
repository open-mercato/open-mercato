import type { EntityManager } from '@mikro-orm/postgresql'

export interface SyncCrudEventPayload {
  /** The full event ID (e.g., 'customers.person.creating') */
  eventId: string
  /** Entity identifier (e.g., 'customers.person') */
  entity: string
  /** CRUD operation */
  operation: 'create' | 'update' | 'delete'
  /** 'before' for *.creating/*.updating/*.deleting, 'after' for *.created/*.updated/*.deleted */
  timing: 'before' | 'after'
  /** Resource ID (null for create before-events) */
  resourceId?: string | null
  /** Mutation payload (the data being created/updated) */
  payload?: Record<string, unknown>
  /** For updates: entity data before the mutation */
  previousData?: Record<string, unknown>
  /** The mutated entity (only available for after-events) */
  entity_data?: Record<string, unknown>
  /** Current user ID */
  userId: string
  /** Current organization ID */
  organizationId: string | null
  /** Current tenant ID */
  tenantId: string
  /** Entity manager (read-only recommended) */
  em: EntityManager
  /** Original HTTP request */
  request: Request
}

export interface SyncCrudEventResult {
  /** If false, blocks the operation (before-events only). Default: true */
  ok?: boolean
  /** Error message when blocking */
  message?: string
  /** HTTP status code when blocking (default: 422) */
  status?: number
  /** Error body when blocking (overrides message) */
  body?: Record<string, unknown>
  /** Modified payload — merged into mutation data (before-events only) */
  modifiedPayload?: Record<string, unknown>
}
