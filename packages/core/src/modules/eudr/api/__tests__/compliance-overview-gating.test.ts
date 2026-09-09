/** @jest-environment node */

const mockGrantedFeatures = new Set<string>()

const mockEm = {
  count: jest.fn(async () => 0),
  find: jest.fn(async () => []),
  getConnection: () => ({ execute: async (): Promise<Record<string, unknown>[]> => [] }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'rbacService') {
        return {
          userHasAllFeatures: async (_userId: string, features: string[]) =>
            features.every((feature) => mockGrantedFeatures.has(feature)),
        }
      }
      throw new Error(`[internal] unexpected container key: ${key}`)
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: 'org-1' })),
}))

import { GET } from '../dashboard/widgets/compliance-overview/route'

async function fetchOverview(): Promise<Record<string, unknown>> {
  const response = await GET(new Request('http://localhost/api/eudr/dashboard/widgets/compliance-overview'))
  expect(response.status).toBe(200)
  return await response.json() as Record<string, unknown>
}

describe('eudr compliance overview queue feature gating', () => {
  beforeEach(() => {
    mockGrantedFeatures.clear()
  })

  it('omits queue keys and rollups for missing features while returning granted blocks', async () => {
    mockGrantedFeatures.add('eudr.statements.view')
    mockGrantedFeatures.add('eudr.submissions.view')

    const payload = await fetchOverview()
    const queues = payload.queues as Record<string, unknown>

    expect(payload).toHaveProperty('deadline')
    expect(payload).not.toHaveProperty('mappingsInScope')
    expect(payload.submissions).toMatchObject({ total: 0, incomplete: 0 })
    expect(payload.statements).toMatchObject({ total: 0, notReady: 0, missingReference: 0 })
    expect(payload).not.toHaveProperty('riskReviewsDueSoon')
    expect(Object.keys(queues).sort()).toEqual(['amendWindow', 'incompleteSubmissions'])
    expect(payload).not.toHaveProperty('plots')
  })

  it('returns only statements and deadline rollups with the base feature', async () => {
    mockGrantedFeatures.add('eudr.statements.view')

    const payload = await fetchOverview()

    expect(payload).toHaveProperty('deadline')
    expect(payload.statements).toMatchObject({ total: 0, notReady: 0, missingReference: 0 })
    expect(payload).not.toHaveProperty('mappingsInScope')
    expect(payload).not.toHaveProperty('submissions')
    expect(payload).not.toHaveProperty('riskReviewsDueSoon')
  })

  it('returns every queue when all view features are granted', async () => {
    for (const feature of [
      'eudr.statements.view',
      'eudr.mappings.view',
      'eudr.submissions.view',
      'eudr.risk.view',
      'eudr.plots.view',
    ]) {
      mockGrantedFeatures.add(feature)
    }

    const payload = await fetchOverview()
    const queues = payload.queues as Record<string, unknown>

    expect(payload).toHaveProperty('deadline')
    expect(payload.mappingsInScope).toBe(0)
    expect(payload.submissions).toMatchObject({ total: 0, incomplete: 0 })
    expect(payload.statements).toMatchObject({ total: 0, notReady: 0, missingReference: 0 })
    expect(payload.riskReviewsDueSoon).toBe(0)
    expect(Object.keys(queues).sort()).toEqual(['amendWindow', 'incompleteSubmissions', 'plotsWithWarnings', 'reviewsDue'])
    expect(payload.plots).toEqual({ active: 0, withWarnings: 0 })
  })
})
