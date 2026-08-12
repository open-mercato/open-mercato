/**
 * The credential record IS the connector, so parsing it is where a
 * misconfiguration must be caught — at save, at deploy or at the health check,
 * never on the first run.
 *
 * Also covers the body template, whose whole job is to turn a workflow input into
 * a request shape nobody in this repo has seen.
 */

import {
  DEFAULT_REQUEST_TEMPLATE,
  GenericHttpCredentialsError,
  parseGenericHttpCredentials,
  redactSecrets,
} from '../lib/credentials'
import { createGenericHttpAgentHealthCheck } from '../lib/health'
import { renderRequestTemplate, GenericHttpTemplateError } from '../lib/template'
import { readGenericHttpEnvPreset } from '../lib/preset'

const MINIMAL = {
  startUrl: 'https://provider.example.com/v1/runs',
  signingSecret: 'whsec_the_tenants_secret',
}

describe('credential parsing', () => {
  it('applies documented defaults for everything optional', () => {
    expect(parseGenericHttpCredentials(MINIMAL)).toEqual({
      startUrl: 'https://provider.example.com/v1/runs',
      authHeaderName: 'Authorization',
      authHeaderValue: null,
      signingSecret: 'whsec_the_tenants_secret',
      signatureHeader: 'x-om-signature',
      signatureScheme: 'hex',
      resultPath: 'result.answer',
      externalRunIdPath: 'id',
      requestTemplate: DEFAULT_REQUEST_TEMPLATE,
    })
  })

  it.each([
    ['no record at all', null],
    ['no start URL', { signingSecret: 'whsec_x_y_z_1_2_3' }],
    ['no signing secret', { startUrl: 'https://provider.example.com/v1' }],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseGenericHttpCredentials(raw)).toThrow(GenericHttpCredentialsError)
  })

  it('refuses an unrecognised signature scheme instead of defaulting', () => {
    // A wrong scheme does not fail loudly at the provider — it silently rejects
    // every callback and the run parks until its deadline.
    expect(() => parseGenericHttpCredentials({ ...MINIMAL, signatureScheme: 'base64' })).toThrow(
      /Signature Scheme/,
    )
  })

  it.each([
    ['an empty path', ''],
    ['a path with an empty segment', 'result..answer'],
    ['a path naming a prototype key', 'result.__proto__.answer'],
  ])('refuses %s', (_label, resultPath) => {
    // `''` falls back to the default, so only the two structural cases throw.
    const parse = () => parseGenericHttpCredentials({ ...MINIMAL, resultPath })
    if (resultPath === '') {
      expect(parse().resultPath).toBe('result.answer')
      return
    }
    expect(parse).toThrow(GenericHttpCredentialsError)
  })

  it('parses the template from a JSON string, which is all the admin form can store', () => {
    const parsed = parseGenericHttpCredentials({
      ...MINIMAL,
      requestTemplate: '{"q":"{{input.brief}}"}',
    })
    expect(parsed.requestTemplate).toEqual({ q: '{{input.brief}}' })
  })

  it('accepts an already-structured template, as a preset writes it', () => {
    const parsed = parseGenericHttpCredentials({
      ...MINIMAL,
      requestTemplate: { q: '{{input.brief}}' },
    })
    expect(parsed.requestTemplate).toEqual({ q: '{{input.brief}}' })
  })

  it('refuses a template that is not JSON, without quoting it back', () => {
    const notJson = 'brief={{input.brief}}&key=sk_live_leaked'
    try {
      parseGenericHttpCredentials({ ...MINIMAL, requestTemplate: notJson })
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as Error).message).toContain('not valid JSON')
      expect((error as Error).message).not.toContain('sk_live_leaked')
    }
  })
})

describe('redaction', () => {
  it('replaces both secrets wherever a provider echoed them', () => {
    const credentials = parseGenericHttpCredentials({
      ...MINIMAL,
      authHeaderValue: 'Bearer sk_live_abcdefghijklmnop',
    })
    const echoed = 'rejected Bearer sk_live_abcdefghijklmnop signed with whsec_the_tenants_secret'
    expect(redactSecrets(echoed, credentials)).toBe(
      'rejected [redacted] signed with [redacted]',
    )
  })

  it('leaves a very short configured value alone rather than mangling the text', () => {
    expect(redactSecrets('the letter a appears here', { authHeaderValue: 'a', signingSecret: 'ab' })).toBe(
      'the letter a appears here',
    )
  })
})

describe('request body template', () => {
  const values = {
    input: { brief: 'why did it stall?', payload: { deal: { id: 42, name: 'ACME' } } },
    callbackUrl: 'https://mercato.example.com/api/agent_orchestrator/external-runs/xrun_abc/callback',
    callbackToken: 'xrun_abc',
  }

  it('keeps the TYPE of a value that is exactly one placeholder', () => {
    expect(renderRequestTemplate({ ctx: '{{input.payload.deal}}' }, values)).toEqual({
      ctx: { id: 42, name: 'ACME' },
    })
  })

  it('interpolates a placeholder inside a longer string as text', () => {
    expect(renderRequestTemplate({ q: 'Deal {{input.payload.deal.name}}: {{input.brief}}' }, values)).toEqual(
      { q: 'Deal ACME: why did it stall?' },
    )
  })

  it('renders an unset optional input as null rather than dropping the key', () => {
    // `undefined` would make JSON.stringify remove the field, silently changing the
    // request's SHAPE rather than its content.
    const rendered = renderRequestTemplate({ maybe: '{{input.payload.missing}}' }, values)
    expect(rendered).toEqual({ maybe: null })
    expect(JSON.parse(JSON.stringify(rendered))).toEqual({ maybe: null })
  })

  it('walks arrays and nested objects, and leaves non-string leaves alone', () => {
    expect(
      renderRequestTemplate(
        { items: [{ q: '{{input.brief}}' }, 7, true, null], mode: 'fixed' },
        values,
      ),
    ).toEqual({ items: [{ q: 'why did it stall?' }, 7, true, null], mode: 'fixed' })
  })

  it('templates values only, never keys', () => {
    expect(renderRequestTemplate({ '{{input.brief}}': 'x' }, values)).toEqual({
      '{{input.brief}}': 'x',
    })
  })

  it('throws on an unknown placeholder rather than silently emptying it', () => {
    expect(() => renderRequestTemplate({ q: '{{apiKey}}' }, values)).toThrow(GenericHttpTemplateError)
  })
})

describe('health check', () => {
  const lookupHost = async () => [{ address: '93.184.216.34', family: 4 }]

  it('is healthy when the record parses and the start URL resolves to a permitted address', async () => {
    const result = await createGenericHttpAgentHealthCheck({ lookupHost }).check(MINIMAL)
    expect(result.status).toBe('healthy')
    expect(result.details).toMatchObject({
      startUrlHost: 'provider.example.com',
      signatureScheme: 'hex',
      resultPath: 'result.answer',
      hasSigningSecret: true,
    })
  })

  it('never echoes a secret into its details', async () => {
    const result = await createGenericHttpAgentHealthCheck({ lookupHost }).check({
      ...MINIMAL,
      authHeaderValue: 'Bearer sk_live_abcdefghijklmnop',
    })
    expect(JSON.stringify(result)).not.toContain('sk_live_abcdefghijklmnop')
    expect(JSON.stringify(result)).not.toContain('whsec_the_tenants_secret')
  })

  it('is unhealthy when the record does not parse', async () => {
    const result = await createGenericHttpAgentHealthCheck({ lookupHost }).check({})
    expect(result.status).toBe('unhealthy')
    expect(result.details).toEqual({ reason: 'invalid_credentials' })
  })

  it('is unhealthy when the start URL points somewhere the guard refuses', async () => {
    const result = await createGenericHttpAgentHealthCheck({ lookupHost }).check({
      ...MINIMAL,
      startUrl: 'http://localhost:9000/runs',
    })
    expect(result.status).toBe('unhealthy')
    expect(result.details).toEqual({ reason: 'blocked_hostname' })
  })

  it('is unhealthy when the host does not resolve', async () => {
    const result = await createGenericHttpAgentHealthCheck({
      lookupHost: async () => {
        throw new Error('ENOTFOUND')
      },
    }).check(MINIMAL)
    expect(result.status).toBe('unhealthy')
    expect(result.details).toEqual({ reason: 'dns_resolution_failed' })
  })
})

describe('env preset', () => {
  it('is a silent no-op when nothing is configured', () => {
    expect(readGenericHttpEnvPreset({})).toBeNull()
  })

  it('throws on a half-configured deployment rather than storing it', () => {
    expect(() =>
      readGenericHttpEnvPreset({ OM_INTEGRATION_AGENT_HTTP_START_URL: 'https://p.example.com/v1' }),
    ).toThrow(/Incomplete/)
  })

  it('validates the template through the SAME parser the connector uses', () => {
    expect(() =>
      readGenericHttpEnvPreset({
        OM_INTEGRATION_AGENT_HTTP_START_URL: 'https://p.example.com/v1',
        OM_INTEGRATION_AGENT_HTTP_SIGNING_SECRET: 'whsec_x',
        OM_INTEGRATION_AGENT_HTTP_REQUEST_TEMPLATE: 'not json',
      }),
    ).toThrow(/does not resolve to a usable configuration/)
  })

  it('defaults the integration to DISABLED', () => {
    const preset = readGenericHttpEnvPreset({
      OM_INTEGRATION_AGENT_HTTP_START_URL: 'https://p.example.com/v1',
      OM_INTEGRATION_AGENT_HTTP_SIGNING_SECRET: 'whsec_x',
    })
    expect(preset?.enabled).toBe(false)
    expect(preset?.credentials).toEqual({
      startUrl: 'https://p.example.com/v1',
      signingSecret: 'whsec_x',
    })
  })

  it('names variables and never values in its refusals', () => {
    try {
      readGenericHttpEnvPreset({ OM_INTEGRATION_AGENT_HTTP_SIGNING_SECRET: 'whsec_secret_value' })
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as Error).message).not.toContain('whsec_secret_value')
      expect((error as Error).message).toContain('OM_INTEGRATION_AGENT_HTTP_START_URL')
    }
  })
})
