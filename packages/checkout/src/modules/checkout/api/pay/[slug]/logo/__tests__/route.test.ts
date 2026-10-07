import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCheckoutRateLimit } from '../../../../../lib/rateLimiter'
import { verifyCheckoutAccessToken } from '../../../../../lib/utils'
import { requirePreviewContext } from '../../../../helpers'
import { GET } from '../route'

const LINK_ID = '11111111-1111-4111-8111-111111111111'
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222'
const LOGO_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_ID = '44444444-4444-4444-8444-444444444444'
const ORGANIZATION_ID = '55555555-5555-4555-8555-555555555555'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../../../../lib/rateLimiter', () => ({
  ...jest.requireActual('../../../../../lib/rateLimiter'),
  enforceCheckoutRateLimit: jest.fn(),
}))

jest.mock('../../../../../lib/utils', () => ({
  ...jest.requireActual('../../../../../lib/utils'),
  verifyCheckoutAccessToken: jest.fn(),
}))

jest.mock('../../../../helpers', () => ({
  ...jest.requireActual('../../../../helpers'),
  requirePreviewContext: jest.fn(),
}))

const readScopedForOwner = jest.fn()

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    slug: 'donate',
    status: 'active',
    passwordHash: null,
    logoAttachmentId: LOGO_ID,
    templateId: null,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

function servedLogo(overrides: Record<string, unknown> = {}) {
  return {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    contentType: 'image/png',
    contentDisposition: 'inline; filename="logo.png"; filename*=UTF-8\'\'logo.png',
    fileName: 'logo.png',
    mimeType: 'image/png',
    ...overrides,
  }
}

/**
 * Models the database: the link lives in one tenant and organization, and a
 * lookup finds it unless its filter names a different tenant or organization.
 */
function linkStoredIn(tenantId: string, organizationId: string, overrides: Record<string, unknown>) {
  return (async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    if (where.tenantId !== undefined && where.tenantId !== tenantId) return null
    if (where.organizationId !== undefined && where.organizationId !== organizationId) return null
    return link({ tenantId, organizationId, ...overrides })
  }) as never
}

function previewContext(tenantId: string, orgId: string) {
  return { auth: { tenantId, orgId, sub: 'user-1' }, container: {}, em: {} }
}

function logoRequest(query = '', headers: Record<string, string> = {}) {
  return GET(
    new Request(`https://merchant.example/api/checkout/pay/donate/logo${query}`, { headers }),
    { params: { slug: 'donate' } },
  )
}

describe('GET /api/checkout/pay/[slug]/logo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(enforceCheckoutRateLimit).mockResolvedValue(null)
    jest.mocked(verifyCheckoutAccessToken).mockReturnValue(false)
    jest.mocked(findOneWithDecryption).mockResolvedValue(link() as never)
    readScopedForOwner.mockResolvedValue(servedLogo())
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return {}
        if (name === 'attachmentService') return { readScopedForOwner }
        throw new Error(`[internal] Unknown dependency: ${name}`)
      },
    } as never)
  })

  it('serves the link-owned logo to an anonymous visitor, read through the link owner', async () => {
    const response = await logoRequest()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline;/)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(readScopedForOwner).toHaveBeenCalledTimes(1)
    expect(readScopedForOwner).toHaveBeenCalledWith({
      attachmentId: LOGO_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      expectedOwner: { entityId: 'checkout:checkout_link', recordId: LINK_ID },
      rendition: { width: 640, height: 240, cropType: 'contain' },
    })
  })

  it('looks the link up by slug only, for a public request', async () => {
    await logoRequest()

    expect(jest.mocked(findOneWithDecryption).mock.calls[0]![2]).toEqual({ slug: 'donate', deletedAt: null })
  })

  it.each([
    ['an SVG', 'image/svg+xml'],
    ['an SVG with parameters', 'image/svg+xml; charset=utf-8'],
    ['an HTML document', 'text/html'],
  ])('never serves %s, even when the attachments service would serve it inline', async (_label, contentType) => {
    readScopedForOwner.mockResolvedValue(servedLogo({ contentType, mimeType: contentType.split(';')[0] }))

    const response = await logoRequest()

    expect(response.status).toBe(404)
  })

  it('answers a refusal with the module translation key, as the pay page APIs do', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(null as never)

    const response = await logoRequest()

    expect(await response.json()).toEqual({ error: 'checkout.payPage.errors.logoNotFound' })
  })

  it('falls back to the template owner for a logo propagated from the link template', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link({ templateId: TEMPLATE_ID }) as never)
    readScopedForOwner
      .mockRejectedValueOnce(new CrudHttpError(404, { error: 'Attachment not found' }))
      .mockResolvedValueOnce(servedLogo())

    const response = await logoRequest()

    expect(response.status).toBe(200)
    expect(readScopedForOwner).toHaveBeenNthCalledWith(2, expect.objectContaining({
      expectedOwner: { entityId: 'checkout:checkout_link_template', recordId: TEMPLATE_ID },
    }))
  })

  it('returns 404 when the attachment belongs to neither the link nor its template', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link({ templateId: TEMPLATE_ID }) as never)
    readScopedForOwner.mockRejectedValue(new CrudHttpError(404, { error: 'Attachment not found' }))

    const response = await logoRequest()

    expect(response.status).toBe(404)
    expect(readScopedForOwner).toHaveBeenCalledTimes(2)
  })

  it('does not try a template owner when the link has no template', async () => {
    readScopedForOwner.mockRejectedValue(new CrudHttpError(404, { error: 'Attachment not found' }))

    const response = await logoRequest()

    expect(response.status).toBe(404)
    expect(readScopedForOwner).toHaveBeenCalledTimes(1)
  })

  it('ignores ids in the request and reads only the link\'s own logo', async () => {
    await logoRequest('?attachmentId=99999999-9999-4999-8999-999999999999&tenantId=x')

    expect(readScopedForOwner).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: LOGO_ID, tenantId: TENANT_ID }))
  })

  it.each([
    ['a link that is not published', link({ status: 'draft' })],
    ['a link without a logo', link({ logoAttachmentId: null })],
    ['an unknown slug', null],
  ])('returns 404 for %s without reading attachments', async (_label, record) => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(record as never)

    const response = await logoRequest()

    expect(response.status).toBe(404)
    expect(readScopedForOwner).not.toHaveBeenCalled()
  })

  it('returns 404 for a password-protected link until the visitor has unlocked it', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link({ passwordHash: 'hashed' }) as never)

    const locked = await logoRequest()
    expect(locked.status).toBe(404)
    expect(readScopedForOwner).not.toHaveBeenCalled()

    jest.mocked(verifyCheckoutAccessToken).mockReturnValue(true)
    const unlocked = await logoRequest('', { cookie: 'om_checkout_access=signed' })
    expect(unlocked.status).toBe(200)
    expect(unlocked.headers.get('Cache-Control')).toBe('private, max-age=300')
  })

  it('never serves a file the attachments service would only offer as a download', async () => {
    readScopedForOwner.mockResolvedValue(servedLogo({
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment; filename="logo.pdf"',
    }))

    const response = await logoRequest()

    expect(response.status).toBe(404)
  })

  it.each([
    ['refuses', new CrudHttpError(400, { error: 'Image MIME type does not match file content' })],
    ['cannot decode', new CrudHttpError(422, { error: 'Image could not be rendered' })],
  ])('answers a logo the image pipeline %s as not found, without the core message', async (_label, refusal) => {
    readScopedForOwner.mockRejectedValue(refusal)

    const response = await logoRequest()

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'checkout.payPage.errors.logoNotFound' })
  })

  it('answers an operational failure behind the logo with a 500, not a silent 404', async () => {
    readScopedForOwner.mockRejectedValue(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))

    const response = await logoRequest()

    expect(response.status).toBe(500)
  })

  it('returns the rate limiter response when the visitor is throttled', async () => {
    jest.mocked(enforceCheckoutRateLimit).mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    )

    const response = await logoRequest()

    expect(response.status).toBe(429)
    expect(readScopedForOwner).not.toHaveBeenCalled()
  })

  it('requires the preview context for a preview of an unpublished link', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link({ status: 'draft' }) as never)
    jest.mocked(requirePreviewContext).mockResolvedValue(previewContext(TENANT_ID, ORGANIZATION_ID) as never)

    const response = await logoRequest('?preview=true')

    expect(requirePreviewContext).toHaveBeenCalled()
    expect(enforceCheckoutRateLimit).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('in a preview, looks the link up only within the caller\'s tenant and organization', async () => {
    jest.mocked(requirePreviewContext).mockResolvedValue(previewContext(TENANT_ID, ORGANIZATION_ID) as never)

    await logoRequest('?preview=true')

    expect(jest.mocked(findOneWithDecryption).mock.calls[0]![2]).toEqual({
      slug: 'donate',
      deletedAt: null,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it('in a preview, returns 404 for a link of another tenant without reading attachments', async () => {
    jest.mocked(requirePreviewContext).mockResolvedValue(
      previewContext('99999999-9999-4999-8999-999999999999', ORGANIZATION_ID) as never,
    )
    jest.mocked(findOneWithDecryption).mockImplementation(linkStoredIn(TENANT_ID, ORGANIZATION_ID, { status: 'draft', passwordHash: 'hashed' }))

    const response = await logoRequest('?preview=true')

    expect(response.status).toBe(404)
    expect(readScopedForOwner).not.toHaveBeenCalled()
  })

  it('in a preview, returns 404 for a link of another organization in the same tenant', async () => {
    jest.mocked(requirePreviewContext).mockResolvedValue(
      previewContext(TENANT_ID, '88888888-8888-4888-8888-888888888888') as never,
    )
    jest.mocked(findOneWithDecryption).mockImplementation(linkStoredIn(TENANT_ID, ORGANIZATION_ID, { status: 'draft' }))

    const response = await logoRequest('?preview=true')

    expect(response.status).toBe(404)
    expect(readScopedForOwner).not.toHaveBeenCalled()
  })

  it('refuses a preview when the caller lacks the preview context', async () => {
    jest.mocked(requirePreviewContext).mockRejectedValue(new CrudHttpError(401, { error: 'Unauthorized' }))

    const response = await logoRequest('?preview=true')

    expect(response.status).toBe(401)
    expect(readScopedForOwner).not.toHaveBeenCalled()
  })

  it('returns 404 when the attachments service offers no owner-scoped reads', async () => {
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => (name === 'em' ? {} : { readScoped: jest.fn() }),
    } as never)

    const response = await logoRequest()

    expect(response.status).toBe(404)
  })
})
