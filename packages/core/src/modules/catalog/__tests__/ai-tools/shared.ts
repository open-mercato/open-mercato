/**
 * Shared test helpers for the catalog AI tool pack tests.
 */
import features from '../../acl'

export type FakeCtx = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: { resolve: jest.Mock }
  userFeatures: string[]
  isSuperAdmin: boolean
  em: {
    count: jest.Mock
    persistAndFlush: jest.Mock
  }
}

export function makeCtx(overrides: Partial<FakeCtx & { organizationId: string | null }> = {}): FakeCtx {
  const em = {
    count: jest.fn().mockResolvedValue(0),
    persistAndFlush: jest.fn().mockResolvedValue(undefined),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      throw new Error(`unexpected resolve: ${name}`)
    }),
  }
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    container: container as any,
    userFeatures: [
      'catalog.products.view',
      'catalog.categories.view',
      'catalog.settings.manage',
    ],
    isSuperAdmin: false,
    em,
    ...overrides,
  }
}

export const knownFeatureIds = new Set(features.map((entry) => entry.id))
