/** @jest-environment node */

import { UNAVAILABILITY_REASON_DICTIONARIES } from '@open-mercato/core/modules/planner/lib/unavailabilityReasons'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const dictionaryId = '44444444-4444-4444-8444-444444444444'

const em = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
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

const context = {
  container,
  ctx: {
    container,
    auth: { tenantId, sub: userId },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    request: null,
  },
  auth: { tenantId, sub: userId, orgId: organizationId },
  em,
  organizationId,
  tenantId,
  readableOrganizationIds: [organizationId],
  translate: (_key: string, fallback?: string) => fallback ?? 'error',
}

jest.mock('@open-mercato/core/modules/dictionaries/api/context', () => ({
  resolveDictionariesRouteContext: jest.fn(async () => context),
  resolveDictionaryActorId: jest.fn(() => userId),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false, metadata: null })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

import { POST as createDictionary } from '../route'

function postDictionary(body: Record<string, unknown>) {
  return createDictionary(
    new Request('http://localhost/api/dictionaries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/dictionaries key validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    em.findOne.mockResolvedValue(null)
    em.create.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ id: dictionaryId, ...data }))
  })

  it.each(Object.values(UNAVAILABILITY_REASON_DICTIONARIES).map((dictionary) => [dictionary.key, dictionary.name]))(
    'creates the namespaced dictionary %s a planner screen asks for',
    async (key, name) => {
      const response = await postDictionary({ key, name })

      expect(response.status).toBe(201)
      await expect(response.json()).resolves.toMatchObject({ key })
    },
  )

  it('answers a malformed key with 400 and the field message, not 500', async () => {
    const response = await postDictionary({ key: 'Not A Key', name: 'Broken' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining('lowercase'),
    })
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('answers a missing name with 400 rather than persisting', async () => {
    const response = await postDictionary({ key: 'colors' })

    expect(response.status).toBe(400)
    expect(em.persist).not.toHaveBeenCalled()
  })
})
