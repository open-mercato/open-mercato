import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getAmbientCausation,
  reportCausationDegradation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import { registerTelemetryRuntime, resetTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createApiKey, withOnetimeApiKey } from '../apiKeyService'

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/causation/server'),
  reportCausationDegradation: jest.fn(),
}))

const reportDegradation = reportCausationDegradation as jest.MockedFunction<typeof reportCausationDegradation>

const LOOPBACK_CORRELATION_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a'
const SOURCE_LOG_ID = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a'
const RULE_RUN_ID = '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c'

type CreatedRecord = Record<string, unknown> & { id: string; deletedAt: Date | null }

function createEntityManagerHarness() {
  const created: Array<Record<string, unknown>> = []
  let latestRecord: CreatedRecord | null = null
  const flush = jest.fn(async () => undefined)
  const entityManager = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      latestRecord = { id: `key-${created.length}`, ...data, deletedAt: null }
      return latestRecord
    }),
    persist: jest.fn(() => ({ flush })),
    find: jest.fn(async (_entity: unknown, _where: unknown, options?: { lockMode?: unknown }) => (
      options?.lockMode && latestRecord ? [latestRecord] : []
    )),
    findOne: jest.fn(async () => latestRecord),
    flush,
    begin: jest.fn(async () => undefined),
    commit: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
    isInTransaction: jest.fn(() => false),
  }
  return {
    em: entityManager as unknown as EntityManager,
    find: entityManager.find,
    created,
  }
}

const loopbackEnvelope: CausationEnvelope = {
  correlationId: LOOPBACK_CORRELATION_ID,
  causedByLogId: SOURCE_LOG_ID,
  frames: [
    { kind: 'user' },
    { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.deal.updated' },
    { kind: 'business_rule', id: 'rule-1', ref: RULE_RUN_ID, meta: { attempt: 1 } },
  ],
}

const loopbackIdentifiers: CausationEnvelope = {
  correlationId: LOOPBACK_CORRELATION_ID,
  causedByLogId: SOURCE_LOG_ID,
  frames: [
    { kind: 'user' },
    { kind: 'subscriber', id: 'business_rules:crud-rule-trigger' },
    { kind: 'business_rule', id: 'rule-1', ref: RULE_RUN_ID },
  ],
}

describe('api key causation capture', () => {
  const previousCausationFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    delete process.env.OM_CAUSATION
    reportDegradation.mockClear()
  })

  afterEach(() => {
    resetTelemetryRuntime()
  })

  afterAll(() => {
    if (previousCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = previousCausationFlag
  })

  it('stamps the identifier-only ambient causation onto a one-time loopback key', async () => {
    const harness = createEntityManagerHarness()
    let secretSeen: string | null = null

    const result = await runWithCausation(loopbackEnvelope, () => withOnetimeApiKey(
      harness.em,
      { name: '__business_rule_rule-1__', tenantId: 't1', organizationId: 'o1', roles: ['r1'] },
      async (secret) => {
        secretSeen = secret
        return 'done'
      },
    ))

    expect(result).toBe('done')
    expect(secretSeen).toEqual(expect.any(String))
    expect(harness.created).toHaveLength(1)
    expect(harness.created[0].causationJson).toEqual(loopbackIdentifiers)
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  it('reduces the captured envelope to kinds, ids and uuid refs, dropping meta and free-text refs', async () => {
    const harness = createEntityManagerHarness()
    const noisyEnvelope = {
      correlationId: LOOPBACK_CORRELATION_ID,
      frames: [
        { kind: 'workflow', id: 'instance-1', ref: 'step-1', meta: { attempt: 2, payload: { secret: 'x' } } },
      ],
    } as unknown as CausationEnvelope

    await runWithCausation(noisyEnvelope, () => withOnetimeApiKey(
      harness.em,
      { name: 'loopback', tenantId: 't1', organizationId: 'o1', roles: ['r1'] },
      async () => 'done',
    ))

    expect(harness.created[0].causationJson).toEqual({
      correlationId: LOOPBACK_CORRELATION_ID,
      frames: [{ kind: 'workflow', id: 'instance-1' }],
    })
  })

  it('stores no causation and reports the degradation when the one-time key is created outside any causation context', async () => {
    const harness = createEntityManagerHarness()
    expect(getAmbientCausation()).toBeNull()

    await withOnetimeApiKey(
      harness.em,
      { name: 'loopback', tenantId: 't1', organizationId: 'o1', roles: ['r1'] },
      async () => 'done',
    )

    expect(harness.created[0].causationJson).toBeNull()
    expect(reportDegradation).toHaveBeenCalledTimes(1)
    expect(reportDegradation).toHaveBeenCalledWith('onetime_key_no_ambient', {})
  })

  it('stores no causation and reports nothing with OM_CAUSATION=off, even inside a causation context', async () => {
    process.env.OM_CAUSATION = 'off'
    const harness = createEntityManagerHarness()

    await runWithCausation(loopbackEnvelope, () => withOnetimeApiKey(
      harness.em,
      { name: 'loopback', tenantId: 't1', organizationId: 'o1', roles: ['r1'] },
      async () => 'done',
    ))

    expect(harness.created[0].causationJson).toBeNull()
    expect(reportDegradation).not.toHaveBeenCalled()
  })

  it('reports a failed one-time key cleanup to telemetry and still returns the result', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => undefined,
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => {},
      reportError,
      shutdown: async () => {},
    })
    const harness = createEntityManagerHarness()
    const cleanupFailure = new Error('[internal] lock failed')

    const result = await runWithCausation(loopbackEnvelope, () => withOnetimeApiKey(
      harness.em,
      { name: 'loopback', tenantId: 't1', organizationId: 'o1', roles: ['r1'] },
      async () => {
        harness.find.mockRejectedValueOnce(cleanupFailure)
        return 'done'
      },
    ))

    expect(result).toBe('done')
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(cleanupFailure, {
      module: 'api_keys',
      code: 'api_keys.onetime_key_cleanup_failed',
      attributes: { keyId: 'key-1' },
    })
  })

  it('ignores a causation smuggled through the one-time key input', async () => {
    const harness = createEntityManagerHarness()
    const smuggledInput = {
      name: 'loopback',
      tenantId: 't1',
      organizationId: 'o1',
      roles: ['r1'],
      causationJson: loopbackEnvelope,
      causation: loopbackEnvelope,
    }

    await withOnetimeApiKey(
      harness.em,
      smuggledInput as Parameters<typeof withOnetimeApiKey>[1],
      async () => 'done',
    )

    expect(harness.created[0].causationJson).toBeNull()
  })

  it('does not stamp ambient causation onto regular long-lived keys', async () => {
    const harness = createEntityManagerHarness()

    await runWithCausation(loopbackEnvelope, () => createApiKey(harness.em, {
      name: 'Integration key',
      tenantId: 't1',
      organizationId: 'o1',
      roles: ['r1'],
    }))

    expect(harness.created[0].causationJson).toBeNull()
  })

  it('reduces an explicitly supplied causation option to identifiers before storing it in plaintext', async () => {
    const harness = createEntityManagerHarness()

    await createApiKey(harness.em, {
      name: 'Loopback key',
      tenantId: 't1',
      organizationId: 'o1',
      roles: ['r1'],
    }, { causation: loopbackEnvelope })

    expect(harness.created[0].causationJson).toEqual(loopbackIdentifiers)
  })
})
