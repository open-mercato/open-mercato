import type { ModuleConfig } from '../../../configs/data/entities'
import { createModuleConfigService } from '../../../configs/lib/module-config-service'
import { type NotificationDeliveryConfig, NOTIFICATIONS_DELIVERY_CONFIG_KEY, resolveNotificationDeliveryConfig, saveNotificationDeliveryConfig } from '../../lib/deliveryConfig'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const instanceConfig = {
  appUrl: 'https://operator.example',
  panelPath: '/backend/notifications',
  strategies: { email: { enabled: true, from: 'operator@example.com', replyTo: 'support@example.com' } },
}
let auth: { sub: string; tenantId: string | null; orgId: string | null; actorTenantId?: string; isSuperAdmin?: boolean } | null
const rows = new Map<string | null, ModuleConfig>()
const cache = new Map<string, unknown>()
const repository = {
  findOne: jest.fn(async ({ tenantId }: { tenantId: string | null }) => rows.get(tenantId) ?? null),
  create: (value: ModuleConfig) => value,
}
const em = {
  getRepository: () => repository,
  persist: (record: ModuleConfig) => rows.set(record.tenantId ?? null, record),
  flush: async () => undefined,
}
const container = {
  resolve: <T,>(name: string): T => {
    if (name === 'moduleConfigService') return configService as T
    if (name === 'em') return em as T
    if (name === 'cache') return {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: unknown) => { cache.set(key, value) },
      deleteByTags: async () => { cache.clear() },
    } as T
    throw new Error(`[internal] Unexpected service ${name}`)
  },
}
const configService = createModuleConfigService(container as never)

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: async () => auth }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: async () => ({ ok: true, runAfterSuccess: async () => undefined }),
}))

import { GET, POST } from '../settings/route'

const request = (body?: unknown) => new Request('https://untrusted-host.example/api/notifications/settings', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
const readSettings = async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  return ((await response.json()) as { settings: NotificationDeliveryConfig }).settings
}

describe('notification settings route with the real scoped module config service and cache', () => {
  beforeEach(() => {
    rows.clear()
    cache.clear()
    repository.findOne.mockClear()
    rows.set(null, {
      moduleId: 'notifications', name: NOTIFICATIONS_DELIVERY_CONFIG_KEY, valueJson: instanceConfig,
      tenantId: null, organizationId: null, createdAt: new Date(), updatedAt: new Date(),
    } as ModuleConfig)
    auth = { sub: 'admin-a', tenantId: tenantA, orgId: null }
  })

  it('isolates tenant settings, cached defaults, senders and switches without mutating the instance fallback', async () => {
    const original = JSON.stringify(rows.get(null)?.valueJson)
    auth!.tenantId = tenantB
    const beforeB = await readSettings()
    auth!.tenantId = tenantA
    expect((await readSettings()).strategies.email.replyTo).toBe('support@example.com')
    const response = await POST(request({
      tenantId: tenantB,
      appUrl: 'https://operator.example/tenant-a',
      strategies: { email: { enabled: false, from: 'tenant-a@example.com', replyTo: 'reply-a@example.com', subjectPrefix: '[A]' } },
    }))
    expect(response.status).toBe(200)
    expect(rows.has(tenantA)).toBe(true)
    expect(rows.has(tenantB)).toBe(false)
    expect((await readSettings()).strategies.email).toEqual(expect.objectContaining({ enabled: false, replyTo: 'reply-a@example.com' }))
    auth!.tenantId = tenantB
    expect(await readSettings()).toEqual(beforeB)
    expect(JSON.stringify(rows.get(null)?.valueJson)).toBe(original)
    const deliveryA = await resolveNotificationDeliveryConfig(container, { tenantId: tenantA })
    const deliveryB = await resolveNotificationDeliveryConfig(container, { tenantId: tenantB })
    expect(deliveryA.strategies.email.from).toBe('tenant-a@example.com')
    expect(deliveryB.strategies.email.from).toBe('operator@example.com')
  })

  it.each([
    'https://attacker.example', 'https://operator.example.attacker.example',
    'https://operator.example@attacker.example', 'https://user@operator.example',
    'http://operator.example', 'https://operator.example:444', 'javascript:alert(1)',
    'https://untrusted-host.example',
  ])('rejects a tenant appUrl outside the trusted origin: %s', async (appUrl) => {
    expect((await POST(request({ appUrl }))).status).toBe(400)
    expect(rows.has(tenantA)).toBe(false)
  })

  it('also rejects unsafe origins in scoped server writes and sanitizes existing tenant rows at delivery', async () => {
    await expect(saveNotificationDeliveryConfig(container, { appUrl: 'https://attacker.example' }, { tenantId: tenantA })).rejects.toThrow('instance origin')
    rows.set(tenantA, { ...rows.get(null)!, tenantId: tenantA, valueJson: { ...instanceConfig, appUrl: 'https://attacker.example' } })
    const config = await resolveNotificationDeliveryConfig(container, { tenantId: tenantA })
    expect(config.appUrl).toBe(instanceConfig.appUrl)
  })

  it('keeps legacy server calls compatible and tenant fallback read-only', async () => {
    expect((await resolveNotificationDeliveryConfig(container)).appUrl).toBe(instanceConfig.appUrl)
    await saveNotificationDeliveryConfig(container, { ...instanceConfig, panelPath: '/backend/alerts' })
    expect(rows.get(null)?.valueJson).toEqual(expect.objectContaining({ panelPath: '/backend/alerts' }))
  })

  it('uses the selected authenticated tenant ahead of the actor tenant', async () => {
    auth!.tenantId = tenantB
    auth!.actorTenantId = tenantA
    auth!.isSuperAdmin = true
    const response = await POST(request({ strategies: { email: { enabled: false } } }))
    expect(response.status).toBe(200)
    expect(rows.has(tenantB)).toBe(true)
    expect(rows.has(tenantA)).toBe(false)
  })

  it('fails closed for tenantless reads and writes, including superadmins', async () => {
    auth!.tenantId = null
    auth!.isSuperAdmin = true
    expect((await GET(request())).status).toBe(403)
    expect((await POST(request({ strategies: { email: { enabled: false } } }))).status).toBe(403)
    expect(repository.findOne).not.toHaveBeenCalled()
  })

  it('keeps an actor tenant fallback scoped and rejects unauthenticated access', async () => {
    auth!.tenantId = null
    auth!.actorTenantId = tenantA
    const response = await POST(request({ panelPath: '/backend/alerts' }))
    const body = await response.json()
    expect({ status: response.status, error: body.error }).toEqual({ status: 200, error: undefined })
    expect(rows.has(tenantA)).toBe(true)
    expect((await readSettings()).appUrl).toBe(instanceConfig.appUrl)
    auth = null
    expect((await GET(request())).status).toBe(401)
    expect((await POST(request({}))).status).toBe(401)
  })

  it('rejects a tenant appUrl when no operator origin is configured', async () => {
    rows.get(null)!.valueJson = { ...instanceConfig, appUrl: undefined }
    const envKeys = ['APPLICATION_URL', 'NEXT_PUBLIC_APP_URL', 'APP_URL'] as const
    const previous = envKeys.map((key) => process.env[key])
    for (const key of envKeys) delete process.env[key]
    try {
      expect((await POST(request({ appUrl: 'https://attacker.example' }))).status).toBe(400)
    } finally {
      envKeys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key]
        else process.env[key] = previous[index]
      })
    }
  })
})
