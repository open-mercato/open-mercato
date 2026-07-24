import { extractIncidentAiFailure, resolveIncidentAiErrorMessage } from '../lib/aiErrors'

const t = (key: string): string => key

describe('incident AI error message mapping', () => {
  it.each([
    {
      label: 'no provider configured',
      status: 503,
      body: { code: 'no_provider_configured' },
      expectedKey: 'incidents.ai.errors.noProvider',
    },
    {
      label: 'missing API key',
      status: 503,
      body: { code: 'api_key_missing' },
      expectedKey: 'incidents.ai.errors.apiKeyMissing',
    },
    {
      label: 'incident not found code',
      status: 500,
      body: { code: 'incident_not_found' },
      expectedKey: 'incidents.ai.errors.notFound',
    },
    {
      label: 'AI unavailable code',
      status: 500,
      body: { code: 'ai_unavailable' },
      expectedKey: 'incidents.ai.errors.unavailable',
    },
    {
      label: 'forbidden status',
      status: 403,
      body: {},
      expectedKey: 'incidents.ai.errors.forbidden',
    },
    {
      label: 'not found status',
      status: 404,
      body: {},
      expectedKey: 'incidents.ai.errors.notFound',
    },
    {
      label: 'unavailable status',
      status: 503,
      body: {},
      expectedKey: 'incidents.ai.errors.unavailable',
    },
    {
      label: 'generic fallback',
      status: 500,
      body: { code: 'ai_failed' },
      expectedKey: 'incidents.ai.summary.error',
    },
  ])('selects the $expectedKey key for $label', ({ status, body, expectedKey }) => {
    const failure = extractIncidentAiFailure(status, body)

    expect(resolveIncidentAiErrorMessage(
      failure,
      t,
      'incidents.ai.summary.error',
      'Failed to summarize this incident.',
    )).toBe(expectedKey)
  })
})
