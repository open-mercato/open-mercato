import {
  EVAL_SET_FILE_ISSUE,
  EVAL_SET_FILE_MAX_CASES,
  EvalSetFileInvalidError,
  fileFromManifest,
  manifestFromFile,
  parseEvalSetFile,
  validateEvalSetFile,
  type EvalSetFile,
} from '../lib/eval/evalSetFile'
import {
  EVAL_SET_FORMAT,
  EvalSetTooLargeError,
  deterministicAssertionId,
  deterministicCaseId,
  hashManifest,
  type EvalSetManifest,
} from '../lib/eval/manifest'

const AGENT = 'content_review.validator'
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/

function sampleFile(): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    label: 'regression-set',
    assertions: [
      {
        key: 'schema',
        scorerKey: 'output_present',
        type: 'deterministic',
        severity: 'gate',
        title: 'Output present',
        config: {},
      },
      {
        key: 'confident',
        scorerKey: 'confidence_threshold',
        severity: 'warn',
        title: 'Confident enough',
        config: { threshold: 0.6, direction: 'gte' },
      },
      {
        key: 'rationale',
        scorerKey: 'llm_judge',
        type: 'llm_judge',
        severity: 'warn',
        title: 'Rationale quality',
        config: { rubric: 'Does the rationale cite the evidence?' },
      },
    ],
    cases: [
      {
        key: 'banned-phrase-01',
        name: 'Guaranteed returns claim',
        input: { content: 'Guaranteed 20% returns' },
        expected: { overall: 'fail' },
        assertions: [{ key: 'schema' }, { key: 'confident', configOverride: { threshold: 0.8 } }],
        fixtures: { tools: 'fixtures/banned-phrase-01.tools.json' },
      },
      {
        key: 'clean-01',
        input: { content: 'Capital at risk.' },
      },
    ],
  }
}

function issueCodes(raw: unknown): string[] {
  const result = validateEvalSetFile(raw)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('eval set file format', () => {
  it('accepts a valid file and fills defaults', () => {
    const result = validateEvalSetFile(sampleFile())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.cases).toHaveLength(2)
    expect(result.file.assertions[1].type).toBeUndefined()
  })

  it('accepts a file without assertions', () => {
    const raw = { ...sampleFile(), assertions: undefined, cases: [{ key: 'a', input: 'x' }] }
    expect(validateEvalSetFile(raw).ok).toBe(true)
  })

  it('refuses a wrong format marker', () => {
    expect(issueCodes({ ...sampleFile(), format: 'something.else' })).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(issueCodes('not an object')).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(issueCodes([])).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
  })

  it('refuses unsupported or missing format versions', () => {
    expect(issueCodes({ ...sampleFile(), formatVersion: 2 })).toEqual([EVAL_SET_FILE_ISSUE.unsupportedFormatVersion])
    expect(issueCodes({ ...sampleFile(), formatVersion: '1' })).toEqual([EVAL_SET_FILE_ISSUE.unsupportedFormatVersion])
    const { formatVersion: _omitted, ...withoutVersion } = sampleFile()
    expect(issueCodes(withoutVersion)).toEqual([EVAL_SET_FILE_ISSUE.unsupportedFormatVersion])
  })

  it('rejects unknown keys at every level', () => {
    expect(issueCodes({ ...sampleFile(), extra: true })).toContain(EVAL_SET_FILE_ISSUE.schema)
    const raw = sampleFile()
    const cases = raw.cases as Array<Record<string, unknown>>
    cases[1] = { ...cases[1], expectedOutput: 'typo' }
    const result = validateEvalSetFile(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]).toMatchObject({ code: EVAL_SET_FILE_ISSUE.schema, path: 'cases.1' })
    const withSource = sampleFile()
    ;(withSource.assertions as Array<Record<string, unknown>>)[0].id = '11111111-1111-4111-8111-111111111111'
    expect(issueCodes(withSource)).toContain(EVAL_SET_FILE_ISSUE.schema)
  })

  it('requires a case input and caps the number of cases', () => {
    expect(issueCodes({ ...sampleFile(), cases: [{ key: 'no-input' }] })).toContain(EVAL_SET_FILE_ISSUE.schema)
    const tooMany = Array.from({ length: EVAL_SET_FILE_MAX_CASES + 1 }, (_, index) => ({ key: `c${index}`, input: index }))
    expect(issueCodes({ ...sampleFile(), cases: tooMany })).toContain(EVAL_SET_FILE_ISSUE.schema)
  })

  it('refuses a file above the byte cap', () => {
    const result = validateEvalSetFile(sampleFile(), { maxBytes: 100 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([expect.objectContaining({ code: EVAL_SET_FILE_ISSUE.tooLarge })])
  })

  it('refuses duplicate assertion and case keys', () => {
    const raw = sampleFile()
    const assertions = raw.assertions as Array<Record<string, unknown>>
    assertions.push({ ...assertions[0] })
    const cases = raw.cases as Array<Record<string, unknown>>
    cases.push({ key: 'clean-01', input: 'again' })
    const result = validateEvalSetFile(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.filter((issue) => issue.code === EVAL_SET_FILE_ISSUE.duplicateKey).map((issue) => issue.path)).toEqual([
      'assertions.3.key',
      'cases.2.key',
    ])
  })

  it('refuses unknown scorers and invalid scorer configs', () => {
    const raw = sampleFile()
    const assertions = raw.assertions as Array<Record<string, unknown>>
    assertions[0] = { ...assertions[0], scorerKey: 'no_such_scorer' }
    assertions[1] = { ...assertions[1], config: { threshold: 'high' } }
    expect(issueCodes(raw)).toEqual([EVAL_SET_FILE_ISSUE.unknownScorer, EVAL_SET_FILE_ISSUE.invalidScorerConfig])
  })

  it('validates judge configs with the write schema', () => {
    const raw = sampleFile()
    const assertions = raw.assertions as Array<Record<string, unknown>>
    assertions[2] = { ...assertions[2], config: { promptTemplate: '', scoring: { kind: 'choice', choices: [] } } }
    expect(issueCodes(raw)).toContain(EVAL_SET_FILE_ISSUE.invalidScorerConfig)
  })

  it('refuses gate severity on judge assertions', () => {
    const raw = sampleFile()
    const assertions = raw.assertions as Array<Record<string, unknown>>
    assertions[2] = { ...assertions[2], severity: 'gate' }
    expect(issueCodes(raw)).toEqual([EVAL_SET_FILE_ISSUE.judgeGate])
  })

  it('refuses a declared type that contradicts the scorer kind', () => {
    const raw = sampleFile()
    const assertions = raw.assertions as Array<Record<string, unknown>>
    assertions[0] = { ...assertions[0], type: 'llm_judge' }
    expect(issueCodes(raw)).toEqual([EVAL_SET_FILE_ISSUE.scorerTypeMismatch])
  })

  it('refuses case assertion refs that are unknown, repeated or carry a bad override', () => {
    const raw = sampleFile()
    const cases = raw.cases as Array<Record<string, unknown>>
    cases[1] = {
      ...cases[1],
      assertions: [
        { key: 'missing' },
        { key: 'confident', configOverride: { threshold: 3 } },
        { key: 'confident' },
      ],
    }
    expect(issueCodes(raw)).toEqual([
      EVAL_SET_FILE_ISSUE.unknownAssertionRef,
      EVAL_SET_FILE_ISSUE.invalidScorerConfig,
      EVAL_SET_FILE_ISSUE.duplicateAssertionRef,
    ])
  })

  it.each(['/etc/passwd', '../outside.json', 'fixtures/../../x.json', 'C:\\fixtures\\a.json'])(
    'refuses fixture path %s',
    (path) => {
      const raw = sampleFile()
      const cases = raw.cases as Array<Record<string, unknown>>
      cases[1] = { ...cases[1], fixtures: { tools: path } }
      expect(issueCodes(raw)).toContain(EVAL_SET_FILE_ISSUE.schema)
    },
  )

  it('throws a typed error from parseEvalSetFile', () => {
    expect(() => parseEvalSetFile({ ...sampleFile(), formatVersion: 9 })).toThrow(EvalSetFileInvalidError)
    try {
      parseEvalSetFile({ ...sampleFile(), formatVersion: 9 })
    } catch (error) {
      expect((error as EvalSetFileInvalidError).issues[0].code).toBe(EVAL_SET_FILE_ISSUE.unsupportedFormatVersion)
    }
  })
})

describe('manifestFromFile', () => {
  it('builds a file manifest with deterministic ids and resolved refs', () => {
    const { manifest, version } = manifestFromFile(parseEvalSetFile(sampleFile()))
    expect(version).toMatch(HASH_PATTERN)
    expect(manifest.source).toBe('file')
    expect(manifest.label).toBe('regression-set')
    expect(manifest.assertions.map((assertion) => assertion.key)).toEqual(['confident', 'rationale', 'schema'])
    const confident = manifest.assertions.find((assertion) => assertion.key === 'confident')
    expect(confident).toMatchObject({ id: deterministicAssertionId(AGENT, 'confident'), type: 'deterministic' })
    const judge = manifest.assertions.find((assertion) => assertion.key === 'rationale')
    expect(judge?.rubric?.scoring.kind).toBe('binary')
    const banned = manifest.cases.find((entry) => entry.key === 'banned-phrase-01')
    expect(banned).toMatchObject({
      id: deterministicCaseId(AGENT, 'banned-phrase-01'),
      name: 'Guaranteed returns claim',
      fixtures: { tools: 'fixtures/banned-phrase-01.tools.json' },
    })
    expect(banned?.assertions).toEqual(
      [
        { assertionId: deterministicAssertionId(AGENT, 'confident'), configOverride: { threshold: 0.8 }, disabled: false },
        { assertionId: deterministicAssertionId(AGENT, 'schema'), configOverride: null, disabled: false },
      ].sort((left, right) => (left.assertionId < right.assertionId ? -1 : 1)),
    )
    const clean = manifest.cases.find((entry) => entry.key === 'clean-01')
    expect(clean).toMatchObject({ name: null, expected: null, assertions: null })
    expect(clean && 'fixtures' in clean).toBe(false)
  })

  it('hashes independently of authoring order', () => {
    const reordered = sampleFile()
    ;(reordered.assertions as unknown[]).reverse()
    ;(reordered.cases as unknown[]).reverse()
    const original = manifestFromFile(parseEvalSetFile(sampleFile())).version
    expect(manifestFromFile(parseEvalSetFile(reordered)).version).toBe(original)
  })

  it('changes the hash when a case or config changes', () => {
    const original = manifestFromFile(parseEvalSetFile(sampleFile())).version
    const edited = sampleFile()
    ;(edited.assertions as Array<Record<string, unknown>>)[1].config = { threshold: 0.7, direction: 'gte' }
    expect(manifestFromFile(parseEvalSetFile(edited)).version).not.toBe(original)
  })

  it('enforces the manifest byte cap', () => {
    expect(() => manifestFromFile(parseEvalSetFile(sampleFile()), { maxBytes: 64 })).toThrow(EvalSetTooLargeError)
  })
})

describe('fileFromManifest', () => {
  it('round trips export then import to the same hash', () => {
    const imported = manifestFromFile(parseEvalSetFile(sampleFile()))
    const exported: EvalSetFile = fileFromManifest(imported.manifest)
    const serialized = JSON.parse(JSON.stringify(exported)) as unknown
    const reimported = manifestFromFile(parseEvalSetFile(serialized))
    expect(reimported.version).toBe(imported.version)
    expect(fileFromManifest(reimported.manifest)).toEqual(exported)
  })

  it('exports a db manifest as a valid file and drops refs to assertions outside the set', () => {
    const dbManifest: EvalSetManifest = {
      format: EVAL_SET_FORMAT,
      formatVersion: 1,
      agentId: AGENT,
      label: null,
      source: 'db',
      assertions: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          key: 'present',
          scorerKey: 'output_present',
          type: 'deterministic',
          severity: 'gate',
          title: 'Present',
          config: {},
        },
      ],
      cases: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          key: '22222222-2222-4222-8222-222222222222',
          name: null,
          input: { content: 'x' },
          expected: null,
          assertions: [
            { assertionId: '11111111-1111-4111-8111-111111111111', configOverride: null, disabled: true },
            { assertionId: '33333333-3333-4333-8333-333333333333', configOverride: null, disabled: false },
          ],
        },
      ],
    }
    const exported = fileFromManifest(dbManifest)
    expect(exported).not.toHaveProperty('label')
    expect(exported.cases[0]).toEqual({
      key: '22222222-2222-4222-8222-222222222222',
      input: { content: 'x' },
      assertions: [{ key: 'present', disabled: true }],
    })
    const validated = validateEvalSetFile(exported)
    expect(validated.ok).toBe(true)
    const first = manifestFromFile(parseEvalSetFile(exported))
    expect(first.manifest.source).toBe('file')
    expect(first.version).not.toBe(hashManifest(dbManifest))
    expect(manifestFromFile(parseEvalSetFile(fileFromManifest(first.manifest))).version).toBe(first.version)
  })
})
