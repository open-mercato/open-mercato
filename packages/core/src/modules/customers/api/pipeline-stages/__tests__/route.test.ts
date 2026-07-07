/** @jest-environment node */

import { CustomerPipelineStage, CustomerDictionaryEntry } from '../../../data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

const em = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: organizationId,
    filterIds: [organizationId],
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { GET } from '../route'

const makeStage = (overrides: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-333333333333',
  pipelineId: '44444444-4444-4444-8444-444444444444',
  label: 'Brand New Stage',
  order: 0,
  organizationId,
  tenantId,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
})

describe('customers pipeline-stages GET', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: 'seeded-entry',
      normalizedValue: String((payload as { value?: string }).value ?? '').trim().toLowerCase(),
      ...payload,
    }))
    em.persist.mockReturnValue(undefined)
    em.flush.mockResolvedValue(undefined)
  })

  it('does not persist dictionary entries when a stage has no matching entry (read-only GET, #2735)', async () => {
    const stage = makeStage()
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerPipelineStage) return [stage]
      if (entity === CustomerDictionaryEntry) return []
      return []
    })

    const response = await GET(new Request('http://localhost/api/customers/pipeline-stages'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ id: stage.id, label: stage.label, color: null, icon: null })

    // A GET must not have write side effects — the missing dictionary entry must
    // NOT be auto-seeded inside the read handler (issue #2735).
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns color/icon from an existing dictionary entry without writing', async () => {
    const stage = makeStage({ label: 'Opportunity' })
    const entry = {
      normalizedValue: 'opportunity',
      color: '#38bdf8',
      icon: 'lucide:target',
    }
    em.find.mockImplementation(async (entity: unknown) => {
      if (entity === CustomerPipelineStage) return [stage]
      if (entity === CustomerDictionaryEntry) return [entry]
      return []
    })

    const response = await GET(new Request('http://localhost/api/customers/pipeline-stages'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items[0]).toMatchObject({ color: '#38bdf8', icon: 'lucide:target' })
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })
})
