import { describe, expect, jest, test } from '@jest/globals'
import { traceCapturePolicySchema, type TraceCapturePolicy } from '../data/validators'
import {
  DEFAULT_TRACE_CAPTURE_POLICY,
  TRACE_CAPTURE_CONFIG_MODULE,
  TRACE_CAPTURE_CONFIG_NAME,
  readTraceCapturePolicy,
  resolveCaptureLevel,
  resolveDeploymentCaptureCeiling,
  resolveDeploymentCaptureDefault,
} from '../lib/trace/capturePolicy'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-10-27T12:00:00.000Z')

function policyOf(input: Record<string, unknown>): TraceCapturePolicy {
  return traceCapturePolicySchema.parse(input)
}

function makeContainer(
  record: unknown,
  options: { withStore?: boolean; rejects?: boolean } = {},
) {
  const getRecord = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  if (options.rejects) getRecord.mockRejectedValue(new Error('store down'))
  else getRecord.mockResolvedValue(record)
  return {
    getRecord,
    container: {
      resolve: (token: string) => {
        if (token === 'moduleConfigService' && options.withStore !== false) return { getRecord }
        throw new Error(`Unexpected DI token in test: ${token}`)
      },
    },
  }
}

describe('traceCapturePolicySchema', () => {
  test('applies the spec defaults to an empty object', () => {
    expect(traceCapturePolicySchema.parse({})).toEqual({
      level: 'metadata',
      perAgent: {},
      retentionDays: 30,
      redactPii: false,
      includeProviderBody: false,
    })
  })

  test('rejects more than 200 per-agent overrides', () => {
    const perAgent: Record<string, { level: 'full' }> = {}
    for (let index = 0; index < 201; index += 1) perAgent[`agent_${index}`] = { level: 'full' }
    expect(traceCapturePolicySchema.safeParse({ perAgent }).success).toBe(false)
  })

  test('rejects a non-ISO until and an unknown level', () => {
    expect(
      traceCapturePolicySchema.safeParse({ perAgent: { a: { level: 'full', until: 'tomorrow' } } }).success,
    ).toBe(false)
    expect(traceCapturePolicySchema.safeParse({ level: 'verbose' }).success).toBe(false)
  })
})

describe('deployment default and ceiling', () => {
  test('default to metadata and full', () => {
    expect(resolveDeploymentCaptureDefault({})).toBe('metadata')
    expect(resolveDeploymentCaptureCeiling({})).toBe('full')
  })

  test('read valid values case-insensitively', () => {
    expect(resolveDeploymentCaptureDefault({ OM_AGENT_TRACE_CONTENT_DEFAULT: ' FULL ' })).toBe('full')
    expect(resolveDeploymentCaptureCeiling({ OM_AGENT_TRACE_CONTENT_MAX: 'metadata' })).toBe('metadata')
  })

  test('malformed values fall back without throwing', () => {
    expect(resolveDeploymentCaptureDefault({ OM_AGENT_TRACE_CONTENT_DEFAULT: 'everything' })).toBe('metadata')
    expect(resolveDeploymentCaptureCeiling({ OM_AGENT_TRACE_CONTENT_MAX: 'nope' })).toBe('full')
  })
})

describe('readTraceCapturePolicy', () => {
  test('a saved row reports source=tenant', async () => {
    const { container, getRecord } = makeContainer({ value: { level: 'full', redactPii: true } })
    const result = await readTraceCapturePolicy(container as never, TENANT_ID)
    expect(result.source).toBe('tenant')
    expect(result.policy.level).toBe('full')
    expect(result.policy.redactPii).toBe(true)
    expect(getRecord).toHaveBeenCalledWith(TRACE_CAPTURE_CONFIG_MODULE, TRACE_CAPTURE_CONFIG_NAME, {
      tenantId: TENANT_ID,
    })
  })

  test.each([
    ['no record', makeContainer(null)],
    ['a malformed record', makeContainer({ value: { level: 'everything' } })],
    ['an unreadable store', makeContainer(null, { rejects: true })],
    ['no config store', makeContainer(null, { withStore: false })],
  ])('%s falls back to the default', async (_label, { container }) => {
    await expect(readTraceCapturePolicy(container as never, TENANT_ID)).resolves.toEqual({
      policy: DEFAULT_TRACE_CAPTURE_POLICY,
      source: 'default',
    })
  })
})

describe('resolveCaptureLevel', () => {
  const base = { agentId: 'agent_a', now: NOW, env: {} }

  test('an inherited policy uses the deployment default', () => {
    expect(
      resolveCaptureLevel({
        ...base,
        policy: DEFAULT_TRACE_CAPTURE_POLICY,
        policySource: 'default',
        env: { OM_AGENT_TRACE_CONTENT_DEFAULT: 'off' },
      }),
    ).toEqual({ level: 'off', source: 'deployment', retentionDays: 30, redactPii: false })
  })

  test('a tenant policy beats the deployment default', () => {
    const policy = policyOf({ level: 'off', retentionDays: 7, redactPii: true })
    expect(resolveCaptureLevel({ ...base, policy, policySource: 'tenant' })).toEqual({
      level: 'off',
      source: 'tenant',
      retentionDays: 7,
      redactPii: true,
    })
  })

  test('an unexpired per-agent override beats the tenant level', () => {
    const policy = policyOf({
      level: 'off',
      perAgent: { agent_a: { level: 'full', until: '2026-10-28T00:00:00.000Z' } },
    })
    expect(resolveCaptureLevel({ ...base, policy, policySource: 'tenant' })).toMatchObject({
      level: 'full',
      source: 'agent',
    })
  })

  test('an override without until never expires', () => {
    const policy = policyOf({ level: 'off', perAgent: { agent_a: { level: 'metadata' } } })
    expect(resolveCaptureLevel({ ...base, policy, policySource: 'tenant' })).toMatchObject({
      level: 'metadata',
      source: 'agent',
    })
  })

  test('an expired override is ignored', () => {
    const policy = policyOf({
      level: 'off',
      perAgent: { agent_a: { level: 'full', until: '2026-10-27T11:59:59.000Z' } },
    })
    expect(resolveCaptureLevel({ ...base, policy, policySource: 'tenant' })).toMatchObject({
      level: 'off',
      source: 'tenant',
    })
  })

  test('another agent override does not apply', () => {
    const policy = policyOf({ level: 'metadata', perAgent: { agent_b: { level: 'full' } } })
    expect(resolveCaptureLevel({ ...base, policy, policySource: 'tenant' })).toMatchObject({
      level: 'metadata',
      source: 'tenant',
    })
  })

  test('eval runs use evalLevel, falling back to the tenant level', () => {
    const withEval = policyOf({ level: 'metadata', evalLevel: 'full' })
    expect(
      resolveCaptureLevel({ ...base, policy: withEval, policySource: 'tenant', runSource: 'eval' }),
    ).toMatchObject({ level: 'full', source: 'tenant' })
    expect(
      resolveCaptureLevel({ ...base, policy: withEval, policySource: 'tenant', runSource: 'runtime' }),
    ).toMatchObject({ level: 'metadata', source: 'tenant' })
    const withoutEval = policyOf({ level: 'off' })
    expect(
      resolveCaptureLevel({ ...base, policy: withoutEval, policySource: 'tenant', runSource: 'eval' }),
    ).toMatchObject({ level: 'off', source: 'tenant' })
  })

  test('the deployment ceiling clamps every source', () => {
    const env = { OM_AGENT_TRACE_CONTENT_MAX: 'metadata' }
    const policy = policyOf({ level: 'full', perAgent: { agent_a: { level: 'full' } } })
    expect(resolveCaptureLevel({ ...base, env, policy, policySource: 'tenant' })).toMatchObject({
      level: 'metadata',
      source: 'deployment',
    })
    expect(
      resolveCaptureLevel({
        ...base,
        policy: DEFAULT_TRACE_CAPTURE_POLICY,
        policySource: 'default',
        env: { OM_AGENT_TRACE_CONTENT_DEFAULT: 'full', OM_AGENT_TRACE_CONTENT_MAX: 'metadata' },
      }),
    ).toMatchObject({ level: 'metadata', source: 'deployment' })
  })

  test('a level under the ceiling keeps its source', () => {
    const env = { OM_AGENT_TRACE_CONTENT_MAX: 'metadata' }
    const policy = policyOf({ level: 'off' })
    expect(resolveCaptureLevel({ ...base, env, policy, policySource: 'tenant' })).toMatchObject({
      level: 'off',
      source: 'tenant',
    })
  })

  test('malformed env falls back to metadata default and full ceiling', () => {
    const env = { OM_AGENT_TRACE_CONTENT_DEFAULT: 'bogus', OM_AGENT_TRACE_CONTENT_MAX: 'bogus' }
    expect(
      resolveCaptureLevel({ ...base, env, policy: DEFAULT_TRACE_CAPTURE_POLICY, policySource: 'default' }),
    ).toMatchObject({ level: 'metadata', source: 'deployment' })
    const policy = policyOf({ level: 'full' })
    expect(resolveCaptureLevel({ ...base, env, policy, policySource: 'tenant' })).toMatchObject({
      level: 'full',
      source: 'tenant',
    })
  })
})
