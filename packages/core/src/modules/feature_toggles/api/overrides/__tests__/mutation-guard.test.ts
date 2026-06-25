/** @jest-environment node */

import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const TOGGLE_ID = '123e4567-e89b-12d3-a456-426614174090'
const OVERRIDE_ID = '123e4567-e89b-12d3-a456-426614174099'
const USER_ID = 'user-1'

const mockExecute = jest.fn(async () => ({ result: { overrideToggleId: OVERRIDE_ID }, logEntry: null }))
const mockFindOne = jest.fn()
const mockValidateMutation = jest.fn()
const mockAfterMutationSuccess = jest.fn(async () => {})

const mockEm = { findOne: jest.fn((...args: unknown[]) => mockFindOne(...args)) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return { execute: mockExecute }
    if (token === 'crudMutationGuardService') {
      return {
        validateMutation: mockValidateMutation,
        afterMutationSuccess: mockAfterMutationSuccess,
      }
    }
    return null
  }),
}

jest.mock('../../../lib/utils', () => ({
  buildContext: jest.fn(async () => ({
    ctx: { container: mockContainer, auth: { sub: USER_ID, tenantId: TENANT_ID } },
    auth: { sub: USER_ID, tenantId: TENANT_ID },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({ scope: { tenantId: TENANT_ID }, organizationId: ORG_ID })),
}))

jest.mock('../../../lib/queries', () => ({ getOverrides: jest.fn() }))

function putRequest() {
  return new Request('http://localhost/api/feature_toggles/overrides', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toggleId: TOGGLE_ID, isOverride: true, overrideValue: true }),
  })
}

describe('feature_toggles override mutation guard lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockFindOne.mockResolvedValue(null)
  })

  it('blocks the command when the mutation guard denies the write', async () => {
    mockValidateMutation.mockResolvedValue({ ok: false, status: 403, body: { error: 'blocked-by-guard' } })

    const res = await PUT(putRequest())

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('blocked-by-guard')
    expect(mockValidateMutation).toHaveBeenCalledTimes(1)
    expect(mockExecute).not.toHaveBeenCalled()
    expect(mockAfterMutationSuccess).not.toHaveBeenCalled()
  })

  it('passes stable resource metadata to the guard validation call', async () => {
    mockValidateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    expect(mockValidateMutation).toHaveBeenCalledTimes(1)
    const input = mockValidateMutation.mock.calls[0][0]
    expect(input).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resourceKind: 'feature_toggles.feature_toggle_override',
      resourceId: TOGGLE_ID,
      operation: 'update',
      requestMethod: 'PUT',
    })
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('runs the after-success hook after a successful override write', async () => {
    mockValidateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { rule: 'x' } })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockAfterMutationSuccess).toHaveBeenCalledTimes(1)
    const input = mockAfterMutationSuccess.mock.calls[0][0]
    expect(input).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      resourceKind: 'feature_toggles.feature_toggle_override',
      resourceId: OVERRIDE_ID,
      operation: 'update',
      requestMethod: 'PUT',
      metadata: { rule: 'x' },
    })
  })

  it('does not run the after-success hook when the guard opts out', async () => {
    mockValidateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockAfterMutationSuccess).not.toHaveBeenCalled()
  })

  it('uses the existing override id as the guard resource id when a row exists', async () => {
    mockFindOne.mockResolvedValue({ id: OVERRIDE_ID, updatedAt: new Date('2026-06-01T10:00:00.000Z') })
    mockValidateMutation.mockResolvedValue({ ok: true, shouldRunAfterSuccess: false })

    const res = await PUT(putRequest())

    expect(res.status).toBe(200)
    const input = mockValidateMutation.mock.calls[0][0]
    expect(input.resourceId).toBe(OVERRIDE_ID)
  })
})
