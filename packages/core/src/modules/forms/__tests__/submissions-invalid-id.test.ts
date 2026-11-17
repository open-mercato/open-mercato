import { NextRequest } from 'next/server'

const mockGetAuth = jest.fn()
const mockCreateContainer = jest.fn()
const mockListSubmissions = jest.fn()
const mockResolve = jest.fn(() => ({ listSubmissionsByForm: mockListSubmissions }))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateContainer(...args),
}))
jest.mock('../api/runtime-helpers', () => ({
  mapSubmissionError: jest.fn(),
  serializeSubmission: jest.fn(),
}))

import { GET } from '../api/[id]/submissions/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const FORM_ID = '33333333-3333-4333-8333-333333333333'

function getSubmissions(id: string, query = '') {
  return GET(new NextRequest(`http://localhost/api/forms/${id}/submissions${query}`), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuth.mockResolvedValue({ sub: 'user', tenantId: TENANT_ID, orgId: ORGANIZATION_ID })
  mockCreateContainer.mockResolvedValue({ resolve: mockResolve })
  mockListSubmissions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
})

describe('form submissions id validation', () => {
  it.each(['abc', 'not-a-uuid', "'", 'a'.repeat(300), `${FORM_ID}a`])(
    'returns not found for malformed id %s before resolving services',
    async (id) => {
      const response = await getSubmissions(id)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'forms.errors.form_not_found' })
      expect(mockCreateContainer).not.toHaveBeenCalled()
      expect(mockListSubmissions).not.toHaveBeenCalled()
    },
  )

  it('requires authentication before rejecting a malformed id', async () => {
    mockGetAuth.mockResolvedValue(null)

    const response = await getSubmissions('abc')

    expect(response.status).toBe(401)
    expect(mockCreateContainer).not.toHaveBeenCalled()
  })

  it.each([{ tenantId: null, orgId: ORGANIZATION_ID }, { tenantId: TENANT_ID, orgId: null }])(
    'requires tenant and organization scope before rejecting a malformed id',
    async (scope) => {
      mockGetAuth.mockResolvedValue({ sub: 'user', ...scope })

      const response = await getSubmissions('abc')

      expect(response.status).toBe(403)
      expect(mockCreateContainer).not.toHaveBeenCalled()
    },
  )

  it('keeps valid UUID queries scoped to the tenant and organization', async () => {
    const response = await getSubmissions(FORM_ID, '?page=2&pageSize=10&status=submitted')

    expect(response.status).toBe(200)
    expect(mockResolve).toHaveBeenCalledWith('formsSubmissionService')
    expect(mockListSubmissions).toHaveBeenCalledWith({
      formId: FORM_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      page: 2,
      pageSize: 10,
      status: 'submitted',
    })
  })

  it('retains query validation for a valid form id', async () => {
    const response = await getSubmissions(FORM_ID, '?pageSize=101')

    expect(response.status).toBe(422)
    expect(mockCreateContainer).not.toHaveBeenCalled()
  })
})
