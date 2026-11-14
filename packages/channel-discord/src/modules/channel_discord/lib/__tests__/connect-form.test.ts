import en from '../../i18n/en.json'
import { integration } from '../../integration'
import {
  DISCORD_CONNECT_INITIAL_VALUES,
  buildDiscordConnectRequestBody,
  createDiscordConnectFormSchema,
} from '../connect-form'

const translate = (key: string, fallback: string) => `${key}|${fallback}`
const REQUIRED = 'channel_discord.connect.errors.required|This field is required.'
const PUBLIC_KEY = 'a'.repeat(64)

function fieldErrorsOf(input: Record<string, unknown>): Record<string, string> {
  const result = createDiscordConnectFormSchema(translate).safeParse(input)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0])
    if (!errors[field]) errors[field] = issue.message
  }
  return errors
}

const VALID = {
  displayName: '',
  botToken: 'bot-token',
  applicationId: '123456789012345678',
  publicKey: PUBLIC_KEY,
  guildId: '',
  defaultChannelId: '',
}

describe('Discord connect form schema', () => {
  it('reports a translated per-field error for every required field of an empty form (#5592)', () => {
    expect(fieldErrorsOf(DISCORD_CONNECT_INITIAL_VALUES)).toEqual({
      botToken: REQUIRED,
      applicationId: REQUIRED,
      publicKey: REQUIRED,
    })
  })

  it('rejects a public key that is not 64 hex characters on its own field', () => {
    const invalid = 'channel_discord.connect.errors.invalidPublicKey|Enter the 64-character hex public key from the Developer Portal.'
    expect(fieldErrorsOf({ ...VALID, publicKey: 'not-hex' })).toEqual({ publicKey: invalid })
    expect(fieldErrorsOf({ ...VALID, publicKey: 'a'.repeat(63) })).toEqual({ publicKey: invalid })
  })

  it('accepts a form with only the required fields filled', () => {
    expect(fieldErrorsOf(VALID)).toEqual({})
  })
})

describe('buildDiscordConnectRequestBody', () => {
  it('trims values, defaults the display name and omits blank optional ids', () => {
    const values = createDiscordConnectFormSchema(translate).parse({
      ...VALID,
      botToken: '  bot-token  ',
      guildId: '   ',
    })
    expect(buildDiscordConnectRequestBody(values)).toEqual({
      providerKey: 'discord',
      displayName: 'Discord',
      credentials: {
        botToken: 'bot-token',
        applicationId: '123456789012345678',
        publicKey: PUBLIC_KEY,
        guildId: undefined,
        defaultChannelId: undefined,
      },
    })
  })

  it('keeps an explicit display name and the optional ids', () => {
    const values = createDiscordConnectFormSchema(translate).parse({
      ...VALID,
      displayName: 'Support bot',
      guildId: '111',
      defaultChannelId: '222',
    })
    const body = buildDiscordConnectRequestBody(values)
    expect(body.displayName).toBe('Support bot')
    expect(body.credentials).toMatchObject({ guildId: '111', defaultChannelId: '222' })
  })
})

describe('Discord connect dialog hints', () => {
  it('match the integration credential help texts word for word (#5592)', () => {
    const messages = en as Record<string, string>
    for (const field of integration.credentials?.fields ?? []) {
      expect(messages[`channel_discord.connect.fields.${field.key}Help`]).toBe(field.helpText)
      expect(messages[`channel_discord.connect.fields.${field.key}`]).toBe(field.label)
    }
  })
})
