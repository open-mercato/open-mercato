import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORE_ID = '33333333-3333-4333-8333-333333333333'
const INITIAL_UPDATED_AT = '2026-01-01T00:00:00.000Z'

type StoreState = {
  id: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
  updatedAt: Date
  settings: Record<string, unknown>
}

let store: StoreState
let guards: MutationGuard[] = []
let grantedFeatures: string[] = ['ecommerce.branding.manage']
let flushCount = 0

const emitMock = jest.fn(async (..._args: unknown[]) => {})
const invalidateCrudCacheMock = jest.fn(async (..._args: unknown[]) => {})

const em = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    const matches =
      where.id === store.id &&
      where.tenantId === store.tenantId &&
      where.organizationId === store.organizationId &&
      where.deletedAt === null &&
      store.deletedAt === null
    return matches ? store : null
  }),
  flush: jest.fn(async () => {
    flushCount += 1
    store.updatedAt = new Date(store.updatedAt.getTime() + 60_000)
  }),
  fork: (): unknown => em,
}

type CommandHandlerLike = {
  prepare?: (input: unknown, ctx: unknown) => Promise<{ before?: unknown } | null>
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  captureAfter?: (input: unknown, result: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: unknown) => Promise<Record<string, unknown> | null | undefined>
  undo?: (args: { input: unknown; ctx: unknown; logEntry: unknown }) => Promise<void>
}

const commandBus = {
  execute: jest.fn(async (commandId: string, options: { input: unknown; ctx: unknown }) => {
    const handler = commandRegistry.get(commandId) as unknown as CommandHandlerLike
    const prepared = await handler.prepare?.(options.input, options.ctx)
    const result = await handler.execute(options.input, options.ctx)
    const after = await handler.captureAfter?.(options.input, result, options.ctx)
    const metadata = await handler.buildLog?.({
      input: options.input,
      result,
      ctx: options.ctx,
      snapshots: { before: prepared?.before, after },
    })
    const logEntry = metadata
      ? {
          ...metadata,
          id: 'log-1',
          undoToken: 'undo-token-1',
          commandId,
          commandPayload: metadata.payload,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        }
      : null
    return { result, logEntry }
  }),
}

const rbacService = {
  getGrantedFeatures: jest.fn(async () => grantedFeatures),
}

const container = {
  hasRegistration: (name: string) => ['em', 'rbacService', 'commandBus'].includes(name),
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'commandBus') return commandBus
    throw new Error(`[internal] ${name} is not registered`)
  }),
}

let authValue: Record<string, unknown> | null = null

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({
  getAllMutationGuardInstances: jest.fn(() => guards),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    manager: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => manager.findOne(entity, where),
}))
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))
jest.mock('../../../../events', () => ({
  ...jest.requireActual('../../../../events'),
  emitEcommerceEvent: (...args: unknown[]) => emitMock(...args),
}))

import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import '../../../../commands/stores'
import { eventsConfig } from '../../../../events'
import { STORE_BRANDING_UPDATE_COMMAND_ID } from '../../../../lib/storeBranding'
import { metadata as brandingMetadata, openApi as brandingOpenApi, PUT } from '../branding/route'
import { metadata as previewMetadata, openApi as previewOpenApi, GET } from '../preview-branding/route'

const initialSettings = () => ({
  branding: { primaryColor: '#112233', logoUrl: '/logo.png' },
  contact: { email: 'shop@example.com' },
  display: { priceDisplayModeDefault: 'net', enableSearch: false },
  seo: { siteName: 'Main shop' },
})

function putRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/ecommerce/stores/${STORE_ID}/branding`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function previewRequest(query: Record<string, string>): Request {
  const search = new URLSearchParams(query).toString()
  return new Request(`http://localhost/api/ecommerce/stores/${STORE_ID}/preview-branding?${search}`)
}

const params = (id: string = STORE_ID) => ({ params: Promise.resolve({ id }) })

describe('ecommerce store branding routes', () => {
  beforeEach(() => {
    store = {
      id: STORE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
      updatedAt: new Date(INITIAL_UPDATED_AT),
      settings: initialSettings(),
    }
    guards = []
    grantedFeatures = ['ecommerce.branding.manage']
    flushCount = 0
    authValue = { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID }
    emitMock.mockClear()
    invalidateCrudCacheMock.mockClear()
    em.flush.mockClear()
    commandBus.execute.mockClear()
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  describe('feature gates', () => {
    it('gates the branding write and the preview behind ecommerce.branding.manage only', () => {
      expect(brandingMetadata).toEqual({ PUT: { requireAuth: true, requireFeatures: ['ecommerce.branding.manage'] } })
      expect(previewMetadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['ecommerce.branding.manage'] } })
      const required = brandingMetadata.PUT.requireFeatures
      expect(authorizeFeatures(required, { grantedFeatures: ['ecommerce.stores.manage'], unrestricted: false, scopeAllowed: true })).toBe(false)
      expect(authorizeFeatures(required, { grantedFeatures: ['ecommerce.branding.manage'], unrestricted: false, scopeAllowed: true })).toBe(true)
    })

    it('answers 401 without an authenticated tenant', async () => {
      authValue = null
      const response = await PUT(putRequest({}), params())
      expect(response.status).toBe(401)
      expect(flushCount).toBe(0)
    })

    it('documents both routes', () => {
      expect(brandingOpenApi.methods.PUT?.requestBody).toBeDefined()
      expect(brandingOpenApi.methods.PUT?.errors?.map((error) => error.status)).toEqual(expect.arrayContaining([400, 403, 404, 409, 422]))
      expect(previewOpenApi.methods.GET?.query).toBeDefined()
    })
  })

  describe('PUT /stores/:id/branding', () => {
    it('writes only settings.branding and leaves contact, display and seo untouched', async () => {
      const response = await PUT(
        putRequest({ primaryColor: '#AABBCC', borderRadius: '0.5rem', fontFamilyBase: 'inter' }),
        params(),
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.id).toBe(STORE_ID)
      expect(body.branding).toEqual({ primaryColor: '#AABBCC', borderRadius: '0.5rem', fontFamilyBase: 'inter' })
      expect(body.updatedAt).toBe(store.updatedAt.toISOString())
      expect(store.settings).toEqual({
        ...initialSettings(),
        branding: { primaryColor: '#AABBCC', borderRadius: '0.5rem', fontFamilyBase: 'inter' },
      })
      expect(flushCount).toBe(1)
    })

    it('clears keys that are omitted or sent empty, and stores nothing else', async () => {
      const response = await PUT(putRequest({ accentColor: '', logoUrl: null }), params())
      expect(response.status).toBe(200)
      expect(store.settings.branding).toEqual({})
    })

    it('emits ecommerce.store.branding_updated and evicts the store cache after the write', async () => {
      expect(eventsConfig.events.map((event) => event.id)).toContain('ecommerce.store.branding_updated')
      await PUT(putRequest({ primaryColor: '#000000' }), params())
      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store.branding_updated',
        { id: STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
      )
      expect(invalidateCrudCacheMock).toHaveBeenCalledTimes(1)
    })

    it('returns an undoable operation header', async () => {
      const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
      const operation = deserializeOperationMetadata(response.headers.get('x-om-operation'))
      expect(operation).toMatchObject({
        commandId: STORE_BRANDING_UPDATE_COMMAND_ID,
        undoToken: 'undo-token-1',
        resourceKind: 'ecommerce.store',
        resourceId: STORE_ID,
        actionLabel: 'Update store branding',
      })
    })

    it('rejects invalid values with 400 field errors and writes nothing', async () => {
      const response = await PUT(
        putRequest({ primaryColor: 'red;}</style><script>alert(1)</script>', fontFamilyBase: 'Comic Sans', borderRadius: '9999px' }),
        params(),
      )
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.fieldErrors).toEqual({
        primaryColor: 'ecommerce.validation.colorInvalid',
        fontFamilyBase: 'ecommerce.validation.fontNotAllowed',
        borderRadius: 'ecommerce.validation.borderRadiusInvalid',
      })
      expect(body.error).toBe('ecommerce.validation.colorInvalid')
      expect(flushCount).toBe(0)
      expect(emitMock).not.toHaveBeenCalled()
      expect(store.settings).toEqual(initialSettings())
    })

    it('rejects unknown keys so the body cannot reach other settings', async () => {
      const response = await PUT(putRequest({ primaryColor: '#000000', contact: { email: 'x@y.z' }, display: {} }), params())
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(Object.keys(body.fieldErrors).sort((left, right) => left.localeCompare(right))).toEqual(['contact', 'display'])
      expect(store.settings).toEqual(initialSettings())
    })

    it('rejects a malformed JSON body with a translated message', async () => {
      const response = await PUT(putRequest('{not json'), params())
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'The request body is not valid JSON.' })
      expect(flushCount).toBe(0)
    })

    it('answers 409 with the structured conflict body on a stale updated_at and writes nothing', async () => {
      const response = await PUT(
        putRequest({ primaryColor: '#000000' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2025-12-31T00:00:00.000Z' }),
        params(),
      )
      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body).toMatchObject({
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        currentUpdatedAt: INITIAL_UPDATED_AT,
        expectedUpdatedAt: '2025-12-31T00:00:00.000Z',
      })
      expect(flushCount).toBe(0)
      expect(emitMock).not.toHaveBeenCalled()
      expect(store.settings).toEqual(initialSettings())
    })

    it('accepts the current updated_at and moves the version forward', async () => {
      const response = await PUT(
        putRequest({ primaryColor: '#000000' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: INITIAL_UPDATED_AT }),
        params(),
      )
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.updatedAt).not.toBe(INITIAL_UPDATED_AT)
      const second = await PUT(
        putRequest({ primaryColor: '#111111' }, { [OPTIMISTIC_LOCK_HEADER_NAME]: INITIAL_UPDATED_AT }),
        params(),
      )
      expect(second.status).toBe(409)
    })

    it('answers 404 for an unknown, foreign-organization or malformed store id', async () => {
      store.organizationId = OTHER_ORG_ID
      expect((await PUT(putRequest({ primaryColor: '#000000' }), params())).status).toBe(404)
      store.organizationId = ORG_ID
      expect((await PUT(putRequest({ primaryColor: '#000000' }), params('not-a-uuid'))).status).toBe(404)
      store.deletedAt = new Date()
      expect((await PUT(putRequest({ primaryColor: '#000000' }), params())).status).toBe(404)
      expect(flushCount).toBe(0)
    })

    describe('mutation guards', () => {
      const guard = (overrides: Partial<MutationGuard>): MutationGuard => ({
        id: 'test.guard',
        targetEntity: '*',
        operations: ['update'],
        validate: async () => ({ ok: true }),
        ...overrides,
      })

      it('runs registered guards as an update with the granted features and the candidate payload', async () => {
        const validate = jest.fn(async () => ({ ok: true }))
        guards = [guard({ validate, features: ['ecommerce.branding.manage'] })]
        const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
        expect(response.status).toBe(200)
        expect(validate).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: TENANT_ID,
            organizationId: ORG_ID,
            userId: 'user-1',
            resourceKind: 'ecommerce.store',
            resourceId: STORE_ID,
            operation: 'update',
            requestMethod: 'PUT',
            mutationPayload: { primaryColor: '#000000' },
          }),
        )
      })

      it('does not run guards gated behind a feature the user lacks', async () => {
        const validate = jest.fn(async () => ({ ok: false, status: 423, message: 'locked' }))
        guards = [guard({ validate, features: ['record_locks.manage'] })]
        const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
        expect(response.status).toBe(200)
        expect(validate).not.toHaveBeenCalled()
      })

      it('returns the guard rejection and writes nothing', async () => {
        guards = [guard({ validate: async () => ({ ok: false, status: 423, body: { error: 'Record is locked' } }) })]
        const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
        expect(response.status).toBe(423)
        expect(await response.json()).toEqual({ error: 'Record is locked' })
        expect(commandBus.execute).not.toHaveBeenCalled()
        expect(flushCount).toBe(0)
        expect(emitMock).not.toHaveBeenCalled()
      })

      it('merges a guard modifiedPayload before writing and re-validates it', async () => {
        guards = [guard({ validate: async () => ({ ok: true, modifiedPayload: { accentColor: '#FFFFFF' } }) })]
        const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
        expect(response.status).toBe(200)
        expect(store.settings.branding).toEqual({ primaryColor: '#000000', accentColor: '#FFFFFF' })

        guards = [guard({ validate: async () => ({ ok: true, modifiedPayload: { accentColor: 'url(javascript:alert(1))' } }) })]
        const rejected = await PUT(putRequest({ primaryColor: '#111111' }), params())
        expect(rejected.status).toBe(400)
        expect(store.settings.branding).toEqual({ primaryColor: '#000000', accentColor: '#FFFFFF' })
      })

      it('runs afterSuccess callbacks after the write and survives a failing callback', async () => {
        const afterSuccess = jest.fn(async () => {
          throw new Error('[internal] callback failed')
        })
        guards = [guard({ validate: async () => ({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'abc' } }), afterSuccess })]
        const response = await PUT(putRequest({ primaryColor: '#000000' }), params())
        expect(response.status).toBe(200)
        expect(afterSuccess).toHaveBeenCalledTimes(1)
        expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ operation: 'update', metadata: { token: 'abc' } }))
        expect(flushCount).toBe(1)
      })
    })

    it('undo restores the previous branding, keeps other settings and re-announces the change', async () => {
      const response = await PUT(putRequest({ primaryColor: '#FFFFFF' }), params())
      expect(response.status).toBe(200)
      const logResult = await commandBus.execute.mock.results[0].value
      emitMock.mockClear()
      const handler = commandRegistry.get(STORE_BRANDING_UPDATE_COMMAND_ID) as unknown as CommandHandlerLike
      await handler.undo?.({
        input: {},
        ctx: { container, auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID }, organizationScope: null, selectedOrganizationId: ORG_ID, organizationIds: [ORG_ID] },
        logEntry: logResult.logEntry,
      })
      expect(store.settings).toEqual(initialSettings())
      expect(emitMock).toHaveBeenCalledWith(
        'ecommerce.store.branding_updated',
        { id: STORE_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
        expect.objectContaining({ persistent: true }),
      )
    })
  })

  describe('GET /stores/:id/preview-branding', () => {
    it('returns the stylesheet for valid query values without writing', async () => {
      const response = await GET(previewRequest({ primaryColor: '#AABBCC', borderRadius: '8px', fontFamilyBase: 'roboto' }), params())
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.json()
      expect(body.css).toContain('--primary:#aabbcc')
      expect(body.css).toContain('--radius:8px')
      expect(body.css).toContain("--font-base:'Roboto', sans-serif")
      expect(body.css.startsWith(':root{')).toBe(true)
      expect(body.styleBlock).toBe(`<style data-ecommerce-branding>${body.css}</style>`)
      expect(body.declarations).toEqual(expect.arrayContaining([{ property: '--primary', value: '#aabbcc' }]))
      expect(em.flush).not.toHaveBeenCalled()
      expect(commandBus.execute).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
      expect(invalidateCrudCacheMock).not.toHaveBeenCalled()
      expect(store.settings).toEqual(initialSettings())
    })

    it('falls back to the defaults for values that are not supplied', async () => {
      const response = await GET(previewRequest({}), params())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.css).toContain('--primary:oklch(0.205 0 0)')
    })

    it('rejects invalid or unknown values with a 400', async () => {
      const response = await GET(previewRequest({ primaryColor: 'red;}</style>', unexpected: '1' }), params())
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.fieldErrors).toEqual({
        primaryColor: 'ecommerce.validation.colorInvalid',
        unexpected: 'This branding setting does not exist.',
      })
    })

    it('answers 404 for a store outside the selected organization', async () => {
      store.organizationId = OTHER_ORG_ID
      const response = await GET(previewRequest({ primaryColor: '#000000' }), params())
      expect(response.status).toBe(404)
    })

    it('answers 401 without an authenticated tenant', async () => {
      authValue = null
      const response = await GET(previewRequest({}), params())
      expect(response.status).toBe(401)
    })
  })
})
