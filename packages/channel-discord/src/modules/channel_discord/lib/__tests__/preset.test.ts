import { applyDiscordEnvPreset, readDiscordEnvPreset } from '../preset'

const PUBLIC_KEY = 'a'.repeat(64)

const COMPLETE_ENV = {
  OM_CHANNEL_DISCORD_BOT_TOKEN: 'bot-token',
  OM_CHANNEL_DISCORD_APPLICATION_ID: 'app-1',
  OM_CHANNEL_DISCORD_PUBLIC_KEY: PUBLIC_KEY,
} as NodeJS.ProcessEnv

describe('readDiscordEnvPreset', () => {
  it('returns null when no Discord preset variable is set (interactive connect flow)', () => {
    expect(readDiscordEnvPreset({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('parses a complete preset including the optional guild + default channel', () => {
    const preset = readDiscordEnvPreset({
      ...COMPLETE_ENV,
      OM_CHANNEL_DISCORD_GUILD_ID: 'guild-1',
      OM_CHANNEL_DISCORD_DEFAULT_CHANNEL_ID: 'chan-1',
    } as NodeJS.ProcessEnv)

    expect(preset?.credentials).toMatchObject({
      botToken: 'bot-token',
      applicationId: 'app-1',
      publicKey: PUBLIC_KEY,
      guildId: 'guild-1',
      defaultChannelId: 'chan-1',
    })
    expect(preset?.force).toBe(false)
  })

  it('fails loudly on a half-filled preset instead of persisting unusable credentials', () => {
    expect(() =>
      readDiscordEnvPreset({ OM_CHANNEL_DISCORD_BOT_TOKEN: 'bot-token' } as NodeJS.ProcessEnv),
    ).toThrow(/Incomplete Discord env preset/)
  })

  it('reads the force flag', () => {
    const preset = readDiscordEnvPreset({
      ...COMPLETE_ENV,
      OM_CHANNEL_DISCORD_FORCE_PRECONFIGURE: 'true',
    } as NodeJS.ProcessEnv)
    expect(preset?.force).toBe(true)
  })
})

describe('applyDiscordEnvPreset', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

  function fakeCredentialsService(existing: unknown) {
    return {
      getRaw: jest.fn().mockResolvedValue(existing),
      save: jest.fn().mockResolvedValue(undefined),
    }
  }

  it('skips when no preset env is present', async () => {
    const credentialsService = fakeCredentialsService(null)
    const result = await applyDiscordEnvPreset({
      credentialsService: credentialsService as never,
      scope,
      env: {} as NodeJS.ProcessEnv,
    })

    expect(result).toEqual({ status: 'skipped', reason: 'No Discord preset env variables were provided.' })
    expect(credentialsService.save).not.toHaveBeenCalled()
  })

  it('persists the preset through the credential service on a fresh tenant', async () => {
    const credentialsService = fakeCredentialsService(null)
    const result = await applyDiscordEnvPreset({
      credentialsService: credentialsService as never,
      scope,
      env: COMPLETE_ENV,
    })

    expect(result).toEqual({ status: 'configured' })
    expect(credentialsService.save).toHaveBeenCalledWith(
      'channel_discord',
      expect.objectContaining({ botToken: 'bot-token', applicationId: 'app-1' }),
      scope,
    )
  })

  it('leaves credentials connected through the UI untouched unless forced', async () => {
    const credentialsService = fakeCredentialsService({ botToken: 'existing' })
    const result = await applyDiscordEnvPreset({
      credentialsService: credentialsService as never,
      scope,
      env: COMPLETE_ENV,
    })

    expect(result.status).toBe('skipped')
    expect(credentialsService.save).not.toHaveBeenCalled()
  })

  it('overwrites existing credentials when forced', async () => {
    const credentialsService = fakeCredentialsService({ botToken: 'existing' })
    const result = await applyDiscordEnvPreset({
      credentialsService: credentialsService as never,
      scope,
      force: true,
      env: COMPLETE_ENV,
    })

    expect(result).toEqual({ status: 'configured' })
    expect(credentialsService.save).toHaveBeenCalledTimes(1)
  })
})
