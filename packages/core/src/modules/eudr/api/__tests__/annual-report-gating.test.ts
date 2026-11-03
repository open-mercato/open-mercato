/** @jest-environment node */

const mockGrantedFeatures = new Set<string>()

function createKyselyChainMock(): unknown {
  const chain: Record<string, unknown> = {}
  const handler = () => chain
  for (const method of ['selectFrom', 'select', 'where', 'groupBy', 'orderBy', 'distinctOn', 'as', 'innerJoin', 'leftJoin', 'limit']) {
    chain[method] = handler
  }
  chain.execute = async () => []
  chain.executeTakeFirst = async () => undefined
  return chain
}

const mockEm = {
  getKysely: () => createKyselyChainMock(),
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
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: 'org-1', filterIds: ['org-1'] })),
}))

import { GET } from '../reports/annual/route'

async function fetchAnnual(query = 'year=2026'): Promise<Response> {
  return await GET(new Request(`http://localhost/api/eudr/reports/annual?${query}`))
}

describe('eudr annual report per-block feature gating', () => {
  beforeEach(() => {
    mockGrantedFeatures.clear()
  })

  // The base `eudr.statements.view` gate is declarative route metadata enforced
  // by the API dispatcher (asserted at the HTTP level by TC-EUDR-014); this
  // suite covers the handler-internal per-block gating only.

  it('returns only the statements block for a statements-only caller', async () => {
    mockGrantedFeatures.add('eudr.statements.view')
    const response = await fetchAnnual()
    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.statements).toBeDefined()
    expect(payload).not.toHaveProperty('countries')
    expect(payload).not.toHaveProperty('risk')
    expect(payload).not.toHaveProperty('mitigation')
  })

  it('returns every block for a full-feature caller', async () => {
    mockGrantedFeatures.add('eudr.statements.view')
    mockGrantedFeatures.add('eudr.submissions.view')
    mockGrantedFeatures.add('eudr.risk.view')
    const response = await fetchAnnual()
    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.statements).toBeDefined()
    expect(payload).toHaveProperty('countries')
    expect(payload).toHaveProperty('risk')
    expect(payload).toHaveProperty('mitigation')
  })

  it('rejects an out-of-range year', async () => {
    mockGrantedFeatures.add('eudr.statements.view')
    const response = await fetchAnnual('year=1999')
    expect(response.status).toBe(400)
  })
})
