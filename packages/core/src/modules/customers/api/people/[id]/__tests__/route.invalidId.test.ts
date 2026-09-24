/** @jest-environment node */

// Regression coverage for issue #6176: a malformed person id must return a
// translated error instead of the hardcoded English string.

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })),
}))

describe('GET /api/customers/people/[id] — malformed id', () => {
  it('returns a translated error for a malformed person id', async () => {
    const { GET } = await import('../route')
    const response = await GET(
      new Request('http://localhost/api/customers/people/not-a-uuid'),
      { params: { id: 'not-a-uuid' } },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Invalid person id')
  })
})
