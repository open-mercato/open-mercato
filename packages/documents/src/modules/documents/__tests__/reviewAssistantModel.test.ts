import {
  buildReviewAssistantPageContext,
  DEFAULT_REVIEW_ASSISTANT_PLACEMENT,
  readReviewAssistantPlacement,
  REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY,
  resolveReviewAssistantConversationId,
  settledAssistantAction,
  writeReviewAssistantPlacement,
} from '../backend/documents/[id]/reviewAssistantModel'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

const throwingStorage = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
}

const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const FINDING_ID = '55555555-5555-4555-8555-555555555555'

describe('review assistant placement persistence', () => {
  it('defaults to the rail and round-trips a stored placement', () => {
    const storage = memoryStorage()
    expect(readReviewAssistantPlacement(storage)).toBe(DEFAULT_REVIEW_ASSISTANT_PLACEMENT)
    writeReviewAssistantPlacement('dock', storage)
    expect(storage.values.get(REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY)).toBe('dock')
    expect(readReviewAssistantPlacement(storage)).toBe('dock')
  })

  it('ignores unknown values and storage that throws', () => {
    expect(readReviewAssistantPlacement(memoryStorage({ [REVIEW_ASSISTANT_PLACEMENT_STORAGE_KEY]: 'floating' }))).toBe('rail')
    expect(readReviewAssistantPlacement(throwingStorage)).toBe('rail')
    expect(() => writeReviewAssistantPlacement('dock', throwingStorage)).not.toThrow()
    expect(readReviewAssistantPlacement(null)).toBe('rail')
  })

  it('keeps one conversation id per document', () => {
    const storage = memoryStorage()
    let counter = 0
    const createId = () => `conversation-${++counter}`
    const first = resolveReviewAssistantConversationId(DOCUMENT_ID, storage, createId)
    expect(resolveReviewAssistantConversationId(DOCUMENT_ID, storage, createId)).toBe(first)
    expect(resolveReviewAssistantConversationId(FINDING_ID, storage, createId)).not.toBe(first)
    expect(resolveReviewAssistantConversationId(DOCUMENT_ID, throwingStorage, createId)).toMatch(/^conversation-/)
  })
})

describe('review assistant page context', () => {
  it('targets the document, or the active finding when one is selected', () => {
    expect(buildReviewAssistantPageContext({ documentId: DOCUMENT_ID, activeFindingId: null, locale: 'pl' })).toEqual(
      expect.objectContaining({ entityType: 'documents:document', recordId: DOCUMENT_ID, findingId: null, locale: 'pl' }),
    )
    expect(buildReviewAssistantPageContext({ documentId: DOCUMENT_ID, activeFindingId: FINDING_ID, locale: null })).toEqual(
      expect.objectContaining({ entityType: 'documents:document_finding', recordId: FINDING_ID, documentId: DOCUMENT_ID }),
    )
  })
})

describe('settled assistant actions', () => {
  const confirmed = {
    id: 'action-1',
    toolName: 'documents.apply_finding',
    status: 'confirmed',
    targetRecordId: FINDING_ID,
    executionResult: { recordId: FINDING_ID },
  }

  it('finishes a documents decision confirmed after this page saw it pending', () => {
    expect(settledAssistantAction(confirmed, true, new Set())).toEqual({
      pendingActionId: 'action-1',
      decision: 'apply',
      findingId: FINDING_ID,
    })
    expect(settledAssistantAction({ ...confirmed, toolName: 'documents.keep_finding' }, true, new Set())?.decision).toBe('keep')
  })

  it('never re-runs old, unrelated, unfinished or already handled actions', () => {
    expect(settledAssistantAction(confirmed, false, new Set())).toBeNull()
    expect(settledAssistantAction({ ...confirmed, status: 'failed' }, true, new Set())).toBeNull()
    expect(settledAssistantAction({ ...confirmed, toolName: 'customers.update_deal_stage' }, true, new Set())).toBeNull()
    expect(settledAssistantAction(confirmed, true, new Set(['action-1']))).toBeNull()
    expect(settledAssistantAction(null, true, new Set())).toBeNull()
  })
})
