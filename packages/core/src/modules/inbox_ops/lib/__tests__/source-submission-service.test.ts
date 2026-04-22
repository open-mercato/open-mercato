/** @jest-environment node */

import {
  applyNormalizedInputToSubmission,
  buildDescriptorFromSubmission,
  buildSourceDedupKey,
  submitSourceSubmission,
} from '../source-submission-service'
import { InboxSourceSubmission } from '../../data/entities'

const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const SOURCE_ENTITY_ID = '22222222-2222-4222-8222-222222222222'
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111'

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEmitInboxOpsEvent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmitInboxOpsEvent(...args),
}))

const mockCreate = jest.fn()
const mockPersist = jest.fn()
const mockFlush = jest.fn()

const mockEm = {
  create: mockCreate,
  persist: mockPersist,
  flush: mockFlush,
}

function makeDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    sourceEntityType: 'inbox_ops:inbox_email',
    sourceEntityId: SOURCE_ENTITY_ID,
    sourceVersion: 'version-1',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

describe('source-submission-service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
    mockFlush.mockResolvedValue(undefined)
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
  })

  it('builds a stable dedup key from the source descriptor identity', () => {
    const descriptor = makeDescriptor()

    expect(buildSourceDedupKey(descriptor)).toBe(buildSourceDedupKey(descriptor))
    expect(buildSourceDedupKey(descriptor)).not.toBe(
      buildSourceDedupKey(makeDescriptor({ sourceVersion: 'version-2' })),
    )
  })

  it('creates a new source submission and emits the received event', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce(null)

    const normalizedInput = {
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      sourceVersion: 'version-1',
      title: 'Order request',
      body: 'Hello, I would like to order 10 widgets.',
      bodyFormat: 'text',
      participants: [],
      capabilities: {
        canDraftReply: true,
        canUseTimelineContext: true,
      },
      sourceMetadata: {
        messageId: '<msg-001@example.com>',
      },
    }

    const { submission, created } = await submitSourceSubmission(mockEm as never, {
      submissionId: SUBMISSION_ID,
      descriptor: makeDescriptor(),
      legacyInboxEmailId: SOURCE_ENTITY_ID,
      metadata: { source: 'webhook' },
      initialNormalizedInput: normalizedInput,
      initialSourceSnapshot: { subject: 'Order request' },
    })

    expect(created).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(
      InboxSourceSubmission,
      expect.objectContaining({
        id: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: SOURCE_ENTITY_ID,
        sourceVersion: 'version-1',
        sourceDedupKey: buildSourceDedupKey(makeDescriptor()),
        legacyInboxEmailId: SOURCE_ENTITY_ID,
        metadata: { source: 'webhook' },
      }),
    )
    expect(mockPersist).toHaveBeenCalledWith(submission)
    expect(mockFlush).toHaveBeenCalled()
    expect(submission.normalizedBody).toBe(normalizedInput.body)
    expect(submission.normalizedSourceMetadata).toEqual(normalizedInput.sourceMetadata)
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.source_submission.received',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: SOURCE_ENTITY_ID,
      }),
    )
  })

  it('returns an existing submission and emits deduplicated when the dedup key already exists', async () => {
    const existingSubmission = {
      id: SUBMISSION_ID,
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      sourceVersion: 'version-1',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      legacyInboxEmailId: SOURCE_ENTITY_ID,
    }
    mockFindOneWithDecryption.mockResolvedValueOnce(existingSubmission)

    const result = await submitSourceSubmission(mockEm as never, {
      descriptor: makeDescriptor(),
    })

    expect(result).toEqual({ submission: existingSubmission, created: false })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockPersist).not.toHaveBeenCalled()
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.source_submission.deduplicated',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:inbox_email',
      }),
    )
  })

  it('re-loads the winning submission on unique-key races and emits deduplicated', async () => {
    const existingSubmission = {
      id: SUBMISSION_ID,
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      sourceVersion: 'version-1',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      legacyInboxEmailId: SOURCE_ENTITY_ID,
    }

    mockFindOneWithDecryption
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingSubmission)
    mockFlush.mockRejectedValueOnce({ code: '23505' })

    const result = await submitSourceSubmission(mockEm as never, {
      descriptor: makeDescriptor(),
    })

    expect(result).toEqual({ submission: existingSubmission, created: false })
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.source_submission.deduplicated',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
      }),
    )
  })

  it('maps normalized source input fields onto the submission record', () => {
    const submission = {
      normalizedTitle: null,
      normalizedBody: null,
      normalizedBodyFormat: null,
      normalizedParticipants: null,
      normalizedTimeline: null,
      normalizedAttachments: null,
      normalizedCapabilities: null,
      facts: null,
      normalizedSourceMetadata: null,
    } as never

    applyNormalizedInputToSubmission(submission, {
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      title: 'Order request',
      body: 'Hello',
      bodyFormat: 'text',
      participants: [],
      capabilities: {
        canDraftReply: false,
        canUseTimelineContext: false,
      },
      facts: { urgent: true },
      sourceMetadata: { source: 'manual' },
    })

    expect(submission).toEqual(expect.objectContaining({
      normalizedTitle: 'Order request',
      normalizedBody: 'Hello',
      normalizedBodyFormat: 'text',
      normalizedParticipants: [],
      normalizedCapabilities: {
        canDraftReply: false,
        canUseTimelineContext: false,
      },
      facts: { urgent: true },
      normalizedSourceMetadata: { source: 'manual' },
    }))
  })

  it('reconstructs a source descriptor from a submission row', () => {
    const descriptor = buildDescriptorFromSubmission({
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      sourceArtifactId: null,
      sourceVersion: 'version-1',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      requestedByUserId: null,
      triggerEventId: null,
    } as never)

    expect(descriptor).toEqual({
      sourceEntityType: 'inbox_ops:inbox_email',
      sourceEntityId: SOURCE_ENTITY_ID,
      sourceArtifactId: undefined,
      sourceVersion: 'version-1',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      requestedByUserId: undefined,
      triggerEventId: undefined,
    })
  })
})
