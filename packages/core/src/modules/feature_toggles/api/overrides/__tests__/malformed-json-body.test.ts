/** @jest-environment node */

import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const USER_ID = 'user-1'

const mockExecute = jest.fn()
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
  buildContext: jest.fn(async () => ({
    ctx: { container: mockContainer, auth: { sub: USER_ID, tenantId: TENANT_ID } },
    auth: { sub: USER_ID, tenantId: TENANT_ID },
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveFeatureCheckContext: jest.fn(async () => ({ scope: { tenantId: TENANT_ID }, organizationId: ORG_ID })),
}))

jest.mock('../../../lib/queries', () => ({ getOverrides: jest.fn() }))

function putRequest(body: string) {
  return new Request('http://localhost/api/feature_toggles/overrides', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

describe('feature_toggles override PUT body parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOne.mockResolvedValue(null)
  })

  it('returns 400 Invalid payload for a body that is not valid JSON', async () => {
    const res = await PUT(putRequest('{not-valid-json'))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid payload')
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns 400 Invalid payload for an empty body', async () => {
    const res = await PUT(putRequest(''))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid payload')
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns 400 Invalid payload with details for valid JSON that fails the schema', async () => {
    const res = await PUT(putRequest(JSON.stringify({ toggleId: 'not-a-uuid' })))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid payload')
    expect(body.details).toBeDefined()
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
