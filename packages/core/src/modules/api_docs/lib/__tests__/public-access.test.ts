/** @jest-environment node */

import { describe, expect, it, afterEach } from '@jest/globals'

describe('api_docs public access env', () => {
  const original = process.env.OM_API_DOCS_PUBLICLY_AVAILABLE

  afterEach(() => {
    if (original === undefined) delete process.env.OM_API_DOCS_PUBLICLY_AVAILABLE
    else process.env.OM_API_DOCS_PUBLICLY_AVAILABLE = original
    jest.resetModules()
  })

  it('defaults to secured export metadata', async () => {
    delete process.env.OM_API_DOCS_PUBLICLY_AVAILABLE
    const { getApiDocsExportRouteGetMetadata, isApiDocsPubliclyAvailable } = await import('../public-access')
    expect(isApiDocsPubliclyAvailable()).toBe(false)
    expect(getApiDocsExportRouteGetMetadata()).toEqual({
      requireAuth: true,
      requireFeatures: ['api_docs.view'],
    })
  })

  it('enables public export metadata when env is true', async () => {
    process.env.OM_API_DOCS_PUBLICLY_AVAILABLE = 'true'
    const { getApiDocsExportRouteGetMetadata, isApiDocsPubliclyAvailable } = await import('../public-access')
    expect(isApiDocsPubliclyAvailable()).toBe(true)
    expect(getApiDocsExportRouteGetMetadata()).toEqual({ requireAuth: false })
  })
})
