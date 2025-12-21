/** @jest-environment node */

import { features } from '../../acl'

describe('Webhooks API - ACL Features', () => {
  it('exports the expected ACL features', () => {
    const featureIds = features.map((entry) => entry.id)
    expect(featureIds).toEqual([
      'webhooks.list',
      'webhooks.create',
      'webhooks.edit',
      'webhooks.delete',
    ])
  })

  it('all features belong to webhooks module', () => {
    features.forEach((feature) => {
      expect(feature.module).toBe('webhooks')
    })
  })

  it('all features have titles', () => {
    features.forEach((feature) => {
      expect(feature.title).toBeTruthy()
      expect(typeof feature.title).toBe('string')
    })
  })
})

describe('Webhooks API - Route Metadata', () => {
  let routeMetadata: { GET?: unknown; POST?: unknown; PUT?: unknown; DELETE?: unknown }

  beforeAll(async () => {
    // Mock dependencies before importing route
    jest.mock('@/lib/di/container', () => ({
      createRequestContainer: jest.fn(),
    }))
    jest.mock('@/lib/auth/server', () => ({
      getAuthFromCookies: jest.fn(),
      getAuthFromRequest: jest.fn(),
    }))
    jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
      resolveOrganizationScopeForRequest: jest.fn(),
    }))
    jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
      resolveTranslations: jest.fn(async () => ({
        translate: (_key: string, fallback: string) => fallback,
      })),
    }))

    const routeModule = await import('../route')
    routeMetadata = routeModule.metadata
  })

  it('declares requireAuth for GET endpoint', () => {
    expect((routeMetadata.GET as { requireAuth?: boolean })?.requireAuth).toBe(true)
  })

  it('declares webhooks.list feature for GET endpoint', () => {
    expect((routeMetadata.GET as { requireFeatures?: string[] })?.requireFeatures).toEqual(['webhooks.list'])
  })

  it('declares requireAuth for POST endpoint', () => {
    expect((routeMetadata.POST as { requireAuth?: boolean })?.requireAuth).toBe(true)
  })

  it('declares webhooks.create feature for POST endpoint', () => {
    expect((routeMetadata.POST as { requireFeatures?: string[] })?.requireFeatures).toEqual(['webhooks.create'])
  })

  it('declares requireAuth for PUT endpoint', () => {
    expect((routeMetadata.PUT as { requireAuth?: boolean })?.requireAuth).toBe(true)
  })

  it('declares webhooks.edit feature for PUT endpoint', () => {
    expect((routeMetadata.PUT as { requireFeatures?: string[] })?.requireFeatures).toEqual(['webhooks.edit'])
  })

  it('declares requireAuth for DELETE endpoint', () => {
    expect((routeMetadata.DELETE as { requireAuth?: boolean })?.requireAuth).toBe(true)
  })

  it('declares webhooks.delete feature for DELETE endpoint', () => {
    expect((routeMetadata.DELETE as { requireFeatures?: string[] })?.requireFeatures).toEqual(['webhooks.delete'])
  })
})
