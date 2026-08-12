/**
 * Named call profiles (tracker task 2.13).
 *
 * Three things are load-bearing here and the rest is detail:
 *
 *  1. THE MIGRATION. A tenant that configured the single Agent ID / Phone Number
 *     ID pair before profiles existed keeps dialling with no operator action —
 *     that pair is read as the `default` profile.
 *  2. THE FAIL-CLOSED ARM. An agent naming a profile the tenant has not
 *     configured must fail BEFORE any HTTP request. The assertion that carries
 *     the weight is `calls` being empty: falling back to `default` would place a
 *     real phone call to a real person with the wrong agent's script, which is
 *     strictly worse than not calling.
 *  3. ONE CALLBACK URL. Profiles are a start-side concern; they must never
 *     multiply the manual step of pasting a webhook URL into ElevenLabs.
 */

import { z } from 'zod'
import type { AgentRegistryEntry } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineAgent'
import type { ExternalAgentConnectorStartArgs } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/externalConnectorRegistry'
import {
  createElevenLabsVoiceConnector,
  ELEVENLABS_CALLBACK_PATH,
  ELEVENLABS_VOICE_CONNECTOR_ID,
} from '../lib/connector'
import {
  DEFAULT_PROFILE_NAME,
  ElevenLabsCredentialsError,
  ElevenLabsProfileNotConfiguredError,
  listConfiguredProfileNames,
  parseElevenLabsCredentials,
  PROFILES_CREDENTIAL_KEY,
  resolveCallProfile,
} from '../lib/credentials'
import { readElevenLabsEnvPreset } from '../lib/preset'
import type { ElevenLabsFetch, OutboundCallRequestBody } from '../lib/api'

const API_KEY = 'sk_super_secret_elevenlabs_key'
const WEBHOOK_SECRET = 'wsec_super_secret_webhook_value'
const BASE_URL = 'https://api.elevenlabs.test'
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

/** Exactly what a tenant configured before profiles existed holds. */
const LEGACY_FLAT_RECORD = {
  apiKey: API_KEY,
  webhookSecret: WEBHOOK_SECRET,
  agentId: 'agent_legacy',
  agentPhoneNumberId: 'phnum_legacy',
  telephonyProvider: 'sip_trunk',
  defaultCallerId: '+48111222333',
  callRecordingEnabled: true,
}

const SURVEY_PROFILE = {
  name: 'survey',
  agentId: 'agent_survey',
  phoneNumberId: 'phnum_survey',
}

function agentEntry(overrides: Partial<AgentRegistryEntry> = {}): AgentRegistryEntry {
  return {
    id: 'voice.owner_call',
    moduleId: 'agent_elevenlabs',
    resultKind: 'researcher',
    schema: z.object({ kind: z.literal('researcher'), data: z.object({}) }),
    tools: [],
    skills: [],
    subAgents: [],
    label: 'Call a person',
    description: 'demo',
    instructions: '',
    runtime: 'external',
    connectorId: ELEVENLABS_VOICE_CONNECTOR_ID,
    ...overrides,
  }
}

type CapturedRequest = { url: string; init: RequestInit }

function makeFetch(): { fetchImpl: ElevenLabsFetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = []
  const fetchImpl: ElevenLabsFetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({ success: true, message: 'ok', conversation_id: 'conv_1', callSid: 'CA1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return { fetchImpl, calls }
}

function startArgs(
  input: unknown,
  entry: AgentRegistryEntry = agentEntry(),
): ExternalAgentConnectorStartArgs {
  return {
    agentEntry: entry,
    input,
    callbackUrl: 'https://app.example/api/agent_orchestrator/external-runs/xrun_tok/callback',
    callbackToken: 'xrun_tok',
    scope: SCOPE,
  }
}

function bodyOf(call: CapturedRequest): OutboundCallRequestBody {
  return JSON.parse(String(call.init.body)) as OutboundCallRequestBody
}

describe('parsing the profile document', () => {
  it('MIGRATION: the legacy flat pair alone resolves as the "default" profile', () => {
    const parsed = parseElevenLabsCredentials(LEGACY_FLAT_RECORD)

    expect(Object.keys(parsed.profiles)).toEqual([DEFAULT_PROFILE_NAME])
    expect(parsed.profiles.default).toEqual({
      name: 'default',
      agentId: 'agent_legacy',
      phoneNumberId: 'phnum_legacy',
      // Every legacy field lands on the profile — not just the pair. A migration
      // that dropped the caller id or the recording preference would change what
      // a configured tenant's next call looks like on the wire.
      telephonyProvider: 'sip_trunk',
      defaultCallerId: '+48111222333',
      callRecordingEnabled: true,
    })
  })

  it('accepts the list form and keys it by name', () => {
    const parsed = parseElevenLabsCredentials({
      ...LEGACY_FLAT_RECORD,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
    })

    expect(Object.keys(parsed.profiles).sort()).toEqual(['default', 'survey'])
    expect(parsed.profiles.survey).toEqual({
      name: 'survey',
      agentId: 'agent_survey',
      phoneNumberId: 'phnum_survey',
      telephonyProvider: 'twilio',
      defaultCallerId: null,
      callRecordingEnabled: null,
    })
  })

  it('accepts the map form as well, because an operator typing JSON will reach for either', () => {
    const parsed = parseElevenLabsCredentials({
      ...LEGACY_FLAT_RECORD,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify({
        survey: { agentId: 'agent_survey', phoneNumberId: 'phnum_survey' },
      }),
    })
    expect(parsed.profiles.survey.agentId).toBe('agent_survey')
  })

  it('accepts a structure written straight through the credentials service, not only a string', () => {
    // `channel-gmail` persists a real array under a credential key from a
    // server-side `save()`, so an already-structured value is a real input shape.
    const parsed = parseElevenLabsCredentials({
      ...LEGACY_FLAT_RECORD,
      [PROFILES_CREDENTIAL_KEY]: [SURVEY_PROFILE],
    })
    expect(parsed.profiles.survey.phoneNumberId).toBe('phnum_survey')
  })

  it('MIGRATION: adding named profiles does not disturb the tenant default', () => {
    const parsed = parseElevenLabsCredentials({
      ...LEGACY_FLAT_RECORD,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
    })
    expect(parsed.profiles.default.agentId).toBe('agent_legacy')
  })

  it('lets an explicit "default" entry win over the flat pair', () => {
    const parsed = parseElevenLabsCredentials({
      ...LEGACY_FLAT_RECORD,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify([
        { name: 'default', agentId: 'agent_explicit', phoneNumberId: 'phnum_explicit' },
      ]),
    })
    expect(parsed.profiles.default.agentId).toBe('agent_explicit')
  })

  it('works with profiles only — no flat pair at all', () => {
    const parsed = parseElevenLabsCredentials({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
    })
    expect(Object.keys(parsed.profiles)).toEqual(['survey'])
  })

  it('refuses a record with no profile and no flat pair, naming both ways to fix it', () => {
    expect(() =>
      parseElevenLabsCredentials({ apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET }),
    ).toThrow(/no call profile configured/)
  })

  it('refuses invalid JSON without quoting the input back', () => {
    const record = { ...LEGACY_FLAT_RECORD, [PROFILES_CREDENTIAL_KEY]: '{not json' }
    expect(() => parseElevenLabsCredentials(record)).toThrow(ElevenLabsCredentialsError)
    expect(() => parseElevenLabsCredentials(record)).toThrow(/not valid JSON/)
  })

  it('refuses an unknown key rather than silently ignoring a typo', () => {
    // `phone_number_id` instead of `phoneNumberId` would otherwise produce a
    // profile missing its number, and the strict schema turns that into a named
    // parse failure at configuration time.
    expect(() =>
      parseElevenLabsCredentials({
        ...LEGACY_FLAT_RECORD,
        [PROFILES_CREDENTIAL_KEY]: JSON.stringify([
          { name: 'survey', agentId: 'agent_survey', phone_number_id: 'phnum_survey' },
        ]),
      }),
    ).toThrow(/malformed/)
  })

  it('refuses a profile with no name', () => {
    expect(() =>
      parseElevenLabsCredentials({
        ...LEGACY_FLAT_RECORD,
        [PROFILES_CREDENTIAL_KEY]: JSON.stringify([
          { agentId: 'agent_survey', phoneNumberId: 'phnum_survey' },
        ]),
      }),
    ).toThrow(/no "name"/)
  })

  it('refuses the same profile name twice', () => {
    expect(() =>
      parseElevenLabsCredentials({
        ...LEGACY_FLAT_RECORD,
        [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE, SURVEY_PROFILE]),
      }),
    ).toThrow(/twice/)
  })

  it('never leaks a secret through a profile parse failure', () => {
    const record = { ...LEGACY_FLAT_RECORD, [PROFILES_CREDENTIAL_KEY]: '{not json' }
    try {
      parseElevenLabsCredentials(record)
      throw new Error('expected a throw')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      expect(message).not.toContain(API_KEY)
      expect(message).not.toContain(WEBHOOK_SECRET)
    }
  })

  it('reports configured profile names for the health check without ever throwing', () => {
    expect(listConfiguredProfileNames(LEGACY_FLAT_RECORD)).toEqual(['default'])
    expect(
      listConfiguredProfileNames({
        ...LEGACY_FLAT_RECORD,
        [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
      }),
    ).toEqual(['default', 'survey'])
    // Malformed reads as "no named profiles", never as an exception inside a probe.
    expect(
      listConfiguredProfileNames({ ...LEGACY_FLAT_RECORD, [PROFILES_CREDENTIAL_KEY]: '{not json' }),
    ).toEqual(['default'])
    expect(listConfiguredProfileNames(null)).toEqual([])
  })
})

describe('resolveCallProfile', () => {
  const credentials = parseElevenLabsCredentials({
    ...LEGACY_FLAT_RECORD,
    [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
  })

  it('resolves the agent named profile', () => {
    expect(resolveCallProfile(credentials, { profileName: 'survey', agentId: 'a' }).agentId).toBe(
      'agent_survey',
    )
  })

  it('resolves "default" when the agent names none', () => {
    expect(resolveCallProfile(credentials, { profileName: undefined, agentId: 'a' }).name).toBe(
      'default',
    )
    expect(resolveCallProfile(credentials, { profileName: null, agentId: 'a' }).name).toBe('default')
  })

  it('FAILS CLOSED on an unknown profile, listing what IS configured', () => {
    try {
      resolveCallProfile(credentials, { profileName: 'payment_chase', agentId: 'voice.chase' })
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ElevenLabsProfileNotConfiguredError)
      const message = error instanceof Error ? error.message : ''
      expect(message).toContain('payment_chase')
      expect(message).toContain('voice.chase')
      // Actionable: the operator is told which names exist and where to add one.
      expect(message).toContain('default, survey')
      expect(message).toContain('Call Profiles')
    }
  })

  it('says "(none)" rather than an empty list when nothing is configured', () => {
    const profilesOnly = parseElevenLabsCredentials({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
    })
    expect(() => resolveCallProfile(profilesOnly, { profileName: null, agentId: 'a' })).toThrow(
      /Configured profiles: survey/,
    )
  })
})

describe('start() precedence: per-call override > named profile > default', () => {
  const record = {
    ...LEGACY_FLAT_RECORD,
    [PROFILES_CREDENTIAL_KEY]: JSON.stringify([
      { ...SURVEY_PROFILE, defaultCallerId: '+48999000111', callRecordingEnabled: false },
    ]),
  }

  function connectorFor(calls: { fetchImpl: ElevenLabsFetch }) {
    return createElevenLabsVoiceConnector({
      readCredentials: async () => parseElevenLabsCredentials(record),
      fetchImpl: calls.fetchImpl,
      baseUrl: BASE_URL,
    })
  }

  it('dials the DEFAULT profile when the agent names none', async () => {
    const fetch = makeFetch()
    await connectorFor(fetch).start(startArgs({ toNumber: '+48123456789' }))

    const body = bodyOf(fetch.calls[0])
    expect(body.agent_id).toBe('agent_legacy')
    expect(body.agent_phone_number_id).toBe('phnum_legacy')
    expect(body.telephony_call_config?.caller_id).toBe('+48111222333')
    expect(body.call_recording_enabled).toBe(true)
    // The default profile is on a SIP trunk, so the endpoint follows the profile.
    expect(fetch.calls[0].url).toBe(`${BASE_URL}/v1/convai/sip-trunk/outbound-call`)
  })

  it('dials the NAMED profile when the agent declares one', async () => {
    const fetch = makeFetch()
    await connectorFor(fetch).start(
      startArgs({ toNumber: '+48123456789' }, agentEntry({ profile: 'survey' })),
    )

    const body = bodyOf(fetch.calls[0])
    expect(body.agent_id).toBe('agent_survey')
    expect(body.agent_phone_number_id).toBe('phnum_survey')
    expect(body.telephony_call_config?.caller_id).toBe('+48999000111')
    expect(body.call_recording_enabled).toBe(false)
    // …including its own wiring, which is twilio here rather than the default's SIP trunk.
    expect(fetch.calls[0].url).toBe(`${BASE_URL}/v1/convai/twilio/outbound-call`)
  })

  it('lets the PER-CALL input override win over the named profile', async () => {
    const fetch = makeFetch()
    await connectorFor(fetch).start(
      startArgs(
        {
          toNumber: '+48123456789',
          agentId: 'agent_one_off',
          agentPhoneNumberId: 'phnum_one_off',
          telephonyProvider: 'sip_trunk',
          callRecordingEnabled: true,
        },
        agentEntry({ profile: 'survey' }),
      ),
    )

    const body = bodyOf(fetch.calls[0])
    expect(body.agent_id).toBe('agent_one_off')
    expect(body.agent_phone_number_id).toBe('phnum_one_off')
    expect(body.call_recording_enabled).toBe(true)
    expect(fetch.calls[0].url).toBe(`${BASE_URL}/v1/convai/sip-trunk/outbound-call`)
    // The caller id has NO per-call override on purpose — who is calling stays a
    // tenant-level compliance decision — so it still comes from the profile.
    expect(body.telephony_call_config?.caller_id).toBe('+48999000111')
  })

  it('MIGRATION: a legacy tenant with no profile document still places its call unchanged', async () => {
    const fetch = makeFetch()
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => parseElevenLabsCredentials(LEGACY_FLAT_RECORD),
      fetchImpl: fetch.fetchImpl,
      baseUrl: BASE_URL,
    })

    const result = await connector.start(startArgs({ toNumber: '+48123456789' }))

    expect(result).toEqual({ externalRunId: 'conv_1', expectsCallback: true })
    expect(bodyOf(fetch.calls[0]).agent_id).toBe('agent_legacy')
  })
})

describe('an agent naming an unconfigured profile fails BEFORE any call is placed', () => {
  it('makes NO http request at all', async () => {
    const fetch = makeFetch()
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => parseElevenLabsCredentials(LEGACY_FLAT_RECORD),
      fetchImpl: fetch.fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(
      connector.start(
        startArgs({ toNumber: '+48123456789' }, agentEntry({ profile: 'payment_chase' })),
      ),
    ).rejects.toBeInstanceOf(ElevenLabsProfileNotConfiguredError)

    // THE ASSERTION THAT MATTERS. A fallback to `default` here would ring a real
    // person with the wrong script, on the tenant's bill, and look like success.
    expect(fetch.calls).toHaveLength(0)
  })

  it('fails the same way when the tenant has no default and the agent names none', async () => {
    const fetch = makeFetch()
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () =>
        parseElevenLabsCredentials({
          apiKey: API_KEY,
          webhookSecret: WEBHOOK_SECRET,
          [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
        }),
      fetchImpl: fetch.fetchImpl,
      baseUrl: BASE_URL,
    })

    await expect(connector.start(startArgs({ toNumber: '+48123456789' }))).rejects.toThrow(
      /has not configured/,
    )
    expect(fetch.calls).toHaveLength(0)
  })

  it('never puts a secret in the refusal, which is persisted on the run', async () => {
    const fetch = makeFetch()
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () => parseElevenLabsCredentials(LEGACY_FLAT_RECORD),
      fetchImpl: fetch.fetchImpl,
      baseUrl: BASE_URL,
    })

    let caught: unknown
    try {
      await connector.start(startArgs({ toNumber: '+48123456789' }, agentEntry({ profile: 'nope' })))
    } catch (error) {
      caught = error
    }
    // Asserted before the message check so the case cannot pass vacuously by
    // never throwing at all.
    expect(caught).toBeInstanceOf(ElevenLabsProfileNotConfiguredError)
    const message = caught instanceof Error ? caught.message : ''
    expect(message).not.toContain(API_KEY)
    expect(message).not.toContain(WEBHOOK_SECRET)
  })
})

describe('profiles never multiply the webhook setup', () => {
  it('keeps ONE static callback URL, derived from the connector and nothing else', () => {
    // The URL an operator pastes into the ElevenLabs workspace is per CONNECTOR.
    // If it ever became profile-dependent, every new profile would add a manual
    // provider-side step — the exact cost profiles exist to remove.
    expect(ELEVENLABS_CALLBACK_PATH).toBe(
      '/api/agent_orchestrator/external-runs/connectors/elevenlabs.voice/callback',
    )
    expect(ELEVENLABS_CALLBACK_PATH).not.toContain(DEFAULT_PROFILE_NAME)
    expect(ELEVENLABS_CALLBACK_PATH).not.toContain('survey')
  })

  it('verifies a callback with the tenant webhook secret regardless of which profile placed the call', async () => {
    // Verification reads the tenant secret, which is not a per-profile value —
    // so one webhook registration settles calls from every profile.
    const connector = createElevenLabsVoiceConnector({
      readCredentials: async () =>
        parseElevenLabsCredentials({
          ...LEGACY_FLAT_RECORD,
          [PROFILES_CREDENTIAL_KEY]: JSON.stringify([SURVEY_PROFILE]),
        }),
      fetchImpl: makeFetch().fetchImpl,
      baseUrl: BASE_URL,
    })

    const verified = await connector.verifyCallback(
      new Headers({ 'ElevenLabs-Signature': 't=1,v0=deadbeef' }),
      '{}',
      SCOPE,
    )
    expect(verified).toBe(false)
  })
})

describe('configure-from-env keeps working, and learns profiles', () => {
  const LEGACY_ENV = {
    OM_INTEGRATION_ELEVENLABS_API_KEY: API_KEY,
    OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
    OM_INTEGRATION_ELEVENLABS_AGENT_ID: 'agent_legacy',
    OM_INTEGRATION_ELEVENLABS_PHONE_NUMBER_ID: 'phnum_legacy',
  }

  it('BACKWARD COMPATIBILITY: the four original variables produce the same record as before', () => {
    const preset = readElevenLabsEnvPreset(LEGACY_ENV)
    expect(preset?.credentials).toEqual({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      agentId: 'agent_legacy',
      agentPhoneNumberId: 'phnum_legacy',
      telephonyProvider: 'twilio',
    })
    expect(preset?.enabled).toBe(false)
  })

  it('stores a profile document as the same JSON string the admin form takes', () => {
    const profiles = JSON.stringify([SURVEY_PROFILE])
    const preset = readElevenLabsEnvPreset({
      ...LEGACY_ENV,
      OM_INTEGRATION_ELEVENLABS_PROFILES: profiles,
    })
    expect(preset?.credentials[PROFILES_CREDENTIAL_KEY]).toBe(profiles)
    // And it resolves: default from the flat pair, survey from the document.
    const parsed = parseElevenLabsCredentials(preset?.credentials as Record<string, unknown>)
    expect(Object.keys(parsed.profiles).sort()).toEqual(['default', 'survey'])
  })

  it('accepts a profiles-only deployment when the document carries a "default"', () => {
    const preset = readElevenLabsEnvPreset({
      OM_INTEGRATION_ELEVENLABS_API_KEY: API_KEY,
      OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      OM_INTEGRATION_ELEVENLABS_PROFILES: JSON.stringify([
        { name: 'default', agentId: 'agent_d', phoneNumberId: 'phnum_d' },
        SURVEY_PROFILE,
      ]),
    })
    expect(preset?.credentials.agentId).toBeUndefined()
    expect(
      Object.keys(parseElevenLabsCredentials(preset?.credentials as Record<string, unknown>).profiles).sort(),
    ).toEqual(['default', 'survey'])
  })

  it('FAILS THE DEPLOY, not the first call, when the document is malformed', () => {
    expect(() =>
      readElevenLabsEnvPreset({ ...LEGACY_ENV, OM_INTEGRATION_ELEVENLABS_PROFILES: '{not json' }),
    ).toThrow(/OM_INTEGRATION_ELEVENLABS_PROFILES/)
  })

  it('FAILS THE DEPLOY when profiles are set but nothing supplies a default', () => {
    expect(() =>
      readElevenLabsEnvPreset({
        OM_INTEGRATION_ELEVENLABS_API_KEY: API_KEY,
        OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
        OM_INTEGRATION_ELEVENLABS_PROFILES: JSON.stringify([SURVEY_PROFILE]),
      }),
    ).not.toThrow()
    // A profiles-only deployment is legitimate — every agent then names its
    // profile. What is NOT legitimate is a half-supplied flat pair.
    expect(() =>
      readElevenLabsEnvPreset({
        OM_INTEGRATION_ELEVENLABS_API_KEY: API_KEY,
        OM_INTEGRATION_ELEVENLABS_WEBHOOK_SECRET: WEBHOOK_SECRET,
        OM_INTEGRATION_ELEVENLABS_AGENT_ID: 'agent_legacy',
        OM_INTEGRATION_ELEVENLABS_PROFILES: JSON.stringify([SURVEY_PROFILE]),
      }),
    ).toThrow(/must be set together/)
  })

  it('never echoes a secret out of a preset failure', () => {
    try {
      readElevenLabsEnvPreset({ ...LEGACY_ENV, OM_INTEGRATION_ELEVENLABS_PROFILES: '{not json' })
      throw new Error('expected a throw')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      expect(message).not.toContain(API_KEY)
      expect(message).not.toContain(WEBHOOK_SECRET)
    }
  })
})
