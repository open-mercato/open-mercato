/** @jest-environment node */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

const mockBuildSanitizedApiDocsOpenApiDocument = jest.fn<() => Promise<OpenApiDocument>>()

jest.mock('../../lib/openapi-document', () => ({
  buildSanitizedApiDocsOpenApiDocument: () => mockBuildSanitizedApiDocsOpenApiDocument(),
}))

describe('api_docs /api/docs/markdown route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildSanitizedApiDocsOpenApiDocument.mockResolvedValue({
      openapi: '3.1.0',
      info: { title: 'Open Mercato API', version: '1.0.0' },
      paths: {},
    })
  })

  it('requires authentication and api_docs.view', async () => {
    const { metadata } = await import('../get/docs/markdown')
    expect(metadata.path).toBe('/docs/markdown')
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['api_docs.view'],
    })
  })

  it('returns markdown generated from the OpenAPI document', async () => {
    const { GET } = await import('../get/docs/markdown')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(body).toContain('Open Mercato API')
    expect(mockBuildSanitizedApiDocsOpenApiDocument).toHaveBeenCalledTimes(1)
  })
})
