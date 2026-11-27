import { EVAL_SET_FILE_ISSUE, EvalSetFileInvalidError, manifestFromFile, parseEvalSetFile } from '../lib/eval/evalSetFile'
import {
  detectEvalSetTextFormat,
  parseEvalSetText,
  stringifyEvalSetFile,
  validateEvalSetText,
} from '../lib/eval/evalSetYaml'
import { EVAL_SET_FORMAT } from '../lib/eval/manifest'

const AGENT = 'content_review.validator'

function sampleFile(): Record<string, unknown> {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: 1,
    agentId: AGENT,
    label: 'regression-set',
    assertions: [
      { key: 'schema', scorerKey: 'output_present', type: 'deterministic', severity: 'gate', title: 'Output present', config: {} },
      {
        key: 'confident',
        scorerKey: 'confidence_threshold',
        severity: 'warn',
        title: 'Confident enough',
        config: { threshold: 0.6, direction: 'gte' },
      },
    ],
    cases: [
      {
        key: 'banned-phrase-01',
        name: 'Guaranteed returns claim: yes',
        input: { content: 'Guaranteed 20% returns', flags: ['yes', 'no', 'null', '123', '', ' padded '], zeta: 1, alpha: { b: 2, a: 1 } },
        expected: { overall: 'fail', note: 'multi\nline text' },
        assertions: [{ key: 'schema' }, { key: 'confident', configOverride: { threshold: 0.8 }, disabled: true }],
        fixtures: { tools: 'fixtures/tools.json' },
      },
      { key: 'plain-02', input: 'just a string' },
    ],
  }
}

function codes(text: string, options: Parameters<typeof validateEvalSetText>[1] = {}): string[] {
  const result = validateEvalSetText(text, options)
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('eval set YAML', () => {
  it('round-trips file to YAML to file with the same manifest hash', () => {
    const file = parseEvalSetFile(sampleFile())
    const yamlText = stringifyEvalSetFile(file, 'yaml')
    const back = parseEvalSetText(yamlText, { format: 'yaml' })
    expect(back).toEqual(file)
    expect(manifestFromFile(back).version).toBe(manifestFromFile(file).version)
    expect(stringifyEvalSetFile(back, 'yaml')).toBe(yamlText)
  })

  it('serializes deterministically with stable key order and no anchors', () => {
    const file = parseEvalSetFile(sampleFile())
    const shuffled = parseEvalSetFile(JSON.parse(JSON.stringify(sampleFile())))
    const text = stringifyEvalSetFile(file, 'yaml')
    expect(stringifyEvalSetFile(shuffled, 'yaml')).toBe(text)
    expect(text.indexOf('format:')).toBeLessThan(text.indexOf('agentId:'))
    expect(text.indexOf('agentId:')).toBeLessThan(text.indexOf('cases:'))
    expect(text.indexOf('a: 1')).toBeLessThan(text.indexOf('b: 2'))
    expect(text).not.toMatch(/&\w|\*\w/)
  })

  it('does not alias repeated objects', () => {
    const shared = { threshold: 0.5 }
    const raw = sampleFile()
    ;(raw.cases as Array<Record<string, unknown>>)[1] = { key: 'plain-02', input: { a: shared, b: shared } }
    const file = parseEvalSetFile(raw)
    const text = stringifyEvalSetFile(file, 'yaml')
    expect(text).not.toMatch(/&|\*/)
    expect(parseEvalSetText(text)).toEqual(file)
  })

  it('round-trips through json export and yaml import with the same hash', () => {
    const file = parseEvalSetFile(sampleFile())
    const jsonText = stringifyEvalSetFile(file, 'json')
    expect(detectEvalSetTextFormat(jsonText)).toBe('json')
    const fromJson = parseEvalSetText(jsonText)
    expect(fromJson).toEqual(file)
    expect(parseEvalSetText(jsonText, { format: 'yaml' })).toEqual(file)
    expect(manifestFromFile(fromJson).version).toBe(manifestFromFile(file).version)
  })

  it('auto-detects yaml', () => {
    const text = stringifyEvalSetFile(parseEvalSetFile(sampleFile()), 'yaml')
    expect(detectEvalSetTextFormat(text)).toBe('yaml')
    expect(parseEvalSetText(text).agentId).toBe(AGENT)
  })

  it('rejects an alias bomb', () => {
    const text = [
      'a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    ].join('\n')
    expect(codes(text, { format: 'yaml' })).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
  })

  it('rejects any alias or anchor use inside an otherwise valid file', () => {
    const text = stringifyEvalSetFile(parseEvalSetFile(sampleFile()), 'yaml').replace(
      'agentId: content_review.validator',
      'agentId: &id content_review.validator\nother: *id',
    )
    expect(validateEvalSetText(text).ok).toBe(false)
  })

  it('rejects custom and language-specific tags', () => {
    const base = stringifyEvalSetFile(parseEvalSetFile(sampleFile()), 'yaml')
    for (const tag of ['!custom', '!!js/function', '!!python/object:os.system', '!!binary']) {
      const text = base.replace('label: regression-set', `label: ${tag} regression-set`)
      expect(validateEvalSetText(text).ok).toBe(false)
    }
  })

  it('rejects duplicate keys', () => {
    expect(codes('format: x\nformat: y\n')).toEqual([EVAL_SET_FILE_ISSUE.duplicateKey])
    const json = '{"format":"om.agent-eval-set","format":"other"}'
    expect(codes(json)).toEqual([EVAL_SET_FILE_ISSUE.duplicateKey])
  })

  it('rejects merge keys and multiple documents', () => {
    expect(validateEvalSetText('a: &x {b: 1}\nc:\n  <<: *x\n').ok).toBe(false)
    expect(validateEvalSetText('a: 1\n---\nb: 2\n').ok).toBe(false)
  })

  it('caps the raw text size before parsing', () => {
    const huge = `format: ${'x'.repeat(2000)}\n`
    const result = validateEvalSetText(huge, { maxBytes: 1000 })
    expect(result.ok).toBe(false)
    expect(codes(huge, { maxBytes: 1000 })).toEqual([EVAL_SET_FILE_ISSUE.tooLarge])
  })

  it('maps syntax and envelope errors to the file issue codes', () => {
    expect(codes('{not json')).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(codes('key: [unclosed', { format: 'yaml' })).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(codes('')).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(codes('- a\n- b\n')).toEqual([EVAL_SET_FILE_ISSUE.invalidFormat])
    expect(codes(`format: ${EVAL_SET_FORMAT}\nformatVersion: 99\n`)).toEqual([EVAL_SET_FILE_ISSUE.unsupportedFormatVersion])
  })

  it('hands parsed values to schema validation', () => {
    const text = stringifyEvalSetFile(parseEvalSetFile(sampleFile()), 'yaml').replace('output_present', 'nope')
    expect(codes(text)).toContain(EVAL_SET_FILE_ISSUE.unknownScorer)
    expect(() => parseEvalSetText(text)).toThrow(EvalSetFileInvalidError)
  })

  it('treats yaml-only scalars as plain data', () => {
    const text = stringifyEvalSetFile(parseEvalSetFile(sampleFile()), 'yaml')
    const withDate = text.replace('input: just a string', 'input: 2026-01-01')
    expect(parseEvalSetText(withDate).cases[1].input).toBe('2026-01-01')
  })
})
