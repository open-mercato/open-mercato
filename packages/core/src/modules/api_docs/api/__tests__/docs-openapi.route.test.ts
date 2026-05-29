/** @jest-environment node */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

const mockBuildSanitizedApiDocsOpenApiDocument = jest.fn<() => Promise<OpenApiDocument>>()

jest.mock('../../lib/openapi-document', () => ({
  buildSanitizedApiDocsOpenApiDocument: () => mockBuildSanitizedApiDocsOpenApiDocument(),
}))

describe('api_docs /api/docs/openapi route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildSanitizedApiDocsOpenApiDocument.mockResolvedValue({
      openapi: '3.1.0',
      info: { title: 'Open Mercato API', version: '1.0.0' },
      paths: { '/api/customers/people': { get: { summary: 'List people' } } },
    })
  })

  it('requires authentication and api_docs.view', async () => {
    const { metadata } = await import('../get/docs/openapi')
    expect(metadata.path).toBe('/docs/openapi')
    expect(metadata.GET).toEqual({
      requireAuth: true,
      requireFeatures: ['api_docs.view'],
    })
  })

  it('returns sanitized OpenAPI JSON', async () => {
    const { GET } = await import('../get/docs/openapi')
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body.openapi).toBe('3.1.0')
    expect(body.paths).toHaveProperty('/api/customers/people')
    expect(mockBuildSanitizedApiDocsOpenApiDocument).toHaveBeenCalledTimes(1)
  })
})
