import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const buildContext = jest.fn()
const findOne = jest.fn()
const hasRegistration = jest.fn()
const createRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('../commands', () => ({}))
jest.mock('../api/helpers', () => ({
  buildFormsRouteContext: (...args: unknown[]) => buildContext(...args),
  jsonError: (status: number, error: string) => NextResponse.json({ error }, { status }),
  handleRouteError: () => NextResponse.json({ error: 'internal' }, { status: 500 }),
}))
jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({ storePartitionFile: jest.fn() }))
jest.mock('@open-mercato/core/modules/attachments/lib/imageSafety', () => ({
  detectImageMimeType: () => 'image/png',
  validateImageMagicBytes: () => ({ ok: true }),
  validateImageDimensions: async () => ({ ok: true }),
}))

import { metadata as formsMetadata } from '../index'
import { POST } from '../api/[id]/theme-logo/route'
import { Form } from '../data/entities'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'

function uploadRequest(): NextRequest {
  const body = new FormData()
  body.set('file', new File(['image'], 'logo.png', { type: 'image/png' }))
  return new Request('http://test/api/forms/form-id/theme-logo', { method: 'POST', body }) as NextRequest
}

function request(): NextRequest {
  return new Request('http://test/api/forms/form-id/theme-logo', { method: 'POST' }) as NextRequest
}

describe('Forms with optional peer modules disabled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 'form-id' })
    hasRegistration.mockReturnValue(false)
    buildContext.mockResolvedValue({
      ctx: { container: { resolve: () => ({ findOne }), hasRegistration } },
      organizationId: 'org-id',
      tenantId: 'tenant-id',
      translate: (key: string) => `translated:${key}`,
    })
  })

  it('does not resolve portal services for staff requests without a customer token', async () => {
    expect(await getCustomerAuthFromRequest(request())).toBeNull()
    expect(createRequestContainer).not.toHaveBeenCalled()
  })

  it('does not require attachments or customer accounts for module generation', () => {
    expect(formsMetadata.requires ?? []).not.toContain('attachments')
    expect(formsMetadata.requires ?? []).not.toContain('customer_accounts')
  })

  it('refuses logo upload with a translated 503 before accessing attachment storage', async () => {
    findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Form) return { id: 'form-id' }
      throw new Error('[internal] Attachment metadata is unavailable')
    })
    const response = await POST(uploadRequest(), { params: { id: 'form-id' } })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'translated:forms.errors.logo_storage_unavailable' })
    expect(hasRegistration).toHaveBeenCalledWith('attachmentService')
    expect(findOne).toHaveBeenCalledTimes(1)
    expect(findOne).toHaveBeenCalledWith(Form, { id: 'form-id', organizationId: 'org-id', tenantId: 'tenant-id' })
  })

  it('keeps ownership validation before the optional storage check', async () => {
    findOne.mockResolvedValue(null)
    const response = await POST(request(), { params: Promise.resolve({ id: 'missing-form' }) })

    expect(response.status).toBe(404)
    expect(hasRegistration).not.toHaveBeenCalled()
  })

  it('keeps enabled-storage upload validation unchanged', async () => {
    hasRegistration.mockReturnValue(true)
    const response = await POST(request(), { params: { id: 'form-id' } })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'forms.errors.invalid_upload' })
  })
})
