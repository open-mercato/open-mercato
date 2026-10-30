type DeliveryConfigModule = typeof import('../deliveryConfig')

const SENDER_ENV_KEYS = [
  'NOTIFICATIONS_EMAIL_FROM',
  'EMAIL_FROM',
  'ADMIN_EMAIL',
  'NOTIFICATIONS_EMAIL_REPLY_TO',
] as const

const originalEnv: Partial<Record<(typeof SENDER_ENV_KEYS)[number], string | undefined>> = {}

function loadDeliveryConfig(env: Partial<Record<(typeof SENDER_ENV_KEYS)[number], string>>): DeliveryConfigModule {
  for (const key of SENDER_ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  let loaded: DeliveryConfigModule | undefined
  jest.isolateModules(() => {
    loaded = require('../deliveryConfig') as DeliveryConfigModule
  })
  if (!loaded) throw new Error('[internal] deliveryConfig module failed to load')
  return loaded
}

function createResolver(storedValue: unknown) {
  const service = {
    getValue: jest.fn(async () => storedValue),
    setValue: jest.fn(async () => undefined),
  }
  return {
    service,
    resolver: { resolve: <T,>() => service as unknown as T },
  }
}

describe('notifications delivery config sender resolution', () => {
  beforeAll(() => {
    for (const key of SENDER_ENV_KEYS) originalEnv[key] = process.env[key]
  })

  afterAll(() => {
    for (const key of SENDER_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  })

  it('ignores a stored .env.example placeholder sender so the environment sender applies at send time', async () => {
    const { resolveNotificationDeliveryConfig } = loadDeliveryConfig({
      NOTIFICATIONS_EMAIL_FROM: 'notifications@acme.test',
    })
    const { resolver } = createResolver({
      strategies: { email: { enabled: true, from: 'ops@your-domain.com', replyTo: 'ops@your-domain.com' } },
    })

    const config = await resolveNotificationDeliveryConfig(resolver)

    expect(config.strategies.email.enabled).toBe(true)
    expect(config.strategies.email.from).toBeUndefined()
    expect(config.strategies.email.replyTo).toBeUndefined()
  })

  it('treats placeholder senders case-insensitively and in display-name form', async () => {
    const { resolveNotificationDeliveryConfig } = loadDeliveryConfig({})
    const { resolver } = createResolver({
      strategies: { email: { enabled: true, from: 'Ops <OPS@Your-Domain.com>', replyTo: ' support@your-domain.com ' } },
    })

    const config = await resolveNotificationDeliveryConfig(resolver)

    expect(config.strategies.email.from).toBeUndefined()
    expect(config.strategies.email.replyTo).toBeUndefined()
  })

  it('keeps a deliberately stored real sender', async () => {
    const { resolveNotificationDeliveryConfig } = loadDeliveryConfig({
      NOTIFICATIONS_EMAIL_FROM: 'notifications@acme.test',
    })
    const { resolver } = createResolver({
      strategies: { email: { enabled: true, from: 'Billing <billing@acme.test>', replyTo: 'help@acme.test' } },
    })

    const config = await resolveNotificationDeliveryConfig(resolver)

    expect(config.strategies.email.from).toBe('Billing <billing@acme.test>')
    expect(config.strategies.email.replyTo).toBe('help@acme.test')
  })

  it('does not persist a placeholder sender when settings are saved', async () => {
    const { saveNotificationDeliveryConfig } = loadDeliveryConfig({})
    const { resolver, service } = createResolver(null)

    await saveNotificationDeliveryConfig(resolver, {
      strategies: { email: { enabled: true, from: 'ops@your-domain.com', replyTo: 'help@acme.test' } },
    })

    expect(service.setValue).toHaveBeenCalledTimes(1)
    const persisted = service.setValue.mock.calls[0][2] as { strategies: { email: { from?: string; replyTo?: string } } }
    expect(persisted.strategies.email.from).toBeUndefined()
    expect(persisted.strategies.email.replyTo).toBe('help@acme.test')
  })

  it('stores restore-defaults without pinning the environment sender', () => {
    const { STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG, DEFAULT_NOTIFICATION_DELIVERY_CONFIG } = loadDeliveryConfig({
      NOTIFICATIONS_EMAIL_FROM: 'notifications@acme.test',
      NOTIFICATIONS_EMAIL_REPLY_TO: 'help@acme.test',
    })

    expect(DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.from).toBe('notifications@acme.test')
    expect(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.from).toBeUndefined()
    expect(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.replyTo).toBe('help@acme.test')
    expect(JSON.parse(JSON.stringify(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG)).strategies.email).not.toHaveProperty('from')
  })

  it('does not store the .env.example ADMIN_EMAIL placeholder as the default reply-to', () => {
    const { STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG } = loadDeliveryConfig({
      ADMIN_EMAIL: 'ops@your-domain.com',
    })

    expect(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.from).toBeUndefined()
    expect(STORED_DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.replyTo).toBeUndefined()
  })
})

describe('notifications delivery config stored panelPath', () => {
  it('drops only a stored panelPath that resolves to another origin and keeps the rest of the config', async () => {
    const { resolveNotificationDeliveryConfig, DEFAULT_NOTIFICATION_DELIVERY_CONFIG } = loadDeliveryConfig({})
    const { resolver } = createResolver({
      appUrl: 'https://app.acme.test',
      panelPath: '/\\evil.example',
      strategies: { email: { enabled: false, replyTo: 'help@acme.test' } },
    })

    const config = await resolveNotificationDeliveryConfig(resolver)

    expect(config.panelPath).toBe(DEFAULT_NOTIFICATION_DELIVERY_CONFIG.panelPath)
    expect(config.appUrl).toBe('https://app.acme.test')
    expect(config.strategies.email.enabled).toBe(false)
    expect(config.strategies.email.replyTo).toBe('help@acme.test')
  })

  it('still falls back to the defaults when another field is invalid', async () => {
    const { resolveNotificationDeliveryConfig, DEFAULT_NOTIFICATION_DELIVERY_CONFIG } = loadDeliveryConfig({})
    const { resolver } = createResolver({
      appUrl: 'not a url',
      panelPath: '/\\evil.example',
      strategies: { email: { enabled: false } },
    })

    const config = await resolveNotificationDeliveryConfig(resolver)

    expect(config.appUrl).toBe(DEFAULT_NOTIFICATION_DELIVERY_CONFIG.appUrl)
    expect(config.strategies.email.enabled).toBe(DEFAULT_NOTIFICATION_DELIVERY_CONFIG.strategies.email.enabled)
  })
})
