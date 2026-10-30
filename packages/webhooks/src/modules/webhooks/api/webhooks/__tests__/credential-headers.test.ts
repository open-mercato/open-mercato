/** @jest-environment node */

import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type ApplyToEntity = (entity: Record<string, unknown>, input: Record<string, unknown>, ctx: unknown) => Promise<void> | void

const captured: { applyToEntity: ApplyToEntity | null } = { applyToEntity: null }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((options: { update?: { applyToEntity?: ApplyToEntity } }) => {
    captured.applyToEntity = options.update?.applyToEntity ?? null
    return { metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

import '../route'

const REDACTED = '••••••••'

let grantedFeatures: string[] = []
const userHasAllFeatures = jest.fn(async (_sub: string, required: string[]) =>
  required.every((feature) => grantedFeatures.includes(feature)),
)
const ctx = {
  auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
  container: { resolve: (token: string) => (token === 'rbacService' ? { userHasAllFeatures } : null) },
}

function makeEntity() {
  return {
    id: 'webhook-1',
    name: 'Hook',
    url: 'https://example.com/hook',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    customHeaders: { Authorization: 'Bearer stored', 'x-source': 'qa' } as Record<string, string> | null,
  }
}

async function applyExpectingError(entity: Record<string, unknown>, input: Record<string, unknown>) {
  try {
    await captured.applyToEntity?.(entity, input, ctx)
  } catch (error) {
    return error
  }
  throw new Error('[internal] expected applyToEntity to throw')
}

describe('PUT /api/webhooks credential header handling (issue #7237)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    grantedFeatures = ['webhooks.view', 'webhooks.manage']
  })

  it('keeps the stored value when the redaction marker is echoed', async () => {
    const entity = makeEntity()

    await captured.applyToEntity?.(entity, { name: 'Renamed', customHeaders: { Authorization: REDACTED, 'x-source': 'erp' } }, ctx)

    expect(entity.customHeaders).toEqual({ Authorization: 'Bearer stored', 'x-source': 'erp' })
    expect(entity.name).toBe('Renamed')
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['webhooks.secrets'], { tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('throws a 400 and changes nothing for a marker without a stored value', async () => {
    const entity = makeEntity()

    const error = await applyExpectingError(entity, { name: 'Renamed', customHeaders: { 'x-token': REDACTED } })

    expect(isCrudHttpError(error) && error.status).toBe(400)
    expect(entity).toEqual(makeEntity())
  })

  it('throws a 400 when stored credentials would follow a new host for a caller without webhooks.secrets', async () => {
    const entity = makeEntity()

    const error = await applyExpectingError(entity, { url: 'https://attacker.example.net/collect' })

    expect(isCrudHttpError(error) && error.status).toBe(400)
    expect(entity).toEqual(makeEntity())
  })

  it('lets a webhooks.secrets holder move stored credentials to a new host', async () => {
    grantedFeatures = ['webhooks.view', 'webhooks.manage', 'webhooks.secrets']
    const entity = makeEntity()

    await captured.applyToEntity?.(entity, { url: 'https://other.example.net/hook' }, ctx)

    expect(entity.url).toBe('https://other.example.net/hook')
    expect(entity.customHeaders).toEqual(makeEntity().customHeaders)
  })
})
