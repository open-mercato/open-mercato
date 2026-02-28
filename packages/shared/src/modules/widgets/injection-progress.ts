/**
 * Async Operation Progress Types
 *
 * Standard contract for real-time progress tracking of long-running operations
 * (data sync imports, bulk exports, webhook replay). These events are delivered
 * via the DOM Event Bridge (clientBroadcast: true) and consumed by the
 * `useOperationProgress` hook.
 */

/**
 * Structured progress payload emitted by server-side workers.
 * Workers emit these as standard events with `clientBroadcast: true`.
 */
export interface OperationProgressEvent {
  /** Unique operation ID (e.g., syncRunId) */
  operationId: string
  /** Operation type identifier (e.g., 'sync.import', 'bulk.export') */
  operationType: string
  /** Current status of the operation */
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  /** Progress percentage (0-100) */
  progress: number
  /** Number of items processed so far */
  processedCount: number
  /** Total number of items to process */
  totalCount: number
  /** Human-readable current step name */
  currentStep?: string
  /** Number of errors encountered */
  errors: number
  /** Timestamp when the operation started */
  startedAt: number
  /** Additional operation-specific metadata */
  metadata?: Record<string, unknown>
}
