/** @jest-environment node */

import { describe, expect, it, jest, beforeEach } from '@jest/globals'
import type { Module } from '@open-mercato/shared/modules/registry'

const mockBuildOpenApiDocument = jest.fn<(modules: unknown, options: unknown) => Record<string, unknown>>()
const mockSanitizeOpenApiDocument = jest.fn<(doc: Record<string, unknown>) => Record<string, unknown>>()
const mockGetModules = jest.fn<() => Module[]>()
const mockResolveTranslations = jest.fn<
  () => Promise<{ t: (key: string, fallback?: string) => string }>
>()

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => mockGetModules(),
}))

jest.mock('@open-mercato/shared/lib/openapi', () => ({
  buildOpenApiDocument: (modules: unknown, options: unknown) => mockBuildOpenApiDocument(modules, options),
  sanitizeOpenApiDocument: (doc: Record<string, unknown>) => mockSanitizeOpenApiDocument(doc),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

jest.mock('@open-mercato/shared/lib/version', () => ({
  APP_VERSION: '1.2.3-test',
}))

describe('buildSanitizedApiDocsOpenApiDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetModules.mockReturnValue([{ id: 'api_docs' } as Module])
    mockResolveTranslations.mockResolvedValue({
      t: (key: string, fallback?: string) => fallback ?? key,
    })
    mockBuildOpenApiDocument.mockReturnValue({ openapi: '3.1.0', paths: { '/api/example': {} } })
    mockSanitizeOpenApiDocument.mockImplementation((doc) => doc)
  })

  it('builds and sanitizes the OpenAPI document from registered modules', async () => {
    const { buildSanitizedApiDocsOpenApiDocument } = await import('../openapi-document')
    const doc = await buildSanitizedApiDocsOpenApiDocument()

    expect(mockGetModules).toHaveBeenCalled()
    expect(mockBuildOpenApiDocument).toHaveBeenCalledWith(
      [{ id: 'api_docs' }],
      expect.objectContaining({
        title: 'Open Mercato API',
        version: '1.2.3-test',
        defaultSecurity: ['bearerAuth'],
      }),
    )
    expect(mockSanitizeOpenApiDocument).toHaveBeenCalledWith({ openapi: '3.1.0', paths: { '/api/example': {} } })
    expect(doc).toEqual({ openapi: '3.1.0', paths: { '/api/example': {} } })
  })
})
