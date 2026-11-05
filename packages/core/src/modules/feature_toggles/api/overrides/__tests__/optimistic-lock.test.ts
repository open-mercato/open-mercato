/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const TOGGLE_ID = '123e4567-e89b-12d3-a456-426614174090'
const OVERRIDE_ID = '123e4567-e89b-12d3-a456-426614174099'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockExecute = jest.fn(async () => ({ result: { overrideToggleId: OVERRIDE_ID }, logEntry: null }))
const mockFindOne = jest.fn()
const mockEm = { findOne: jest.fn((...args: unknown[]) => mockFindOne(...args)) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandBus') return { execute: mockExecute }
    return null
  }),
}

jest.mock('../../../lib/utils', () => ({
  buildContext: jest.fn(async () => ({ ctx: { container: mockContainer, auth: { sub: 'u1', tenantId: TENANT_ID } } })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({ scope: { tenantId: TENANT_ID } })),
}))

jest.mock('../../../lib/queries', () => ({ getOverrides: jest.fn() }))

function putRequest(headerVersion: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/feature_toggles/overrides', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ toggleId: TOGGLE_ID, isOverride: true, overrideValue: true }),
  })
}

describe('feature_toggles override optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockFindOne.mockResolvedValue({ id: OVERRIDE_ID, updatedAt: new Date(CURRENT_VERSION) })
  })

  it('returns 409 when the expected version is stale', async () => {
    const res = await PUT(putRequest(STALE_VERSION))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('executes the command when the expected version matches', async () => {
    const res = await PUT(putRequest(CURRENT_VERSION))
    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('is a no-op (no 409) without the expected-version header', async () => {
    const res = await PUT(putRequest(null))
    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('skips the lock when no override row exists yet (first set)', async () => {
    mockFindOne.mockResolvedValue(null)
    const res = await PUT(putRequest(STALE_VERSION))
    expect(res.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })
})
