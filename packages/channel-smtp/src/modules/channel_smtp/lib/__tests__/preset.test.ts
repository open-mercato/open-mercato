import { applySmtpEnvPreset, readSmtpEnvPreset } from '../preset'

const reportError = jest.fn()
const ensureSystemEmailChannel = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportError(...args) }),
}))

jest.mock('@open-mercato/core/modules/communication_channels/lib/ensure-system-email-channel', () => ({
  ensureSystemEmailChannel: (...args: unknown[]) => ensureSystemEmailChannel(...args),
}))

const SMTP_ENV_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_TLS'] as const
const EMAIL_ENV_KEYS = ['NOTIFICATIONS_EMAIL_FROM', 'EMAIL_FROM', 'ADMIN_EMAIL', 'SYSTEM_EMAIL_PROVIDER'] as const

function clearEnv(): void {
  for (const key of [...SMTP_ENV_KEYS, ...EMAIL_ENV_KEYS]) delete process.env[key]
}

function setFullEnv(): void {
  process.env.SMTP_HOST = 'smtp.example.com'
  process.env.SMTP_USER = 'mailer'
  process.env.SMTP_PASSWORD = 'secret'
  process.env.NOTIFICATIONS_EMAIL_FROM = 'no-reply@example.com'
}

describe('readSmtpEnvPreset', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('returns null when nothing is configured', () => {
    expect(readSmtpEnvPreset()).toBeNull()
  })

  it('defaults to port 587 with STARTTLS', () => {
    setFullEnv()
    expect(readSmtpEnvPreset()).toEqual({
      host: 'smtp.example.com',
      port: 587,
      tls: 'starttls',
      user: 'mailer',
      password: 'secret',
      fromAddress: 'no-reply@example.com',
    })
  })

  it('defaults port 465 to implicit TLS, which is what that port actually speaks', () => {
    setFullEnv()
    process.env.SMTP_PORT = '465'
    expect(readSmtpEnvPreset()).toEqual(expect.objectContaining({ port: 465, tls: 'tls' }))
  })

  it('honours an explicit SMTP_TLS over the port-derived default', () => {
    setFullEnv()
    process.env.SMTP_PORT = '465'
    process.env.SMTP_TLS = 'starttls'
    expect(readSmtpEnvPreset()).toEqual(expect.objectContaining({ tls: 'starttls' }))
  })

  it('falls back to port 587 for an unusable SMTP_PORT', () => {
    setFullEnv()
    process.env.SMTP_PORT = 'not-a-port'
    expect(readSmtpEnvPreset()).toEqual(expect.objectContaining({ port: 587 }))
  })

  it.each(['SMTP_USER', 'SMTP_PASSWORD'])('returns null when %s is missing', (missing) => {
    setFullEnv()
    delete process.env[missing]
    expect(readSmtpEnvPreset()).toBeNull()
  })

  it('returns null when a host is set but no from-address is resolvable', () => {
    setFullEnv()
    delete process.env.NOTIFICATIONS_EMAIL_FROM
    expect(readSmtpEnvPreset()).toBeNull()
  })
})

describe('applySmtpEnvPreset', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  function makeCtx() {
    const saved: Array<{ integrationId: string; credentials: Record<string, unknown> }> = []
    const enabled: string[] = []
    return {
      saved,
      enabled,
      ctx: {
        em: {} as never,
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        container: {
          resolve(key: string) {
            if (key === 'integrationCredentialsService') {
              return { async save(integrationId: string, credentials: Record<string, unknown>) {
                saved.push({ integrationId, credentials })
              } }
            }
            if (key === 'integrationStateService') {
              return { async upsert(integrationId: string) { enabled.push(integrationId) } }
            }
            throw new Error(`unknown service ${key}`)
          },
        } as never,
      },
    }
  }

  it('seeds nothing when another provider is selected, even with a full SMTP block', async () => {
    setFullEnv()
    process.env.SYSTEM_EMAIL_PROVIDER = 'resend'
    const { ctx, saved, enabled } = makeCtx()

    await applySmtpEnvPreset(ctx)

    expect(saved).toHaveLength(0)
    expect(enabled).toHaveLength(0)
  })

  it('seeds nothing when smtp is selected but the block is incomplete', async () => {
    process.env.SYSTEM_EMAIL_PROVIDER = 'smtp'
    process.env.SMTP_HOST = 'smtp.example.com'
    const { ctx, saved } = makeCtx()

    await applySmtpEnvPreset(ctx)

    expect(saved).toHaveLength(0)
  })

  it('reports a failed integration-state upsert and still provisions the system email channel', async () => {
    setFullEnv()
    process.env.SYSTEM_EMAIL_PROVIDER = 'smtp'
    reportError.mockClear()
    ensureSystemEmailChannel.mockClear()
    const failure = new Error('state store unavailable')
    const { ctx, saved } = makeCtx()
    const resolve = ctx.container.resolve.bind(ctx.container)
    ctx.container = {
      resolve(key: string) {
        if (key === 'integrationStateService') return { async upsert() { throw failure } }
        return resolve(key)
      },
    } as never

    await applySmtpEnvPreset(ctx)

    expect(saved).toHaveLength(1)
    expect(reportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'channel_smtp',
      code: 'channel_smtp.preset_state_upsert_failed',
    }))
    expect(ensureSystemEmailChannel).toHaveBeenCalledTimes(1)
  })
})
