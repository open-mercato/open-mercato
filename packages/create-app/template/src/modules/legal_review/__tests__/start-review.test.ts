/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const findOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({ WorkflowInstance: class WorkflowInstance {} }))
jest.mock('../data/entities', () => ({ LegalMatter: class LegalMatter {} }))

import { startNdaReviewForMatter } from '../lib/startReview'
import { buildDefaultStartReviewForm, buildStartReviewPayload } from '../lib/startReviewForm'

const SCOPE = { tenantId: '0b4c1d2e-3f40-4a51-8b62-7c8d9e0f1a2b', organizationId: '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d' }
const MATTER_ID = '9b1d2c3e-4f50-4a61-8b72-0c1d2e3f4a5b'
const DOCUMENT_ID = '3f0b8f4e-7c55-4f4e-9d61-2f8a0c1b5d10'
const USER_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

function buildEm(activeRuns: number) {
  return {
    count: jest.fn().mockResolvedValue(activeRuns),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

describe('startNdaReviewForMatter', () => {
  beforeEach(() => findOneWithDecryption.mockReset())

  it('starts the NDA review run and moves a requested matter to review', async () => {
    const matter = { id: MATTER_ID, documentId: DOCUMENT_ID, requestedByUserId: USER_ID, stage: 'requested' }
    findOneWithDecryption.mockResolvedValue(matter)
    const em = buildEm(0)
    const startRun = jest.fn().mockResolvedValue({ id: 'instance-1' })

    const result = await startNdaReviewForMatter(em as unknown as EntityManager, SCOPE, MATTER_ID, startRun)

    expect(result).toEqual({ started: true, instanceId: 'instance-1', correlationKey: `legal_review:${DOCUMENT_ID}` })
    expect(startRun).toHaveBeenCalledWith({
      workflowId: 'legal_review_nda_review_v1',
      correlationKey: `legal_review:${DOCUMENT_ID}`,
      initialContext: { documentId: DOCUMENT_ID, playbookCode: 'nda-standard' },
      initiatedBy: USER_ID,
      scope: SCOPE,
    })
    expect(em.count.mock.calls[0][1]).toMatchObject({
      correlationKey: `legal_review:${DOCUMENT_ID}`,
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
    })
    expect(matter.stage).toBe('review')
    expect(em.flush).toHaveBeenCalled()
  })

  it('skips when a run with the same correlation key is already active', async () => {
    findOneWithDecryption.mockResolvedValue({ id: MATTER_ID, documentId: DOCUMENT_ID, requestedByUserId: null, stage: 'requested' })
    const em = buildEm(1)
    const startRun = jest.fn()

    const result = await startNdaReviewForMatter(em as unknown as EntityManager, SCOPE, MATTER_ID, startRun)

    expect(result).toEqual({ started: false, reason: 'already_running' })
    expect(startRun).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('skips when the matter is not in scope', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const startRun = jest.fn()
    const result = await startNdaReviewForMatter(buildEm(0) as unknown as EntityManager, SCOPE, MATTER_ID, startRun)
    expect(result).toEqual({ started: false, reason: 'matter_not_found' })
    expect(startRun).not.toHaveBeenCalled()
  })

  it('keeps a matter that is already past requested', async () => {
    const matter = { id: MATTER_ID, documentId: DOCUMENT_ID, requestedByUserId: null, stage: 'released' }
    findOneWithDecryption.mockResolvedValue(matter)
    const em = buildEm(0)
    await startNdaReviewForMatter(em as unknown as EntityManager, SCOPE, MATTER_ID, jest.fn().mockResolvedValue({ id: 'i' }))
    expect(matter.stage).toBe('released')
    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('start review form', () => {
  it('prefills a reference, US jurisdiction and a due date two days out', () => {
    const form = buildDefaultStartReviewForm(new Date(2026, 10, 12, 9, 0, 0), () => 0.5)
    expect(form).toMatchObject({ reference: 'LG-5500', jurisdiction: 'US', agreementType: 'mutual_nda', paper: 'counterparty', dueDate: '2026-11-14' })
  })

  it('builds the matter payload with the current user as requester and assignee', () => {
    const form = { ...buildDefaultStartReviewForm(new Date(2026, 10, 12)), counterparty: '  Northwind  ', purpose: '', jurisdiction: 'de' }
    const payload = buildStartReviewPayload(form, DOCUMENT_ID, USER_ID)
    expect(payload).toMatchObject({
      documentId: DOCUMENT_ID,
      counterparty: 'Northwind',
      purpose: null,
      jurisdiction: 'DE',
      requestedByUserId: USER_ID,
      assigneeUserId: USER_ID,
    })
    expect(typeof payload.dueAt).toBe('string')
  })
})
