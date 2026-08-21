import { setup } from '../setup'
import { TEST_SEED_PROVIDER_KEY } from '../lib/test-seed'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
}))

type SavedCredentials = {
  integrationId: string
  credentials: Record<string, unknown>
  scope: { tenantId: string; organizationId: string; userId?: string | null }
}

function buildContainer(existingCredentials: Record<string, unknown> | null) {
  const saved: SavedCredentials[] = []
  const persisted: Array<Record<string, unknown>> = []
  const em = {
    fork: () => em,
    create: (_entity: unknown, data: Record<string, unknown>) => data,
    persist: (row: Record<string, unknown>) => {
      persisted.push(row)
      return em
    },
    flush: async () => undefined,
  }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'integrationCredentialsService') {
        return {
          resolve: async () => existingCredentials,
          save: async (
            integrationId: string,
            credentials: Record<string, unknown>,
            scope: SavedCredentials['scope'],
          ) => {
            saved.push({ integrationId, credentials, scope })
          },
        }
      }
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  }
  return { container, saved, persisted }
}

const SCOPE = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}

describe('communication_channels seedDefaults — test-seed channel credentials', () => {
  const originalSeeding = process.env.OM_ENABLE_TEST_CHANNEL_SEEDING
  const originalProvider = process.env.SYSTEM_EMAIL_PROVIDER

  beforeEach(() => {
    process.env.OM_ENABLE_TEST_CHANNEL_SEEDING = 'true'
    process.env.SYSTEM_EMAIL_PROVIDER = TEST_SEED_PROVIDER_KEY
  })

  afterEach(() => {
    if (originalSeeding === undefined) delete process.env.OM_ENABLE_TEST_CHANNEL_SEEDING
    else process.env.OM_ENABLE_TEST_CHANNEL_SEEDING = originalSeeding
    if (originalProvider === undefined) delete process.env.SYSTEM_EMAIL_PROVIDER
    else process.env.SYSTEM_EMAIL_PROVIDER = originalProvider
  })

  it('seeds credentials alongside the channel so tenant-scoped sends do not fail closed', async () => {
    const { container, saved, persisted } = buildContainer(null)

    await setup.seedDefaults?.({ container, ...SCOPE } as never)

    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ providerKey: TEST_SEED_PROVIDER_KEY, channelType: 'email' })

    expect(saved).toHaveLength(1)
    expect(saved[0].integrationId).toBe(`channel_${TEST_SEED_PROVIDER_KEY}`)
    expect(saved[0].credentials).toMatchObject({ testSeed: true })
    expect(saved[0].credentials.fromAddress).toBe(persisted[0].externalIdentifier)
    expect(saved[0].scope).toMatchObject({ ...SCOPE, userId: null })
  })

  it('is idempotent — existing credentials are left alone', async () => {
    const { container, saved } = buildContainer({ testSeed: true, fromAddress: 'already@test-seed.local' })

    await setup.seedDefaults?.({ container, ...SCOPE } as never)

    expect(saved).toHaveLength(0)
  })

  it('seeds nothing when test channel seeding is disabled', async () => {
    delete process.env.OM_ENABLE_TEST_CHANNEL_SEEDING
    const { container, saved, persisted } = buildContainer(null)

    await setup.seedDefaults?.({ container, ...SCOPE } as never)

    expect(persisted).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })

  it('seeds nothing when the system email provider is not the test-seed provider', async () => {
    process.env.SYSTEM_EMAIL_PROVIDER = 'resend'
    const { container, saved, persisted } = buildContainer(null)

    await setup.seedDefaults?.({ container, ...SCOPE } as never)

    expect(persisted).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })

  it('does not abort tenant initialization when credential storage is unavailable', async () => {
    const em = {
      fork: () => em,
      create: (_entity: unknown, data: Record<string, unknown>) => data,
      persist: () => em,
      flush: async () => undefined,
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error('[internal] integrations module not registered')
      },
    }

    await expect(setup.seedDefaults?.({ container, ...SCOPE } as never)).resolves.toBeUndefined()
  })
})
