/** @jest-environment node */

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174237'
const REDACTED = '••••••••'

type StoredWebhook = Record<string, unknown> & { customHeaders: Record<string, string> | null }

function makeWebhook(): StoredWebhook {
  return {
    id: WEBHOOK_ID,
    name: 'Hook',
    description: null,
    url: 'https://example.com/hook',
    secret: 'whsec_abcdefghijklmnop',
    subscribedEvents: ['catalog.product.created'],
    httpMethod: 'POST',
    isActive: true,
    deliveryStrategy: 'http',
    maxRetries: 3,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    customHeaders: {
      Authorization: 'Bearer live-destination-token',
      'x-api-key': 'dest-api-key-123',
      'x-mock-webhook-token': 'shared-secret',
      'x-source': 'open-mercato',
    },
    strategyConfig: null,
    timeoutMs: 5000,
    rateLimitPerMinute: 0,
    autoDisableThreshold: 5,
    integrationId: null,
    previousSecretSetAt: null,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    deletedAt: null,
  }
}

let webhookRecord = makeWebhook()
let grantedFeatures: string[] = []

const mockRbac = {
  userHasAllFeatures: jest.fn(async (_sub: string, required: string[]) =>
    required.every((feature) => grantedFeatures.includes(feature) || grantedFeatures.includes('webhooks.*')),
  ),
  loadAcl: jest.fn(async () => ({ isSuperAdmin: false, features: grantedFeatures, organizations: null })),
}

const mockEm = {
  fork: jest.fn(() => mockEm),
  flush: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: (token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbac
    if (token === 'cache') return null
    if (token === 'commandOptimisticLockGuardService') throw new Error('not registered')
    return null
  },
}

const authContext = { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1', roles: [] }

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/subscription-cache', () => ({
  invalidateWebhookSubscriptionCacheFor: jest.fn(async () => undefined),
}))

jest.mock('../../../helpers', () => {
  const actual = jest.requireActual('../../../helpers')
  return {
    ...actual,
    resolveWebhookRequestScope: jest.fn(async () => ({
      container: mockContainer,
      em: mockEm,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      allowedOrganizationIds: null,
      auth: authContext,
    })),
    findScopedWebhook: jest.fn(async () => webhookRecord),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string, params?: Record<string, string>) =>
      (fallback ?? '').replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ''),
  })),
}))

import { GET, PUT } from '../route'

const context = { params: Promise.resolve({ id: WEBHOOK_ID }) }

function request(method: string, body?: unknown) {
  return new Request(`http://localhost/api/webhooks/${WEBHOOK_ID}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function readHeaders(res: Response): Promise<Record<string, string> | null> {
  const body = (await res.json()) as { customHeaders: Record<string, string> | null }
  return body.customHeaders
}

describe('webhook custom credential headers (issue #7237)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    webhookRecord = makeWebhook()
  })

  describe('GET', () => {
    it('redacts credential-like header values for a webhooks.view-only caller', async () => {
      grantedFeatures = ['webhooks.view']

      const headers = await readHeaders(await GET(request('GET'), context))

      expect(headers).toEqual({
        Authorization: REDACTED,
        'x-api-key': REDACTED,
        'x-mock-webhook-token': REDACTED,
        'x-source': 'open-mercato',
      })
    })

    it('keeps the response shape: header names stay visible, values stay strings', async () => {
      grantedFeatures = ['webhooks.view']

      const headers = await readHeaders(await GET(request('GET'), context))

      expect(Object.keys(headers ?? {}).sort()).toEqual(
        ['Authorization', 'x-api-key', 'x-mock-webhook-token', 'x-source'].sort(),
      )
      for (const value of Object.values(headers ?? {})) expect(typeof value).toBe('string')
    })

    it('redacts for webhooks.manage without webhooks.secrets', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const headers = await readHeaders(await GET(request('GET'), context))

      expect(headers?.Authorization).toBe(REDACTED)
    })

    it('returns values verbatim to a webhooks.secrets holder', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.secrets']

      const headers = await readHeaders(await GET(request('GET'), context))

      expect(headers).toEqual(makeWebhook().customHeaders)
    })

    it('checks webhooks.secrets in the scope of the webhook being returned', async () => {
      grantedFeatures = ['webhooks.view']

      await GET(request('GET'), context)

      expect(mockRbac.userHasAllFeatures).toHaveBeenCalledWith('user-1', ['webhooks.secrets'], {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })
    })

    it('returns null headers unchanged', async () => {
      grantedFeatures = ['webhooks.view']
      webhookRecord.customHeaders = null

      expect(await readHeaders(await GET(request('GET'), context))).toBeNull()
    })
  })

  describe('PUT', () => {
    beforeEach(() => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']
    })

    it('keeps stored credential values when the redaction marker is echoed back', async () => {
      const res = await PUT(
        request('PUT', {
          name: 'Renamed',
          customHeaders: {
            Authorization: REDACTED,
            'x-api-key': REDACTED,
            'x-mock-webhook-token': REDACTED,
            'x-source': 'erp',
          },
        }),
        context,
      )

      expect(res.status).toBe(200)
      expect(webhookRecord.customHeaders).toEqual({
        Authorization: 'Bearer live-destination-token',
        'x-api-key': 'dest-api-key-123',
        'x-mock-webhook-token': 'shared-secret',
        'x-source': 'erp',
      })
      expect(webhookRecord.name).toBe('Renamed')
    })

    it('matches the stored header case-insensitively when the marker is echoed', async () => {
      await PUT(request('PUT', { customHeaders: { authorization: REDACTED } }), context)

      expect(webhookRecord.customHeaders).toEqual({ authorization: 'Bearer live-destination-token' })
    })

    it('replaces a credential value when a new one is sent', async () => {
      await PUT(request('PUT', { customHeaders: { Authorization: 'Bearer rotated' } }), context)

      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer rotated' })
    })

    it('drops a credential header the caller omits', async () => {
      await PUT(request('PUT', { customHeaders: { 'x-source': 'erp' } }), context)

      expect(webhookRecord.customHeaders).toEqual({ 'x-source': 'erp' })
    })

    it('rejects the marker for a header that has no stored value instead of saving it', async () => {
      const res = await PUT(request('PUT', { customHeaders: { 'x-new-token': REDACTED } }), context)

      expect(res.status).toBe(400)
      expect(webhookRecord.customHeaders).toEqual(makeWebhook().customHeaders)
    })

    it('redacts the PUT response the same way as GET for a caller without webhooks.secrets', async () => {
      const res = await PUT(request('PUT', { name: 'Renamed' }), context)

      expect((await readHeaders(res))?.Authorization).toBe(REDACTED)
    })
    it('names the header in the orphan-marker error', async () => {
      const res = await PUT(request('PUT', { customHeaders: { 'x-new-token': REDACTED } }), context)

      expect(((await res.json()) as { error: string }).error).toContain('x-new-token')
    })

    it('stores a value that only starts with the marker as a new value', async () => {
      await PUT(request('PUT', { customHeaders: { Authorization: `${REDACTED}x` } }), context)

      expect(webhookRecord.customHeaders).toEqual({ Authorization: `${REDACTED}x` })
    })

    it('clears all headers when customHeaders is null', async () => {
      await PUT(request('PUT', { customHeaders: null }), context)

      expect(webhookRecord.customHeaders).toBeNull()
    })

    it('rejects an ambiguous marker when two stored names differ only by case', async () => {
      webhookRecord.customHeaders = { Authorization: 'Bearer a', authorization: 'Bearer b' }

      const res = await PUT(request('PUT', { customHeaders: { AUTHORIZATION: REDACTED } }), context)

      expect(res.status).toBe(400)
      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer a', authorization: 'Bearer b' })
    })

    it('matches a stored name that differs only by surrounding whitespace', async () => {
      webhookRecord.customHeaders = { ' Authorization': 'Bearer padded' }

      await PUT(request('PUT', { customHeaders: { Authorization: REDACTED } }), context)

      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer padded' })
    })
  })

  describe('PUT with a changed URL', () => {
    it('refuses to keep hidden credential values for a caller without webhooks.secrets', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const res = await PUT(
        request('PUT', {
          url: 'https://attacker.example.net/collect',
          customHeaders: { Authorization: REDACTED, 'x-source': 'open-mercato' },
        }),
        context,
      )

      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toContain('Authorization')
      expect(webhookRecord.url).toBe('https://example.com/hook')
      expect(webhookRecord.customHeaders).toEqual(makeWebhook().customHeaders)
    })

    it('refuses when customHeaders is omitted and stored credential headers would follow the new URL', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const res = await PUT(request('PUT', { url: 'https://attacker.example.net/collect' }), context)

      expect(res.status).toBe(400)
      expect(webhookRecord.url).toBe('https://example.com/hook')
    })

    it('accepts the move when the caller re-enters or removes every credential header', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const res = await PUT(
        request('PUT', {
          url: 'https://other.example.net/hook',
          customHeaders: { Authorization: 'Bearer re-entered', 'x-source': 'open-mercato' },
        }),
        context,
      )

      expect(res.status).toBe(200)
      expect(webhookRecord.url).toBe('https://other.example.net/hook')
      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer re-entered', 'x-source': 'open-mercato' })
    })

    it('refuses when only the path changes on the same host', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const res = await PUT(
        request('PUT', { url: 'https://example.com/attacker-bin', customHeaders: { Authorization: REDACTED } }),
        context,
      )

      expect(res.status).toBe(400)
      expect(webhookRecord.url).toBe('https://example.com/hook')
    })

    it('keeps hidden values when the unchanged URL is sent back', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage']

      const res = await PUT(
        request('PUT', { name: 'Renamed', url: 'https://example.com/hook', customHeaders: { Authorization: REDACTED } }),
        context,
      )

      expect(res.status).toBe(200)
      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer live-destination-token' })
    })

    it('lets a webhooks.secrets holder keep stored values on a new host', async () => {
      grantedFeatures = ['webhooks.view', 'webhooks.manage', 'webhooks.secrets']

      const res = await PUT(
        request('PUT', { url: 'https://other.example.net/hook', customHeaders: { Authorization: REDACTED } }),
        context,
      )

      expect(res.status).toBe(200)
      expect(webhookRecord.customHeaders).toEqual({ Authorization: 'Bearer live-destination-token' })
    })
  })
})
