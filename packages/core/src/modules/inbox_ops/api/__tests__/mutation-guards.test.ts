const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const proposalId = '44444444-4444-4444-8444-444444444444'
const actionId = '55555555-5555-4555-8555-555555555555'
const emailId = '66666666-6666-4666-8666-666666666666'

const flushMock = jest.fn()
const nativeUpdateMock = jest.fn()

const container = { resolve: jest.fn() }

const ctx = {
  auth: { sub: userId, tenantId, orgId: organizationId },
  userId,
  tenantId,
  organizationId,
  scope: { tenantId, organizationId },
  em: { flush: flushMock, nativeUpdate: nativeUpdateMock },
  container,
  eventBus: null,
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

const resolveProposalMock = jest.fn()
const resolveActionAndProposalMock = jest.fn()
const extractPathSegmentMock = jest.fn()
const acceptAllActionsMock = jest.fn()
const emitInboxOpsEventMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

class UnauthorizedError extends Error {}

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenant: string, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../routeHelpers', () => ({
  resolveRequestContext: jest.fn(async () => ctx),
  resolveProposal: (...args: unknown[]) => resolveProposalMock(...args),
  resolveActionAndProposal: (...args: unknown[]) => resolveActionAndProposalMock(...args),
  resolveCrossModuleEntities: jest.fn(() => ({})),
  toExecutionContext: jest.fn(() => ({})),
  extractPathSegment: (...args: unknown[]) => extractPathSegmentMock(...args),
  handleRouteError: jest.fn((err: unknown, label: string) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 })
  }),
  isErrorResponse: jest.fn((value: unknown) => {
    const { NextResponse } = require('next/server')
    return value instanceof NextResponse
  }),
  UnauthorizedError,
}))

jest.mock('../../lib/cache', () => ({
  resolveCache: jest.fn(() => ({})),
  invalidateCountsCache: jest.fn(async () => undefined),
}))

jest.mock('../../lib/executionEngine', () => ({
  acceptAllActions: (...args: unknown[]) => acceptAllActionsMock(...args),
}))

jest.mock('../../events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => emitInboxOpsEventMock(...args),
}))

import { POST as categorizePost } from '../proposals/[id]/categorize/route'
import { PATCH as actionPatch } from '../proposals/[id]/actions/[actionId]/route'
import { POST as acceptAllPost } from '../proposals/[id]/accept-all/route'
import { DELETE as emailDelete } from '../emails/[id]/route'

const guardAllow = { ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } }
const guardDeny = { ok: false, status: 423, body: { error: 'locked' } }

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('inbox_ops custom write routes wire the mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    validateCrudMutationGuardMock.mockResolvedValue(guardAllow)
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
    flushMock.mockResolvedValue(undefined)
    nativeUpdateMock.mockResolvedValue(1)
    resolveProposalMock.mockResolvedValue({ id: proposalId, category: 'inquiry' })
    resolveActionAndProposalMock.mockResolvedValue({
      action: { id: actionId, proposalId, status: 'pending', actionType: 'unknown_type', payload: {} },
      proposal: { id: proposalId },
    })
    extractPathSegmentMock.mockReturnValue(emailId)
    acceptAllActionsMock.mockResolvedValue({ results: [{ success: true }], stoppedOnFailure: false })
    emitInboxOpsEventMock.mockResolvedValue(undefined)
  })

  describe('categorize proposal', () => {
    it('validates the guard before mutating and runs the after-success hook', async () => {
      const response = await categorizePost(
        jsonRequest(`http://localhost/api/inbox_ops/proposals/${proposalId}/categorize`, 'POST', { category: 'order' }),
      )

      expect(response.status).toBe(200)
      const validateOrder = validateCrudMutationGuardMock.mock.invocationCallOrder[0]
      const flushOrder = flushMock.mock.invocationCallOrder[0]
      expect(validateOrder).toBeLessThan(flushOrder)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          tenantId,
          organizationId,
          userId,
          resourceKind: 'inbox_ops:inbox_proposal',
          resourceId: proposalId,
          operation: 'update',
        }),
      )
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'inbox_ops:inbox_proposal', resourceId: proposalId }),
      )
    })

    it('returns the guard rejection and does not mutate', async () => {
      validateCrudMutationGuardMock.mockResolvedValue(guardDeny)

      const response = await categorizePost(
        jsonRequest(`http://localhost/api/inbox_ops/proposals/${proposalId}/categorize`, 'POST', { category: 'order' }),
      )

      expect(response.status).toBe(423)
      expect(flushMock).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })
  })

  describe('edit action payload', () => {
    it('validates the guard before mutating and runs the after-success hook', async () => {
      const response = await actionPatch(
        jsonRequest(
          `http://localhost/api/inbox_ops/proposals/${proposalId}/actions/${actionId}`,
          'PATCH',
          { payload: { note: 'updated' } },
        ),
      )

      expect(response.status).toBe(200)
      const validateOrder = validateCrudMutationGuardMock.mock.invocationCallOrder[0]
      const flushOrder = flushMock.mock.invocationCallOrder[0]
      expect(validateOrder).toBeLessThan(flushOrder)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          resourceKind: 'inbox_ops:inbox_proposal_action',
          resourceId: actionId,
          operation: 'update',
        }),
      )
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'inbox_ops:inbox_proposal_action', resourceId: actionId }),
      )
    })

    it('returns the guard rejection and does not mutate', async () => {
      validateCrudMutationGuardMock.mockResolvedValue(guardDeny)

      const response = await actionPatch(
        jsonRequest(
          `http://localhost/api/inbox_ops/proposals/${proposalId}/actions/${actionId}`,
          'PATCH',
          { payload: { note: 'updated' } },
        ),
      )

      expect(response.status).toBe(423)
      expect(flushMock).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })
  })

  describe('accept all actions', () => {
    it('validates the guard before executing and runs the after-success hook', async () => {
      const response = await acceptAllPost(
        jsonRequest(`http://localhost/api/inbox_ops/proposals/${proposalId}/accept-all`, 'POST'),
      )

      expect(response.status).toBe(200)
      const validateOrder = validateCrudMutationGuardMock.mock.invocationCallOrder[0]
      const executeOrder = acceptAllActionsMock.mock.invocationCallOrder[0]
      expect(validateOrder).toBeLessThan(executeOrder)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          resourceKind: 'inbox_ops:inbox_proposal',
          resourceId: proposalId,
          operation: 'custom',
        }),
      )
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })

    it('returns the guard rejection and does not execute actions', async () => {
      validateCrudMutationGuardMock.mockResolvedValue(guardDeny)

      const response = await acceptAllPost(
        jsonRequest(`http://localhost/api/inbox_ops/proposals/${proposalId}/accept-all`, 'POST'),
      )

      expect(response.status).toBe(423)
      expect(acceptAllActionsMock).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })
  })

  describe('delete email', () => {
    it('validates the guard before deleting and runs the after-success hook', async () => {
      const response = await emailDelete(
        jsonRequest(`http://localhost/api/inbox_ops/emails/${emailId}`, 'DELETE'),
      )

      expect(response.status).toBe(200)
      const validateOrder = validateCrudMutationGuardMock.mock.invocationCallOrder[0]
      const updateOrder = nativeUpdateMock.mock.invocationCallOrder[0]
      expect(validateOrder).toBeLessThan(updateOrder)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({
          resourceKind: 'inbox_ops:inbox_email',
          resourceId: emailId,
          operation: 'delete',
        }),
      )
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })

    it('returns the guard rejection and does not delete', async () => {
      validateCrudMutationGuardMock.mockResolvedValue(guardDeny)

      const response = await emailDelete(
        jsonRequest(`http://localhost/api/inbox_ops/emails/${emailId}`, 'DELETE'),
      )

      expect(response.status).toBe(423)
      expect(nativeUpdateMock).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })

    it('does not run the after-success hook when the email was already deleted', async () => {
      nativeUpdateMock.mockResolvedValue(0)

      const response = await emailDelete(
        jsonRequest(`http://localhost/api/inbox_ops/emails/${emailId}`, 'DELETE'),
      )

      expect(response.status).toBe(404)
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })
  })
})
