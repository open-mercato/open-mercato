import type { EntityManager } from '@mikro-orm/postgresql'
import {
  EVAL_SET_FILE_ISSUE,
  collectEvalSetFileRubricRefs,
  fileFromManifest,
  manifestFromFile,
  parseEvalSetFile,
  validateEvalSetFile,
} from '../lib/eval/evalSetFile'
import { EVAL_SET_FORMAT, resolveManifestCaseAssertions, type EvalSetManifest } from '../lib/eval/manifest'
import { parseScorerConfig } from '../lib/eval/registry'
import { buildJudgePrompt, type JudgeRubric } from '../lib/eval/judgeRubric'
import { runLlmJudgeForRun, type JudgeFn } from '../lib/eval/llmJudge'
import {
  BUILTIN_RUBRICS,
  BUILTIN_RUBRICS_BY_KEY,
  isKnownRubricRef,
  listRubrics,
  parseAgentEvalRubrics,
  registerAgentRubrics,
  resolveJudgeRubric,
  resolveRubricRef,
} from '../lib/eval/rubrics'
import { AgentEvalAssertion, AgentEvalResult, AgentRun } from '../data/entities'

jest.mock('../lib/sdk/defineAgent', () => ({ ensureAgentsLoaded: jest.fn(async () => undefined) }))

const AGENT = 'content_review.validator'
const OTHER_AGENT = 'content_review.other'
const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

function agentRubric(promptTemplate: string): JudgeRubric {
  const parsed = parseAgentEvalRubrics(AGENT, {
    house_style: {
      promptTemplate,
      scoring: { kind: 'binary', passDescription: 'On style.', failDescription: 'Off style.' },
    },
  })
  if (!parsed) throw new Error('expected a parsed rubric')
  return parsed.house_style
}

function fileWith(config: Record<string, unknown>, caseOverride?: Record<string, unknown>): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    label: 'rubrics',
    assertions: [
      { key: 'rationale', scorerKey: 'llm_judge', type: 'llm_judge', severity: 'warn', title: 'Rationale', config },
    ],
    cases: [
      {
        key: 'case-01',
        input: { content: 'x' },
        assertions: caseOverride ? [{ key: 'rationale', configOverride: caseOverride }] : null,
      },
    ],
  }
}

afterEach(() => {
  registerAgentRubrics(AGENT, undefined)
  registerAgentRubrics(OTHER_AGENT, undefined)
})

describe('rubric library', () => {
  it('ships the three built-ins as choice rubrics with temperature 0 and three samples', () => {
    expect(BUILTIN_RUBRICS.map((entry) => entry.key)).toEqual(['rationale_quality', 'groundedness', 'appropriate_abstention'])
    for (const entry of BUILTIN_RUBRICS) {
      expect(entry.rubric.scoring.kind).toBe('choice')
      expect(entry.rubric.temperature).toBe(0)
      expect(entry.rubric.samples).toBe(3)
      expect(entry.rubric.evaluationSteps?.length).toBeGreaterThan(0)
      expect(entry.titleKey).toBe(`agent_orchestrator.evalRubrics.builtin.${entry.key}.title`)
    }
  })

  it('resolves the agent rubric first, then the built-in, and returns null for an unknown ref', () => {
    expect(resolveRubricRef(AGENT, 'rationale_quality')?.source).toBe('builtin')
    const shadow = agentRubric('Agent-specific rationale rubric')
    registerAgentRubrics(AGENT, { rationale_quality: shadow })
    expect(resolveRubricRef(AGENT, 'rationale_quality')).toEqual({ key: 'rationale_quality', source: 'agent', rubric: shadow })
    expect(resolveRubricRef(OTHER_AGENT, 'rationale_quality')?.source).toBe('builtin')
    expect(resolveRubricRef(AGENT, 'nope')).toBeNull()
  })

  it('lists agent rubrics before the built-ins they do not shadow', () => {
    registerAgentRubrics(AGENT, { rationale_quality: agentRubric('a'), house_style: agentRubric('b') })
    expect(listRubrics(AGENT).map((entry) => `${entry.source}:${entry.key}`)).toEqual([
      'agent:house_style',
      'agent:rationale_quality',
      'builtin:groundedness',
      'builtin:appropriate_abstention',
    ])
    expect(listRubrics(null).every((entry) => entry.source === 'builtin')).toBe(true)
  })

  it('accepts a wildcard ref only when a built-in or some agent declares it', () => {
    expect(isKnownRubricRef('*', 'groundedness')).toBe(true)
    expect(isKnownRubricRef('*', 'house_style')).toBe(false)
    registerAgentRubrics(OTHER_AGENT, { house_style: agentRubric('x') })
    expect(isKnownRubricRef('*', 'house_style')).toBe(true)
    expect(isKnownRubricRef(AGENT, 'house_style')).toBe(false)
  })

  it('rejects an invalid agent rubric at registration', () => {
    expect(() => parseAgentEvalRubrics(AGENT, { 'bad key!': { promptTemplate: 'x', scoring: { kind: 'binary', passDescription: 'a', failDescription: 'b' } } })).toThrow(/invalid eval rubric key/)
    expect(() =>
      parseAgentEvalRubrics(AGENT, { broken: { promptTemplate: '', scoring: { kind: 'binary', passDescription: 'a', failDescription: 'b' } } }),
    ).toThrow(/invalid eval rubric "broken"/)
  })
})

describe('llm_judge rubricRef config', () => {
  it('accepts { rubricRef } with tuning as a third write arm', () => {
    expect(parseScorerConfig('llm_judge', { rubricRef: 'groundedness' }, 'write').ok).toBe(true)
    expect(parseScorerConfig('llm_judge', { rubricRef: 'groundedness', threshold: 0.7, samples: 5 }, 'write').ok).toBe(true)
  })

  it('refuses a rubricRef mixed with an inline rubric or an unknown key', () => {
    expect(parseScorerConfig('llm_judge', { rubricRef: 'groundedness', rubric: 'inline' }, 'write').ok).toBe(false)
    expect(parseScorerConfig('llm_judge', { rubricRef: 'groundedness', promptTemplate: 'inline' }, 'write').ok).toBe(false)
    expect(parseScorerConfig('llm_judge', { rubricRef: 'bad key!' }, 'write').ok).toBe(false)
  })

  it('resolves the referenced rubric with its tuning applied, and never lifts an unknown ref into a legacy rubric', () => {
    const resolved = resolveJudgeRubric({ rubricRef: 'groundedness', threshold: 0.8 }, { agentId: AGENT, fallbackText: 'Title' })
    expect(resolved.ok && resolved.rubric.promptTemplate).toBe(BUILTIN_RUBRICS_BY_KEY.get('groundedness')!.rubric.promptTemplate)
    expect(resolved.ok && resolved.rubric.threshold).toBe(0.8)
    expect(resolveJudgeRubric({ rubricRef: 'missing' }, { agentId: AGENT, fallbackText: 'Title' })).toEqual({
      ok: false,
      reason: 'unknown_rubric',
      rubricRef: 'missing',
    })
  })

  it('builds the judge prompt from the resolved rubric', () => {
    registerAgentRubrics(AGENT, { house_style: agentRubric('Write in the house style.') })
    const resolved = resolveJudgeRubric({ rubricRef: 'house_style' }, { agentId: AGENT, fallbackText: 'Title' })
    if (!resolved.ok) throw new Error('expected a resolved rubric')
    const prompt = buildJudgePrompt(resolved.rubric, { text: 'out' }, null)
    expect(prompt).toContain('Rubric:\nWrite in the house style.')
    expect(prompt).toContain('PASS: On style.')
  })
})

describe('eval-set files with rubricRef', () => {
  it('validates a known ref and reports an unknown one as unknown_rubric', () => {
    expect(validateEvalSetFile(fileWith({ rubricRef: 'rationale_quality' })).ok).toBe(true)
    const result = validateEvalSetFile(fileWith({ rubricRef: 'house_style' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      expect.objectContaining({ code: EVAL_SET_FILE_ISSUE.unknownRubric, path: 'assertions.0.config.rubricRef' }),
    ])
    registerAgentRubrics(AGENT, { house_style: agentRubric('x') })
    expect(validateEvalSetFile(fileWith({ rubricRef: 'house_style' })).ok).toBe(true)
  })

  it('refuses a case override that swaps the rubricRef but accepts tuning', () => {
    const swapped = validateEvalSetFile(fileWith({ rubricRef: 'rationale_quality' }, { rubricRef: 'groundedness' }))
    expect(swapped.ok).toBe(false)
    if (!swapped.ok) expect(swapped.issues[0]?.path).toBe('cases.0.assertions.0.configOverride.rubricRef')
    expect(validateEvalSetFile(fileWith({ rubricRef: 'rationale_quality' }, { threshold: 0.9 })).ok).toBe(true)
  })

  it('collects refs from a raw file so callers can load agent rubrics first', () => {
    expect(collectEvalSetFileRubricRefs(fileWith({ rubricRef: 'house_style' }))).toEqual(['house_style'])
    expect(collectEvalSetFileRubricRefs({ assertions: 'nope' })).toEqual([])
  })

  it('freezes the resolved rubric so a later library edit leaves the pinned run alone but changes the hash', () => {
    registerAgentRubrics(AGENT, { house_style: agentRubric('Version one.') })
    const file = parseEvalSetFile(fileWith({ rubricRef: 'house_style' }, { threshold: 0.9 }))
    const frozen = manifestFromFile(file)
    expect(frozen.manifest.assertions[0].config).toEqual({ rubricRef: 'house_style' })
    expect(frozen.manifest.assertions[0].rubric?.promptTemplate).toBe('Version one.')

    registerAgentRubrics(AGENT, { house_style: agentRubric('Version two.') })
    const [resolved] = resolveManifestCaseAssertions(frozen.manifest, frozen.manifest.cases[0])
    expect(resolved.rubric?.promptTemplate).toBe('Version one.')
    expect(resolved.rubric?.threshold).toBe(0.9)

    const refrozen = manifestFromFile(file)
    expect(refrozen.manifest.assertions[0].rubric?.promptTemplate).toBe('Version two.')
    expect(refrozen.version).not.toBe(frozen.version)
  })

  it('round-trips rubricRef through export and import with the same hash', () => {
    const { manifest, version } = manifestFromFile(parseEvalSetFile(fileWith({ rubricRef: 'groundedness', samples: 5 })))
    const exported = fileFromManifest(manifest)
    expect(exported.assertions[0].config).toEqual({ rubricRef: 'groundedness', samples: 5 })
    expect(manifestFromFile(parseEvalSetFile(exported)).version).toBe(version)
  })

  it('skips a frozen rubricRef assertion with no frozen rubric as unknown_rubric', () => {
    const { manifest } = manifestFromFile(parseEvalSetFile(fileWith({ rubricRef: 'groundedness' })))
    const unresolved: EvalSetManifest = {
      ...manifest,
      assertions: manifest.assertions.map(({ rubric: _rubric, ...rest }) => rest),
    }
    const [resolved] = resolveManifestCaseAssertions(unresolved, unresolved.cases[0])
    expect(resolved.rubric).toBeNull()
    expect(resolved.rubricSkipReason).toBe('unknown_rubric')
  })
})

function createFakeEm(seed: { runs: Array<Record<string, unknown>>; assertions: Array<Record<string, unknown>> }) {
  const stores = new Map<unknown, Array<Record<string, unknown>>>([
    [AgentRun, seed.runs],
    [AgentEvalAssertion, seed.assertions],
    [AgentEvalResult, []],
  ])
  const pending: Array<Record<string, unknown>> = []
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && '$in' in value
        ? (value as { $in: unknown[] }).$in.includes(row[key])
        : row[key] === value,
    )
  const em = {
    create: (entity: unknown, data: Record<string, unknown>) => ({ ...data, __entity: entity }),
    persist(row: Record<string, unknown>) {
      pending.push(row)
      return em
    },
    async flush() {
      for (const row of pending.splice(0)) stores.get((row as { __entity?: unknown }).__entity)?.push(row)
    },
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return (stores.get(entity) ?? []).find((row) => matches(row, where)) ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return (stores.get(entity) ?? []).filter((row) => matches(row, where))
    },
  }
  return { em: em as unknown as EntityManager, results: () => stores.get(AgentEvalResult) ?? [] }
}

function judgeAssertion(key: string, config: Record<string, unknown>) {
  return {
    id: `assert-${key}`,
    ...SCOPE,
    key,
    title: key,
    appliesTo: AGENT,
    type: 'llm_judge',
    enabled: true,
    deletedAt: null,
    severity: 'warn',
    config,
  }
}

describe('runLlmJudgeForRun with rubricRef', () => {
  it('judges with the resolved library rubric and skips an unknown ref as unknown_rubric', async () => {
    const { em, results } = createFakeEm({
      runs: [{ id: 'run-1', ...SCOPE, agentId: AGENT, output: { ok: true } }],
      assertions: [
        judgeAssertion('grounded', { rubricRef: 'groundedness' }),
        judgeAssertion('missing', { rubricRef: 'missing' }),
      ],
    })
    const seen: JudgeRubric[] = []
    const judge: JudgeFn = async ({ rubric }) => {
      seen.push(rubric)
      return { passed: true, score: 1, feedback: 'ok' }
    }

    const outcome = await runLlmJudgeForRun(em, SCOPE, 'run-1', judge)

    expect(outcome).toEqual({ judged: 1, skipped: 1 })
    expect(seen[0].promptTemplate).toBe(BUILTIN_RUBRICS_BY_KEY.get('groundedness')!.rubric.promptTemplate)
    const skipped = results().find((row) => row.assertionKey === 'missing')
    expect(skipped?.evidence).toEqual({ reason: 'unknown_rubric' })
  })

  it('records unknown_rubric for a frozen assertion that carries that skip reason', async () => {
    const { em, results } = createFakeEm({
      runs: [{ id: 'run-1', ...SCOPE, agentId: AGENT, output: { ok: true } }],
      assertions: [],
    })
    const judge: JudgeFn = jest.fn(async () => ({ passed: true, score: 1, feedback: '' }))
    await runLlmJudgeForRun(em, SCOPE, 'run-1', judge, { judgeMayGate: false }, {
      evalCaseRunId: 'case-run-1',
      frozenAssertions: [{ id: 'a-1', key: 'frozen', severity: 'warn', rubric: null, skipReason: 'unknown_rubric' }],
    })
    expect(judge).not.toHaveBeenCalled()
    expect(results()[0]?.evidence).toEqual({ reason: 'unknown_rubric' })
  })
})
