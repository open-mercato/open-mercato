import { POST } from '../route'

// A valid UUIDv4 for use as personId in tests
const VALID_PERSON_ID = '550e8400-e29b-41d4-a716-446655440000'
const VALID_CHANNEL_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

function mockRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(headers),
    url: `http://localhost/api/customers/people/${VALID_PERSON_ID}/emails`,
    method: 'POST',
  } as unknown as Request
}

describe('POST /api/customers/people/[id]/emails — validation only', () => {
  it('returns 400 when person id is not a UUID', async () => {
    const res = await POST(
      mockRequest({ userChannelId: VALID_CHANNEL_ID, to: ['x@y.io'], subject: 'hi', body: 'hello' }),
      { params: Promise.resolve({ id: 'not-uuid' }) } as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 when no auth (valid UUID personId)', async () => {
    const res = await POST(
      mockRequest({ userChannelId: VALID_CHANNEL_ID, to: ['x@y.io'], subject: 'hi', body: 'hello' }),
      { params: Promise.resolve({ id: VALID_PERSON_ID }) } as any,
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when person id is not a UUID even if body is invalid', async () => {
    // UUID guard is checked before body parsing — 400 always wins for bad personId
    const res = await POST(
      mockRequest({ userChannelId: VALID_CHANNEL_ID, to: [], subject: '', body: '' }),
      { params: Promise.resolve({ id: 'not-uuid' }) } as any,
    )
    expect(res.status).toBe(400)
  })

  it('returns 401 before body validation when no auth and personId is valid UUID', async () => {
    // Auth check fires before body parsing — 401 wins over 422 for invalid body
    const res = await POST(
      mockRequest({ userChannelId: VALID_CHANNEL_ID, to: ['x@y.io'], subject: '', body: 'hi' }),
      { params: Promise.resolve({ id: VALID_PERSON_ID }) } as any,
    )
    expect(res.status).toBe(401)
  })
})

// Deeper integration tests (auth, person ownership, hub call) live in
// the Phase 2 Playwright spec TC-CRM-EMAIL-001.
