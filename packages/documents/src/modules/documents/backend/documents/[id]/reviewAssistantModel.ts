import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { REVIEW_ASSISTANT_TOOL_NAMES } from '../../../lib/reviewAssistantIds'

export type ReviewAssistantPlacement = 'rail' | 'dock'

export const REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY = 'om:documents:review-assistant:placement:v1'
const CONVERSATION_STORAGE_PREFIX = 'om:documents:review-assistant:conversation:v1:'
export const DEFAULT_REVIEW_ASSISTANT_PLACEMENT: ReviewAssistantPlacement = 'rail'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function isReviewAssistantPlacement(value: unknown): value is ReviewAssistantPlacement {
  return value === 'rail' || value === 'dock'
}

export function readReviewAssistantPlacement(storage?: StorageLike | null): ReviewAssistantPlacement {
  try {
    const value = resolveStorage(storage)?.getItem(REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY)
    return isReviewAssistantPlacement(value) ? value : DEFAULT_REVIEW_ASSISTANT_PLACEMENT
  } catch {
    return DEFAULT_REVIEW_ASSISTANT_PLACEMENT
  }
}

export function writeReviewAssistantPlacement(
  placement: ReviewAssistantPlacement,
  storage?: StorageLike | null,
): void {
  try {
    resolveStorage(storage)?.setItem(REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY, placement)
  } catch {
    return
  }
}

function makeConversationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

/**
 * One assistant conversation per document, remembered in this browser so the
 * chat history comes back when the document is reopened.
 */
export function resolveReviewAssistantConversationId(
  documentId: string,
  storage?: StorageLike | null,
  createId: () => string = makeConversationId,
): string {
  const key = `${CONVERSATION_STORAGE_PREFIX}${documentId}`
  const target = resolveStorage(storage)
  try {
    const existing = target?.getItem(key)
    if (existing && existing.length <= 128) return existing
  } catch {
    return createId()
  }
  const created = createId()
  try {
    target?.setItem(key, created)
  } catch {
    return created
  }
  return created
}

export type ReviewAssistantPageContext = {
  view: 'documents.document.review'
  entityType: string
  recordId: string
  documentId: string
  findingId: string | null
  locale: string | null
}

export function buildReviewAssistantPageContext(input: {
  documentId: string
  activeFindingId: string | null
  locale: string | null
}): ReviewAssistantPageContext {
  return {
    view: 'documents.document.review',
    entityType: input.activeFindingId ? DOCUMENTS_ENTITY_IDS.documentFinding : DOCUMENTS_ENTITY_IDS.document,
    recordId: input.activeFindingId ?? input.documentId,
    documentId: input.documentId,
    findingId: input.activeFindingId,
    locale: input.locale,
  }
}

export type ReviewAssistantDecision = 'apply' | 'keep' | 'reopen'

const DECISION_BY_TOOL: Record<string, ReviewAssistantDecision> = {
  [REVIEW_ASSISTANT_TOOL_NAMES.applyFinding]: 'apply',
  [REVIEW_ASSISTANT_TOOL_NAMES.keepFinding]: 'keep',
  [REVIEW_ASSISTANT_TOOL_NAMES.reopenFinding]: 'reopen',
}

export function reviewAssistantDecisionForTool(toolName: string | null | undefined): ReviewAssistantDecision | null {
  return toolName ? DECISION_BY_TOOL[toolName] ?? null : null
}

export type SettledAssistantAction = {
  pendingActionId: string
  decision: ReviewAssistantDecision
  findingId: string
}

/**
 * Decides whether an observed pending-action state is a decision this page must
 * finish: the action must be a documents finding decision this client watched
 * while it was still pending (a reload of an old transcript never re-applies),
 * that has just been confirmed, and was not handled yet.
 */
export function settledAssistantAction(
  action: {
    id: string
    toolName: string
    status: string
    targetRecordId?: string | null
    executionResult?: { recordId?: string } | null
  } | null,
  observedPending: boolean,
  handled: ReadonlySet<string>,
): SettledAssistantAction | null {
  if (!action || !observedPending || action.status !== 'confirmed' || handled.has(action.id)) return null
  const decision = reviewAssistantDecisionForTool(action.toolName)
  if (!decision) return null
  const findingId = action.executionResult?.recordId ?? action.targetRecordId ?? null
  if (!findingId) return null
  return { pendingActionId: action.id, decision, findingId }
}
