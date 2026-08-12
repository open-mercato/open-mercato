import {
  describeCredentialsForLog,
  ElevenLabsCredentialsError,
  parseElevenLabsCredentials,
  redactSecrets,
} from '../lib/credentials'
import { createElevenLabsVoiceHealthCheck } from '../lib/health'
import { readElevenLabsEnvPreset } from '../lib/preset'
import type { ElevenLabsFetch } from '../lib/api'

const COMPLETE = {
  apiKey: 'sk_secret',
  webhookSecret: 'wsec_secret',
  agentId: 'agent_abc',
  agentPhoneNumberId: 'phnum_zzz',
}

/** The flat legacy record always resolves to exactly one profile: `default`. */
function defaultProfile(raw: Record<string, unknown>) {
  return parseElevenLabsCredentials(raw).profiles.default
}

describe('parseElevenLabsCredentials', () => {
  it('defaults an unset telephony provider to twilio', () => {
    expect(defaultProfile(COMPLETE).telephonyProvider).toBe('twilio')
  })

  it('defaults an unrecognised telephony provider to twilio rather than throwing', () => {
    // A tenant configured before the field existed, or a value from a future
    // options list, must keep placing calls on the documented default wiring.
    expect(
      defaultProfile({ ...COMPLETE, telephonyProvider: 'carrier-pigeon' }).telephonyProvider,
    ).toBe('twilio')
  })

  it('reads sip_trunk when configured', () => {
    expect(defaultProfile({ ...COMPLETE, telephonyProvider: 'sip_trunk' }).telephonyProvider).toBe(
      'sip_trunk',
    )
  })

  it('distinguishes an unset recording preference from an explicit false', () => {
    expect(defaultProfile(COMPLETE).callRecordingEnabled).toBeNull()
    expect(defaultProfile({ ...COMPLETE, callRecordingEnabled: false }).callRecordingEnabled).toBe(
      false,
    )
  })

  it('throws naming the missing field, never a value', () => {
    expect(() => parseElevenLabsCredentials({ ...COMPLETE, webhookSecret: '' })).toThrow(
      ElevenLabsCredentialsError,
    )
    try {
      parseElevenLabsCredentials({ ...COMPLETE, webhookSecret: '' })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      expect(message).toContain('Webhook secret')
      expect(message).not.toContain(COMPLETE.apiKey)
    }
  })

  it('throws when the tenant has no credentials at all', () => {
    expect(() => parseElevenLabsCredentials(null)).toThrow(/not configured for this tenant/)
  })
})

describe('redactSecrets', () => {
  it('removes this tenant secrets from provider-supplied text', () => {
    const parsed = parseElevenLabsCredentials(COMPLETE)
    expect(redactSecrets('key sk_secret and wsec_secret rejected', parsed)).toBe(
      'key [redacted] and [redacted] rejected',
    )
  })

  it('leaves unrelated text alone', () => {
    const parsed = parseElevenLabsCredentials(COMPLETE)
    expect(redactSecrets('agent has no phone number', parsed)).toBe('agent has no phone number')
  })
})

describe('describeCredentialsForLog', () => {
  it('emits presence flags and non-secret ids only', () => {
    const parsed = parseElevenLabsCredentials(COMPLETE)
    const described = describeCredentialsForLog(parsed, parsed.profiles.default)
    expect(described).toEqual({
      profile: 'default',
      // Deliberately NOT `agentId`: the caller's log record already uses that key
      // for the Open Mercato agent, and this map is spread over it.
      profileAgentId: 'agent_abc',
      profilePhoneNumberId: 'phnum_zzz',
      telephonyProvider: 'twilio',
      hasApiKey: true,
      hasWebhookSecret: true,
    })
    expect(described).not.toHaveProperty('agentId')
    expect(JSON.stringify(described)).not.toContain('sk_secret')
    expect(JSON.stringify(described)).not.toContain('wsec_secret')
  })
})

describe('health check', () => {
  function checkWith(status: number) {
    const fetchImpl: ElevenLabsFetch = async () => new Response(null, { status })
    return createElevenLabsVoiceHealthCheck({ fetchImpl, baseUrl: 'https://api.elevenlabs.test' })
  }

  it.each([200, 404, 422])('reports healthy when ElevenLabs authenticated us (HTTP %s)', async (status) => {
    const result = await checkWith(status).check(COMPLETE)
    expect(result.status).toBe('healthy')
  })

  it.each([401, 403])('reports unhealthy when the key is rejected (HTTP %s)', async (status) => {
    const result = await checkWith(status).check(COMPLETE)
    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('rejected')
  })

  it('reports unhealthy on a provider outage', async () => {
    expect((await checkWith(503).check(COMPLETE)).status).toBe('unhealthy')
  })

  it('reports unhealthy without calling out when no key is stored', async () => {
    let called = false
    const fetchImpl: ElevenLabsFetch = async () => {
      called = true
      return new Response(null, { status: 200 })
    }
    const result = await createElevenLabsVoiceHealthCheck({ fetchImpl }).check({})
    expect(result.status).toBe('unhealthy')
    expect(called).toBe(false)
  })

  it('never puts the API key in the health report', async () => {
    const result = await checkWith(200).check(COMPLETE)
    expect(JSON.stringify(result)).not.toContain('sk_secret')
  })
})

describe('env preset', () => {
  it('is a silent no-op when no ElevenLabs variables are set', () => {
    expect(readElevenLabsEnvPreset({})).toBeNull()
  })

  it('throws naming the missing variables, never their values, on a partial preset', () => {
    try {
      readElevenLabsEnvPreset({ OM_INTEGRATION_ELEVENLABS_API_KEY: 'sk_secret' })
      throw new Error('expected a throw')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      expect(message).toContain('OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET')
      expect(message).not.toContain('sk_secret')
    }
  })

  it('defaults the integration to DISABLED — dialling is never enabled by deploying', () => {
    const preset = readElevenLabsEnvPreset({
      OM_INTEGRATION_ELEVENLABS_API_KEY: 'sk_secret',
      OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: 'wsec_secret',
      OM_INTEGRATION_ELEVENLABS_AGENT_ID: 'agent_abc',
      OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID: 'phnum_zzz',
    })
    expect(preset?.enabled).toBe(false)
    expect(preset?.credentials.telephonyProvider).toBe('twilio')
  })

  it('rejects an unsupported telephony provider', () => {
    expect(() =>
      readElevenLabsEnvPreset({
        OM_INTEGRATION_ELEVENLABS_API_KEY: 'sk_secret',
        OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: 'wsec_secret',
        OM_INTEGRATION_ELEVENLABS_AGENT_ID: 'agent_abc',
        OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID: 'phnum_zzz',
        OM_INTEGRATION_ELEVENLABS_TELEPHONY_PROVIDER: 'carrier-pigeon',
      }),
    ).toThrow(/Unsupported/)
  })
})
