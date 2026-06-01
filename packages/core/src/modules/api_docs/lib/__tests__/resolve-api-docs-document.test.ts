/** @jest-environment node */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { OpenApiDocument } from '@open-mercato/shared/lib/openapi'

const mockBuildSanitized = jest.fn<() => Promise<OpenApiDocument>>()
const mockGetAuthFromRequest = jest.fn<(req: Request) => Promise<unknown>>()
const mockIsPublic = jest.fn<() => boolean>()

jest.mock('../openapi-document', () => ({
  buildSanitizedApiDocsOpenApiDocument: () => mockBuildSanitized(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (req: Request) => mockGetAuthFromRequest(req),
  getAuthFromCookies: jest.fn(),
}))

jest.mock('../public-access', () => ({
  isApiDocsPubliclyAvailable: () => mockIsPublic(),
  API_DOCS_VIEW_FEATURE: 'api_docs.view',
}))

describe('resolveApiDocsDocumentForRequest', () => {
  const fullDoc = {
    openapi: '3.1.0',
    info: { title: 'Full', version: '1.0.0' },
    paths: {
      '/api/example': {
        get: {
          description: 'Summary\n\nRequires features: example.view',
          'x-require-features': ['example.view'],
        },
      },
    },
  } satisfies OpenApiDocument

  beforeEach(() => {
    jest.clearAllMocks()
    mockBuildSanitized.mockResolvedValue(fullDoc)
    mockIsPublic.mockReturnValue(false)
  })

  it('returns full document when public mode is disabled', async () => {
    const { resolveApiDocsDocumentForRequest } = await import('../resolve-api-docs-document')
    const doc = await resolveApiDocsDocumentForRequest(new Request('http://localhost/api/docs/openapi'))
    expect(doc.info?.title).toBe('Full')
    expect(mockGetAuthFromRequest).not.toHaveBeenCalled()
    const operation = doc.paths?.['/api/example']?.get as Record<string, unknown>
    expect(operation['x-require-features']).toEqual(['example.view'])
  })

  it('returns redacted document for anonymous callers when public mode is enabled', async () => {
    mockIsPublic.mockReturnValue(true)
    mockGetAuthFromRequest.mockResolvedValue(null)
    const { resolveApiDocsDocumentForRequest } = await import('../resolve-api-docs-document')
    const doc = await resolveApiDocsDocumentForRequest(new Request('http://localhost/api/docs/openapi'))
    expect(doc.info?.title).toBe('Full')
    const operation = doc.paths?.['/api/example']?.get as Record<string, unknown>
    expect(operation['x-require-features']).toBeUndefined()
    expect(operation.description).toBe('Summary')
  })
})
