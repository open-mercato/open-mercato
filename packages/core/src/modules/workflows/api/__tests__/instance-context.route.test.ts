/**
 * PATCH /api/workflows/instances/[id]/context
 *
 * The scoped context-write endpoint that wakes WAIT_FOR_CONDITION waiters.
 * Cross-tenant rejection is a MANDATORY case here (spec risk #4): the route
 * must never reach the unscoped `updateWorkflowContext` helper.
 */

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../lib/condition-handler', () => ({
  wakeConditionWaiters: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { wakeConditionWaiters } from '../../lib/condition-handler'
import { PATCH as patchContext } from '../instances/[id]/context/route'
import { expectMutationHandlerRejectsCrossTenantRecord } from './helpers/orgScopeAssertions'

const mockCreateRequestContainer = createRequestContainer as jest.Mock
const mockGetAuthFromRequest = getAuthFromRequest as jest.Mock
const mockResolveScope = resolveOrganizationScopeForRequest as jest.Mock
const mockFindOneWithDecryption = findOneWithDecryption as jest.Mock
const mockWakeConditionWaiters = wakeConditionWaiters as jest.Mock

describe('PATCH /api/workflows/instances/[id]/context', () => {
  const tenantId = 'tenant-1'
  const organizationId = 'org-1'
  const userId = 'user-1'
  const instanceId = 'instance-1'
  const instanceUpdatedAt = new Date('2026-07-27T10:00:00.000Z')

  let mockEm: any
  let mockRbacService: any
  let mockGuardService: any

  function makeInstance(overrides: Record<string, unknown> = {}) {
    return {
      id: instanceId,
      status: 'PAUSED',
      context: { existing: true },
      tenantId,
      organizationId,
      updatedAt: instanceUpdatedAt,
      ...overrides,
    }
  }

  function makeRequest(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/workflows/instances/instance-1/context', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    })
  }

  function runPatch(request: NextRequest) {
    return patchContext(request, { params: Promise.resolve({ id: instanceId }) })
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = { findOne: jest.fn(), find: jest.fn(), flush: jest.fn() }
    mockRbacService = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
    mockGuardService = {
      validateMutation: jest.fn().mockResolvedValue({ ok: true }),
      afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
    }

    mockCreateRequestContainer.mockResolvedValue({
      hasRegistration: jest.fn(() => true),
      resolve: jest.fn((token: string) => {
        if (token === 'em') return mockEm
        if (token === 'rbacService') return mockRbacService
        if (token === 'crudMutationGuardService') return mockGuardService
        if (token === 'commandOptimisticLockGuardService') return null
        throw new Error(`Unexpected DI token in test: ${token}`)
      }),
    })
    mockGetAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId, features: [] })
    mockResolveScope.mockResolvedValue({ selectedId: organizationId, filterIds: [organizationId] })
    mockWakeConditionWaiters.mockResolvedValue({ woken: ['wait_for_payment'] })
  })

  test('merges the patch and reports the woken waiters', async () => {
    const instance = makeInstance()
    mockFindOneWithDecryption.mockResolvedValue(instance)

    const response = await runPatch(makeRequest({ context: { payment: { status: 'captured' } } }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      instanceId,
      woken: ['wait_for_payment'],
    })
    expect(instance.context).toEqual({ existing: true, payment: { status: 'captured' } })
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockWakeConditionWaiters).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      expect.objectContaining({ instanceId, tenantId, organizationId, userId })
    )
  })

  test('returns 404 for an instance owned by another tenant', async () => {
    await expectMutationHandlerRejectsCrossTenantRecord({
      findOne: mockFindOneWithDecryption,
      runHandler: () => runPatch(makeRequest({ context: { anything: true } })),
      tenantId,
      organizationId,
      recordId: instanceId,
    })
    expect(mockWakeConditionWaiters).not.toHaveBeenCalled()
  })

  test('rejects reserved engine context keys with 400 and never writes them', async () => {
    const instance = makeInstance()
    mockFindOneWithDecryption.mockResolvedValue(instance)

    for (const reservedKey of ['__result', '_pendingAsyncActivities', '__park']) {
      const response = await runPatch(makeRequest({ context: { [reservedKey]: 'x' } }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ error: expect.stringContaining(reservedKey) })
      )
    }

    expect(instance.context).toEqual({ existing: true })
    expect(mockWakeConditionWaiters).not.toHaveBeenCalled()
  })

  test('returns 403 without the workflows.instances.update_context feature', async () => {
    mockRbacService.userHasAllFeatures.mockResolvedValue(false)

    const response = await runPatch(makeRequest({ context: { anything: true } }))

    expect(response.status).toBe(403)
    expect(mockRbacService.userHasAllFeatures).toHaveBeenCalledWith(
      userId,
      ['workflows.instances.update_context'],
      { tenantId, organizationId }
    )
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  test('returns 401 without an authenticated caller', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await runPatch(makeRequest({ context: { anything: true } }))

    expect(response.status).toBe(401)
  })

  test('returns 409 for an instance in a terminal status', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeInstance({ status: 'COMPLETED' }))

    const response = await runPatch(makeRequest({ context: { anything: true } }))

    expect(response.status).toBe(409)
    expect(mockWakeConditionWaiters).not.toHaveBeenCalled()
  })

  test('returns the structured optimistic-lock conflict body for a stale version', async () => {
    const instance = makeInstance()
    mockFindOneWithDecryption.mockResolvedValue(instance)

    const staleVersion = new Date('2026-07-27T09:00:00.000Z').toISOString()
    const response = await runPatch(
      makeRequest({ context: { anything: true } }, { [OPTIMISTIC_LOCK_HEADER_NAME]: staleVersion })
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        code: expect.any(String),
        currentUpdatedAt: instanceUpdatedAt.toISOString(),
        expectedUpdatedAt: staleVersion,
      })
    )
    expect(instance.context).toEqual({ existing: true })
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockWakeConditionWaiters).not.toHaveBeenCalled()
  })

  test('accepts a matching version token', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeInstance())

    const response = await runPatch(
      makeRequest(
        { context: { anything: true } },
        { [OPTIMISTIC_LOCK_HEADER_NAME]: instanceUpdatedAt.toISOString() }
      )
    )

    expect(response.status).toBe(200)
  })

  test('runs the mutation guards as an update on the instance resource', async () => {
    mockFindOneWithDecryption.mockResolvedValue(makeInstance())

    const response = await runPatch(makeRequest({ context: { anything: true } }))

    expect(response.status).toBe(200)
    expect(mockGuardService.validateMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        organizationId,
        userId,
        resourceKind: 'workflows.instance',
        resourceId: instanceId,
        operation: 'update',
      })
    )
  })

  test('returns the guard status and skips the write when a guard blocks', async () => {
    const instance = makeInstance()
    mockFindOneWithDecryption.mockResolvedValue(instance)
    mockGuardService.validateMutation.mockResolvedValue({
      ok: false,
      status: 423,
      body: { error: 'Record locked' },
    })

    const response = await runPatch(makeRequest({ context: { anything: true } }))

    expect(response.status).toBe(423)
    expect(instance.context).toEqual({ existing: true })
    expect(mockWakeConditionWaiters).not.toHaveBeenCalled()
  })

  test('rejects a malformed body with 400', async () => {
    const response = await runPatch(makeRequest({ context: 'not-an-object' }))

    expect(response.status).toBe(400)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })
})
