import { NextResponse } from 'next/server'

const mockFindOne = jest.fn()
const mockFind = jest.fn()
const mockResolve = jest.fn(() => ({ findOne: mockFindOne, find: mockFind }))
const mockBuildFormsRouteContext = jest.fn()

jest.mock('../api/helpers', () => ({
  buildFormsRouteContext: (...args: unknown[]) => mockBuildFormsRouteContext(...args),
  jsonError: (status: number, error: string) => NextResponse.json({ error }, { status }),
  handleRouteError: () => NextResponse.json({ error: 'forms.errors.internal' }, { status: 500 }),
}))

import { GET } from '../api/[id]/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const FORM_ID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  jest.clearAllMocks()
  mockBuildFormsRouteContext.mockResolvedValue({
    ctx: { container: { resolve: mockResolve } },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
  })
  mockFindOne.mockResolvedValue(null)
})

describe('form detail id validation', () => {
  it.each(['abc', 'not-a-uuid', '33333333-3333-4333-8333-33333333333g'])(
    'returns not found for malformed id %s without querying records',
    async (id) => {
      const response = await GET(new Request(`http://localhost/api/forms/${id}`))

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'forms.errors.form_not_found' })
      expect(mockResolve).not.toHaveBeenCalled()
      expect(mockFindOne).not.toHaveBeenCalled()
      expect(mockFind).not.toHaveBeenCalled()
    },
  )

  it('still looks up a valid UUID within the tenant and organization', async () => {
    const response = await GET(new Request(`http://localhost/api/forms/${FORM_ID}`))

    expect(response.status).toBe(404)
    expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), {
      id: FORM_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      deletedAt: null,
    })
  })
})
