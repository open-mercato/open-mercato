/** @jest-environment node */

import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

const mockResolveApiDocsDocumentForRequest = jest.fn<(req: Request) => Promise<OpenApiDocument>>()

jest.mock('../../lib/resolve-api-docs-document', () => ({
  resolveApiDocsDocumentForRequest: (req: Request) => mockResolveApiDocsDocumentForRequest(req),
}))

describe('api_docs /api/docs/markdown route', () => {
  const originalPublicEnv = process.env.OM_API_DOCS_PUBLICLY_AVAILABLE

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_API_DOCS_PUBLICLY_AVAILABLE
    jest.resetModules()
    mockResolveApiDocsDocumentForRequest.mockResolvedValue({
      openapi: '3.1.0',
      info: { title: 'Open Mercato API', version: '1.0.0' },
      paths: {},
    })
  })

  afterEach(() => {
    if (originalPublicEnv === undefined) delete process.env.OM_API_DOCS_PUBLICLY_AVAILABLE
    else process.env.OM_API_DOCS_PUBLICLY_AVAILABLE = originalPublicEnv
    jest.resetModules()
  })

  it('requires authentication and api_docs.view by default', async () => {
    const { metadata } = await import('../docs/markdown/route')
    expect(metadata.path).toBe('/docs/markdown')
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['api_docs.view'],
    })
  })

  it('allows anonymous access when OM_API_DOCS_PUBLICLY_AVAILABLE is true', async () => {
    process.env.OM_API_DOCS_PUBLICLY_AVAILABLE = 'true'
    const { metadata } = await import('../docs/markdown/route')
    expect(metadata.GET).toEqual({ requireAuth: false })
  })

  it('returns markdown generated from the resolved document', async () => {
    const { GET } = await import('../docs/markdown/route')
    const request = new Request('http://localhost:3000/api/docs/markdown')
    const response = await GET(request)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(body).toContain('Open Mercato API')
    expect(mockResolveApiDocsDocumentForRequest).toHaveBeenCalledWith(request)
  })
})
