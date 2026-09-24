import { PATCH } from '../route'

// Valid UUIDv4 for use in tests
const VALID_INTERACTION_ID = '550e8400-e29b-41d4-a716-446655440001'

function mockRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Request
}

describe('PATCH /api/customers/interactions/[id]/visibility — validation', () => {
  it('returns 400 when id is not a UUID', async () => {
    const res = await PATCH(
      mockRequest({ visibility: 'shared' }),
      { params: Promise.resolve({ id: 'not-uuid' }) } as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns a translated error for a malformed interaction id (regression: #6176)', async () => {
    const res = await PATCH(
      mockRequest({ visibility: 'shared' }),
      { params: Promise.resolve({ id: 'not-uuid' }) } as any,
    )
    const body = await res.json()
    expect(body.error).toBe('Invalid interaction id')
  })

  it('returns 401 unauthenticated', async () => {
    const res = await PATCH(
      mockRequest({ visibility: 'shared' }),
      { params: Promise.resolve({ id: VALID_INTERACTION_ID }) } as any,
    )
    expect(res.status).toBe(401)
  })
})
