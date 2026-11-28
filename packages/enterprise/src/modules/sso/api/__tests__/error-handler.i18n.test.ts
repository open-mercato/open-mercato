import type { EntityManager } from '@mikro-orm/postgresql'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { invalidateDictionaryCache } from '@open-mercato/shared/lib/i18n/server'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'
import { SsoConfig } from '../../data/entities'
import type { SsoProviderRegistry } from '../../lib/registry'
import { SsoConfigService } from '../../services/ssoConfigService'
import { ScimTokenError } from '../../services/scimTokenService'
import type { SsoAuthorizationService } from '../../services/ssoAuthorizationService'
import { handleSsoAdminApiError } from '../error-handler'
import { POST as createConfig } from '../config/route'
import { DELETE as deleteConfig } from '../config/[id]/route'
import { POST as addDomain, DELETE as removeDomain } from '../config/[id]/domains/route'

const mockDictionaries = { en, pl, de, es, ko }
let mockLocale: keyof typeof mockDictionaries = 'pl'
let mockService: SsoConfigService

jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: mockLocale }) }),
  headers: async () => new Headers(),
}))
jest.mock('@open-mercato/shared/lib/i18n/app-dictionaries', () => ({
  loadAppDictionary: async (locale: keyof typeof mockDictionaries) => mockDictionaries[locale] ?? {},
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'admin-1', tenantId: 'tenant-1', orgId: 'org-1' }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => mockService }),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))
jest.mock('../../events', () => ({ emitSsoEvent: jest.fn().mockResolvedValue(undefined) }))

const CONFIG_ID = '11111111-1111-4111-8111-111111111111'
const routeContext = { params: Promise.resolve({ id: CONFIG_ID }) }

function buildService(existingConfig: SsoConfig | null): SsoConfigService {
  const em = {
    findOne: jest.fn().mockResolvedValue(existingConfig),
    flush: jest.fn().mockResolvedValue(undefined),
    getConnection: jest.fn().mockReturnValue({ execute: jest.fn().mockResolvedValue([]) }),
    transactional: jest.fn(),
  }
  em.transactional.mockImplementation(async (callback: (tx: EntityManager) => Promise<unknown>) => callback(em as unknown as EntityManager))
  return new SsoConfigService(
    em as unknown as EntityManager,
    { encryptEntityPayload: jest.fn() } as unknown as TenantDataEncryptionService,
    { resolve: jest.fn() } as unknown as SsoProviderRegistry,
    { assertConfiguration: jest.fn() } as unknown as SsoAuthorizationService,
  )
}

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readError(response: Response): Promise<string> {
  const body = await response.json() as { error?: string }
  return body.error ?? ''
}

beforeEach(() => {
  mockLocale = 'pl'
  invalidateDictionaryCache()
})

describe('SSO admin API errors are translated for the request locale', () => {
  describe('deleted configuration (404)', () => {
    beforeEach(() => {
      mockService = buildService(null)
    })

    it('returns the Polish not-found text when deleting a deleted config', async () => {
      const response = await deleteConfig(jsonRequest(`http://localhost/api/sso/config/${CONFIG_ID}`, 'DELETE'), routeContext)
      expect(response.status).toBe(404)
      await expect(readError(response)).resolves.toBe(pl['sso.admin.error.notFound'])
    })

    it('returns the Polish not-found text when adding a domain to a deleted config', async () => {
      const response = await addDomain(
        jsonRequest(`http://localhost/api/sso/config/${CONFIG_ID}/domains`, 'POST', { domain: 'example.com' }),
        routeContext,
      )
      expect(response.status).toBe(404)
      await expect(readError(response)).resolves.toBe(pl['sso.admin.error.notFound'])
    })

    it('returns the Polish not-found text when removing a domain from a deleted config', async () => {
      const response = await removeDomain(
        jsonRequest(`http://localhost/api/sso/config/${CONFIG_ID}/domains?domain=example.com`, 'DELETE'),
        routeContext,
      )
      expect(response.status).toBe(404)
      await expect(readError(response)).resolves.toBe(pl['sso.admin.error.notFound'])
    })

    it.each(['en', 'de', 'es', 'ko'] as const)('returns the %s not-found text for the same request', async (locale) => {
      mockLocale = locale
      const response = await deleteConfig(jsonRequest(`http://localhost/api/sso/config/${CONFIG_ID}`, 'DELETE'), routeContext)
      expect(response.status).toBe(404)
      await expect(readError(response)).resolves.toBe(mockDictionaries[locale]['sso.admin.error.notFound'])
    })
  })

  it('returns the Polish conflict text when the wizard creates a second config (409)', async () => {
    mockService = buildService(Object.assign(new SsoConfig(), { id: CONFIG_ID, organizationId: 'org-1' }))
    const response = await createConfig(jsonRequest('http://localhost/api/sso/config', 'POST', {
      name: 'Second IdP',
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'client',
      clientSecret: 'secret',
      allowedDomains: ['example.com'],
    }))
    expect(response.status).toBe(409)
    const message = await readError(response)
    expect(message).toBe(pl['sso.admin.error.alreadyExists'])
    expect(message).not.toBe(en['sso.admin.error.alreadyExists'])
  })

  it('interpolates parameters and translates SCIM token errors', async () => {
    const response = await handleSsoAdminApiError(
      new ScimTokenError('Cannot create SCIM tokens while JIT provisioning is enabled. Disable JIT first.', 409, { key: 'sso.errors.scimBlockedByJit' }),
      'SCIM Tokens API',
    )
    expect(response.status).toBe(409)
    await expect(readError(response)).resolves.toBe(pl['sso.errors.scimBlockedByJit'])
  })

  it('translates errors raised by another bundled module copy through their translation key', async () => {
    const foreign = Object.assign(new Error('SSO domain "example.com" is already claimed by another active SSO configuration'), {
      [Symbol.for('@open-mercato/sso/SsoConfigError')]: true,
      statusCode: 409,
      translationKey: 'sso.errors.domainClaimed',
      translationParams: { domain: 'example.com' },
    })
    const response = await handleSsoAdminApiError(foreign, 'SSO Config API')
    expect(response.status).toBe(409)
    await expect(readError(response)).resolves.toBe(pl['sso.errors.domainClaimed'].replace('{domain}', 'example.com'))
  })

  it('translates the validation failure literal returned by the route', async () => {
    mockService = buildService(null)
    const response = await addDomain(
      jsonRequest(`http://localhost/api/sso/config/${CONFIG_ID}/domains`, 'POST', {}),
      routeContext,
    )
    expect(response.status).toBe(400)
    await expect(readError(response)).resolves.toBe(pl['sso.errors.invalidRequest'])
  })
})
