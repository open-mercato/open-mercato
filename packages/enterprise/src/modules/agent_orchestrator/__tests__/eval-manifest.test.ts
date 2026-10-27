import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentEvalAssertion, AgentEvalCase, AgentEvalSuiteRun } from '../data/entities'
import {
  EVAL_SET_SUMMARY_KEY,
  EvalSetTooLargeError,
  deterministicAssertionId,
  deterministicCaseId,
  freezeManifest,
  hashManifest,
  resolveEvalSetMaxBytes,
  findEvalSetCarrier,
  resolveManifest,
  uuidV5,
  type EvalSetManifest,
} from '../lib/eval/manifest'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const OTHER_SCOPE = { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: '44444444-4444-4444-8444-444444444444' }
const AGENT = 'content_review.validator'
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const UUID_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Row = Record<string, unknown>

function compareRowValues(left: unknown, right: unknown): number {
  const leftValue = left instanceof Date ? left.getTime() : left
  const rightValue = right instanceof Date ? right.getTime() : right
  if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue - rightValue
  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''))
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
    return ((expected as { $in: unknown[] }).$in ?? []).includes(actual)
  }
  if (expected && typeof expected === 'object' && '$lt' in (expected as object)) {
    if (actual === undefined || actual === null) return false
    return compareRowValues(actual, (expected as { $lt: unknown }).$lt) < 0
  }
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime()
  if (expected === null) return actual === null || actual === undefined
  return actual === expected
}

type FindOptions = { orderBy?: Record<string, string>; limit?: number }

function createFakeEm(seed: Map<unknown, Row[]>, findCalls: Row[] = []): EntityManager {
  const storeFor = (entity: unknown) => seed.get(entity) ?? []
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) =>
      key === '$or' ? (value as Row[]).some((branch) => matches(row, branch)) : matchValue(row[key], value),
    )
  return {
    async find(entity: unknown, where: Row, options: FindOptions = {}) {
      findCalls.push(where)
      const rows = storeFor(entity).filter((row) => matches(row, where))
      const orderEntries = Object.entries(options.orderBy ?? {})
      const ordered = orderEntries.length
        ? [...rows].sort((left, right) => {
            for (const [field, direction] of orderEntries) {
              const delta = compareRowValues(left[field], right[field])
              if (delta !== 0) return direction.toLowerCase() === 'desc' ? -delta : delta
            }
            return 0
          })
        : rows
      return options.limit ? ordered.slice(0, options.limit) : ordered
    },
    async findOne(entity: unknown, where: Row) {
      return storeFor(entity).find((row) => matches(row, where)) ?? null
    },
  } as unknown as EntityManager
}

function evalCase(id: string, overrides: Row = {}): Row {
  return {
    id,
    ...SCOPE,
    agentDefinitionId: AGENT,
    sourceType: 'golden_run',
    name: `case ${id.slice(0, 4)}`,
    input: { content: `text ${id.slice(0, 4)}`, meta: { lang: 'en', length: 3 } },
    expected: { overall: 'pass' },
    assertions: null,
    status: 'approved',
    deletedAt: null,
    ...overrides,
  }
}

function assertion(id: string, key: string, overrides: Row = {}): Row {
  return {
    id,
    ...SCOPE,
    key,
    scorerKey: 'output_present',
    title: `Assertion ${key}`,
    description: null,
    appliesTo: AGENT,
    type: 'deterministic',
    severity: 'gate',
    config: {},
    enabled: true,
    deletedAt: null,
    ...overrides,
  }
}

const CASE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CASE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ASSERT_SCHEMA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ASSERT_JUDGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function baseSeed(): Map<unknown, Row[]> {
  return new Map<unknown, Row[]>([
    [AgentEvalCase, [evalCase(CASE_A), evalCase(CASE_B)]],
    [
      AgentEvalAssertion,
      [
        assertion(ASSERT_SCHEMA, 'schema', { scorerKey: 'json_schema', config: { schema: { type: 'object' } } }),
        assertion(ASSERT_JUDGE, 'rationale', {
          scorerKey: 'llm_judge',
          type: 'llm_judge',
          severity: 'warn',
          appliesTo: '*',
          config: { rubric: 'Explain the verdict.' },
        }),
      ],
    ],
  ])
}

function reorderedObject(value: Row): Row {
  return Object.fromEntries(
    Object.entries(value)
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => right.index - left.index)
      .map(({ entry }) => entry),
  )
}

describe('eval-set manifest', () => {
  it('freezes approved cases and enabled assertions with a sha256 version', async () => {
    const { manifest, version } = await freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT, label: 'nightly' })

    expect(version).toMatch(HASH_PATTERN)
    expect(manifest.format).toBe('open-mercato.agent-eval-set')
    expect(manifest.formatVersion).toBe(1)
    expect(manifest.source).toBe('db')
    expect(manifest.label).toBe('nightly')
    expect(manifest.cases.map((entry) => entry.id)).toEqual([CASE_A, CASE_B])
    expect(manifest.assertions.map((entry) => entry.key)).toEqual(['rationale', 'schema'])
    const judge = manifest.assertions.find((entry) => entry.key === 'rationale')
    expect(judge?.rubric?.promptTemplate).toBe('Explain the verdict.')
    expect(manifest.assertions.find((entry) => entry.key === 'schema')?.rubric).toBeUndefined()
  })

  it('excludes unapproved or deleted cases and disabled, deleted or foreign-agent assertions', async () => {
    const seed = baseSeed()
    seed.get(AgentEvalCase)?.push(
      evalCase('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', { status: 'draft' }),
      evalCase('ffffffff-ffff-4fff-8fff-ffffffffffff', { deletedAt: new Date() }),
      evalCase('12121212-1212-4121-8121-121212121212', { agentDefinitionId: 'other.agent' }),
    )
    seed.get(AgentEvalAssertion)?.push(
      assertion('13131313-1313-4131-8131-131313131313', 'disabled_one', { enabled: false }),
      assertion('14141414-1414-4141-8141-141414141414', 'deleted_one', { deletedAt: new Date() }),
      assertion('15151515-1515-4151-8151-151515151515', 'foreign_one', { appliesTo: 'other.agent' }),
    )
    const { manifest, version } = await freezeManifest(createFakeEm(seed), SCOPE, { agentId: AGENT })
    const baseline = await freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT })

    expect(manifest.cases).toHaveLength(2)
    expect(manifest.assertions.map((entry) => entry.key)).toEqual(['rationale', 'schema'])
    expect(version).toBe(baseline.version)
  })

  it('hash is stable across authoring order and object key order', async () => {
    const { manifest, version } = await freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT })
    const shuffled: EvalSetManifest = {
      ...manifest,
      cases: [...manifest.cases].reverse().map((entry) => reorderedObject(entry) as EvalSetManifest['cases'][number]),
      assertions: [...manifest.assertions]
        .reverse()
        .map((entry) => reorderedObject(entry) as EvalSetManifest['assertions'][number]),
    }
    expect(hashManifest(reorderedObject(shuffled) as EvalSetManifest)).toBe(version)

    const reversedSeed = baseSeed()
    reversedSeed.set(AgentEvalCase, [...(reversedSeed.get(AgentEvalCase) ?? [])].reverse())
    reversedSeed.set(AgentEvalAssertion, [...(reversedSeed.get(AgentEvalAssertion) ?? [])].reverse())
    expect((await freezeManifest(createFakeEm(reversedSeed), SCOPE, { agentId: AGENT })).version).toBe(version)
  })

  it('editing a case, an assertion or a rubric body changes the hash', async () => {
    const { version } = await freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT })

    const caseEdited = baseSeed()
    caseEdited.set(AgentEvalCase, [evalCase(CASE_A, { expected: { overall: 'fail' } }), evalCase(CASE_B)])
    const assertionEdited = baseSeed()
    assertionEdited.set(AgentEvalAssertion, [
      assertion(ASSERT_SCHEMA, 'schema', { scorerKey: 'json_schema', config: { schema: { type: 'array' } } }),
      ...(assertionEdited.get(AgentEvalAssertion) ?? []).slice(1),
    ])
    const rubricEdited = baseSeed()
    rubricEdited.set(AgentEvalAssertion, [
      ...(rubricEdited.get(AgentEvalAssertion) ?? []).slice(0, 1),
      assertion(ASSERT_JUDGE, 'rationale', {
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: 'warn',
        appliesTo: '*',
        config: { rubric: 'Explain the verdict and cite the evidence.' },
      }),
    ])

    const versions = await Promise.all(
      [caseEdited, assertionEdited, rubricEdited].map(
        async (seed) => (await freezeManifest(createFakeEm(seed), SCOPE, { agentId: AGENT })).version,
      ),
    )
    for (const edited of versions) expect(edited).not.toBe(version)
    expect(new Set(versions).size).toBe(3)
  })

  it('fails with a typed error above the size cap', async () => {
    await expect(freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT, maxBytes: 64 })).rejects.toBeInstanceOf(
      EvalSetTooLargeError,
    )
    await expect(
      freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT, maxBytes: 64 }),
    ).rejects.toMatchObject({ code: 'eval_set_too_large', maxBytes: 64 })
  })

  it('reads the size cap from the environment with a 5 MiB default', () => {
    expect(resolveEvalSetMaxBytes({})).toBe(5 * 1024 * 1024)
    expect(resolveEvalSetMaxBytes({ OM_AGENT_EVAL_SET_MAX_BYTES: '1024' })).toBe(1024)
    expect(resolveEvalSetMaxBytes({ OM_AGENT_EVAL_SET_MAX_BYTES: 'nope' })).toBe(5 * 1024 * 1024)
  })

  it('derives stable UUIDv5 ids per agent and key', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    expect(deterministicCaseId(AGENT, 'banned-phrase-01')).toMatch(UUID_V5_PATTERN)
    expect(deterministicCaseId(AGENT, 'banned-phrase-01')).toBe(deterministicCaseId(AGENT, 'banned-phrase-01'))
    expect(deterministicCaseId(AGENT, 'banned-phrase-01')).not.toBe(deterministicCaseId('other.agent', 'banned-phrase-01'))
    expect(deterministicAssertionId(AGENT, 'schema')).toMatch(UUID_V5_PATTERN)
    expect(deterministicAssertionId(AGENT, 'schema')).not.toBe(deterministicCaseId(AGENT, 'schema'))
  })

  describe('resolveManifest', () => {
    async function seededCarrier() {
      const { manifest, version } = await freezeManifest(createFakeEm(baseSeed()), SCOPE, { agentId: AGENT })
      const pointer = {
        version,
        label: null,
        source: 'db',
        caseCount: manifest.cases.length,
        assertionCount: manifest.assertions.length,
      }
      const carrier = {
        id: '16161616-1616-4161-8161-161616161616',
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalSetVersion: version,
        summary: { [EVAL_SET_SUMMARY_KEY]: { ...pointer, carrierSuiteRunId: '16161616-1616-4161-8161-161616161616', body: manifest } },
      }
      const follower = {
        id: '17171717-1717-4171-8171-171717171717',
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalSetVersion: 'nightly',
        summary: { [EVAL_SET_SUMMARY_KEY]: { ...pointer, carrierSuiteRunId: carrier.id } },
      }
      return { manifest, version, carrier, follower }
    }

    it('loads the body from its carrier suite run', async () => {
      const { manifest, version, carrier, follower } = await seededCarrier()
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [carrier, follower]]]))
      expect(await resolveManifest(em, SCOPE, AGENT, version)).toEqual(manifest)
    })

    it('follows a pointer to the carrier when the pinned run holds no body', async () => {
      const { manifest, version, carrier, follower } = await seededCarrier()
      const pointerOnly = { ...follower, evalSetVersion: version }
      const relabeledCarrier = { ...carrier, evalSetVersion: 'label-pin' }
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [pointerOnly, relabeledCarrier]]]))
      expect(await resolveManifest(em, SCOPE, AGENT, version)).toEqual(manifest)
    })

    it('returns null for unknown versions, other agents and other tenants', async () => {
      const { version, carrier } = await seededCarrier()
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [carrier]]]))
      const unknownVersion = `sha256:${'0'.repeat(64)}`
      expect(await resolveManifest(em, SCOPE, AGENT, unknownVersion)).toBeNull()
      expect(await resolveManifest(em, SCOPE, 'other.agent', version)).toBeNull()
      expect(await resolveManifest(em, OTHER_SCOPE, AGENT, version)).toBeNull()
    })

    it('finds a carrier older than the most recent 200 suite runs by paging through all of them', async () => {
      const { manifest, version, carrier } = await seededCarrier()
      const base = Date.UTC(2026, 0, 1)
      const olderCarrier = { ...carrier, evalSetVersion: null, createdAt: new Date(base) }
      const newerRuns: Row[] = Array.from({ length: 250 }, (_unused, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalSetVersion: null,
        createdAt: new Date(base + (index + 1) * 1000),
        summary: {},
      }))
      const findCalls: Row[] = []
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [olderCarrier, ...newerRuns]]]), findCalls)
      expect(await resolveManifest(em, SCOPE, AGENT, version)).toEqual(manifest)
      expect(findCalls.filter((where) => '$or' in where)).toHaveLength(2)
      expect(await findEvalSetCarrier(em, SCOPE, AGENT, version)).toBe(carrier.id)
    })

    it('pages past runs that share a creation timestamp without skipping any', async () => {
      const { manifest, version, carrier } = await seededCarrier()
      const sharedAt = new Date(Date.UTC(2026, 0, 1))
      const tiedCarrier = { ...carrier, id: '00000000-0000-4000-8000-000000000000', evalSetVersion: null, createdAt: sharedAt }
      const tiedRuns: Row[] = Array.from({ length: 150 }, (_unused, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ...SCOPE,
        agentDefinitionId: AGENT,
        evalSetVersion: null,
        createdAt: sharedAt,
        summary: {},
      }))
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [tiedCarrier, ...tiedRuns]]]))
      expect(await resolveManifest(em, SCOPE, AGENT, version)).toEqual(manifest)
    })

    it('rejects a carrier body whose content no longer matches its version', async () => {
      const { manifest, version, carrier } = await seededCarrier()
      const tampered = {
        ...carrier,
        summary: {
          [EVAL_SET_SUMMARY_KEY]: {
            ...(carrier.summary[EVAL_SET_SUMMARY_KEY] as Row),
            body: { ...manifest, label: 'tampered' },
          },
        },
      }
      const em = createFakeEm(new Map<unknown, Row[]>([[AgentEvalSuiteRun, [tampered]]]))
      expect(await resolveManifest(em, SCOPE, AGENT, version)).toBeNull()
    })
  })
})
