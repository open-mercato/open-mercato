/**
 * Shared props + payload shapes for the Phase 3 mutation-approval cards
 * (Step 5.10).
 *
 * The cards render the server-emitted `AiPendingAction` row via the
 * `@open-mercato/ai-assistant` serializer. Re-declared here by structure
 * rather than imported to keep `packages/ui` free of server-only imports.
 * The shape mirrors `SerializedPendingAction` from
 * `@open-mercato/ai-assistant/modules/ai_assistant/lib/pending-action-client`.
 */

export type AiPendingActionCardStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'expired'
  | 'executing'
  | 'failed'

export type AiPendingActionCardFieldDiff = {
  field: string
  before: unknown
  after: unknown
}

export type AiPendingActionCardRecordDiff = {
  recordId: string
  entityType: string
  label: string
  fieldDiff: AiPendingActionCardFieldDiff[]
  recordVersion?: string | null
  attachmentIds?: string[]
}

export type AiPendingActionCardFailedRecord = {
  recordId: string
  error: { code: string; message: string }
}

export type AiPendingActionCardExecutionErrorDetails = {
  issues?: Array<{
    path?: (string | number)[]
    message?: string
    code?: string
    expected?: string
    received?: string
  }>
  fieldErrors?: Record<string, string[]>
  cause?: unknown
  [key: string]: unknown
}

export type AiPendingActionCardExecutionResult = {
  recordId?: string
  commandName?: string
  error?: {
    code: string
    message: string
    name?: string
    details?: AiPendingActionCardExecutionErrorDetails
    input?: unknown
    stack?: string
  }
}

export interface AiPendingActionCardAction {
  id: string
  agentId: string
  toolName: string
  status: AiPendingActionCardStatus
  fieldDiff: AiPendingActionCardFieldDiff[]
  records: AiPendingActionCardRecordDiff[] | null
  failedRecords: AiPendingActionCardFailedRecord[] | null
  sideEffectsSummary: string | null
  attachmentIds: string[]
  targetEntityType: string | null
  targetRecordId: string | null
  recordVersion: string | null
  executionResult: AiPendingActionCardExecutionResult | null
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
  resolvedByUserId: string | null
}
