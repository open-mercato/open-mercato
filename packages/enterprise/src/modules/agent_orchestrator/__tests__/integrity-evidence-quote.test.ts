import { evidenceQuoteRuleSchema, type EvidenceQuoteRule } from '../data/validators'
import { evaluateEvidenceQuote } from '../lib/guardrails/integrity/rules/evidenceQuote'
import type { IntegrityRuleContext } from '../lib/guardrails/integrity/types'

const CONTENT = 'The supplier shall deliver within 30 days. Late delivery incurs a penalty of 2% per week.'

function buildRule(overrides: Record<string, unknown> = {}): EvidenceQuoteRule {
  return evidenceQuoteRuleSchema.parse({
    id: 'quotes',
    kind: 'evidence_quote',
    items: 'data.findings[*].evidence[*]',
    quote: 'quote',
    offsets: { start: 'start', end: 'end' },
    source: { input: 'content' },
    ...overrides,
  })
}

function buildContext(output: unknown, input: unknown = { content: CONTENT }): IntegrityRuleContext {
  return { output, input, toolCalls: [], guardrailSetVersion: 'i1-test' }
}

function envelope(evidence: unknown[]): { data: { findings: Array<{ id: string; evidence: unknown[] }> } } {
  return { data: { findings: [{ id: 'finding-1', evidence }] } }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child))
    Object.freeze(value)
  }
  return value
}

function startOf(text: string): number {
  return CONTENT.indexOf(text)
}

describe('evidence_quote integrity rule', () => {
  it('passes an exact hit with correct offsets', () => {
    const quote = 'deliver within 30 days'
    const output = envelope([{ quote, start: startOf(quote), end: startOf(quote) + quote.length }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    expect(outcome.check).toEqual({
      kind: 'evidence_quote',
      result: 'pass',
      guardrailSetVersion: 'i1-test',
      evidence: { ruleId: 'quotes', items: 1, violations: [], dropped: 0, repaired: 0, ambiguous: 0 },
    })
    expect(outcome.changed).toBe(false)
    expect(outcome.blocked).toBe(false)
    expect(outcome.output).toBe(output)
  })

  it('matches a normalized quote and repairs it to the canonical source text', () => {
    const source = 'He said “no refunds”   after   delivery.'
    const output = envelope([{ quote: '"no refunds" after delivery' }])
    const outcome = evaluateEvidenceQuote(buildContext(output, { content: source }), buildRule())
    const [item] = (outcome.output as ReturnType<typeof envelope>).data.findings[0].evidence as Array<Record<string, unknown>>
    expect(item.quote).toBe('“no refunds”   after   delivery')
    expect(source.slice(item.start as number, item.end as number)).toBe(item.quote)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ repaired: 1, dropped: 0, violations: [] })
  })

  it('keeps the model quote when repairQuote is disabled', () => {
    const output = envelope([{ quote: 'deliver  within 30 days' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule({ repairQuote: false, offsets: undefined }))
    expect(outcome.check.result).toBe('pass')
    expect(outcome.output).toBe(output)
  })

  it('drops a missed quote by default and records a warn with counts', () => {
    const good = 'penalty of 2% per week'
    const output = envelope([
      { quote: 'invented clause text' },
      { quote: good, start: startOf(good), end: startOf(good) + good.length },
    ])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    const evidence = (outcome.output as ReturnType<typeof envelope>).data.findings[0].evidence
    expect(evidence).toHaveLength(1)
    expect((evidence[0] as { quote: string }).quote).toBe(good)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toEqual({
      ruleId: 'quotes',
      items: 2,
      violations: [{ itemPath: 'data.findings[0].evidence[0]', reason: 'not_found' }],
      dropped: 1,
      repaired: 0,
      ambiguous: 0,
    })
    expect(outcome.changed).toBe(true)
  })

  it('flags a miss: keeps the item, warns and holds auto-approval', () => {
    const output = envelope([{ quote: 'invented clause text' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule({ onViolation: 'flag' }))
    expect(outcome.output).toBe(output)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ dropped: 0, holdsAutoApproval: true })
  })

  it('treats a miss under repair like flag since a missing quote cannot be repaired', () => {
    const output = envelope([{ quote: 'invented clause text' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule({ onViolation: 'repair' }))
    expect(outcome.output).toBe(output)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ dropped: 0, holdsAutoApproval: true })
  })

  it('blocks a miss and returns the input output untouched', () => {
    const quote = 'deliver within 30 days'
    const output = envelope([{ quote, start: 0, end: 1 }, { quote: 'invented clause text' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule({ onViolation: 'block' }))
    expect(outcome.blocked).toBe(true)
    expect(outcome.changed).toBe(false)
    expect(outcome.output).toBe(output)
    expect(outcome.check.result).toBe('block')
    expect(outcome.check.evidence).toMatchObject({ dropped: 0, violations: [{ itemPath: 'data.findings[0].evidence[1]', reason: 'not_found' }] })
  })

  it('repairs wrong model offsets and counts them', () => {
    const quote = 'Late delivery'
    const output = envelope([{ quote, start: 3, end: 9 }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    const [item] = (outcome.output as ReturnType<typeof envelope>).data.findings[0].evidence as Array<Record<string, number>>
    expect(item.start).toBe(startOf(quote))
    expect(item.end).toBe(startOf(quote) + quote.length)
    expect(outcome.check.result).toBe('warn')
    expect(outcome.check.evidence).toMatchObject({ repaired: 1, violations: [] })
  })

  it('reports source_missing when the input path is absent or not a string', () => {
    const output = envelope([{ quote: 'deliver within 30 days' }])
    const missing = evaluateEvidenceQuote(buildContext(output, {}), buildRule({ onViolation: 'flag' }))
    const wrongType = evaluateEvidenceQuote(buildContext(output, { content: 42 }), buildRule({ onViolation: 'flag' }))
    for (const outcome of [missing, wrongType]) {
      expect(outcome.check.evidence).toMatchObject({ violations: [{ itemPath: 'data.findings[0].evidence[0]', reason: 'source_missing' }] })
    }
  })

  it('reports quote_missing for a non-string quote', () => {
    const output = envelope([{ quote: 7 }, { text: 'no quote' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    expect(outcome.check.evidence).toMatchObject({
      dropped: 2,
      violations: [
        { itemPath: 'data.findings[0].evidence[0]', reason: 'quote_missing' },
        { itemPath: 'data.findings[0].evidence[1]', reason: 'quote_missing' },
      ],
    })
  })

  it('rejects quotes shorter than minChars counted in graphemes', () => {
    const output = envelope([{ quote: 'Th' }])
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    expect(outcome.check.evidence).toMatchObject({ violations: [{ reason: 'too_short' }], dropped: 1 })
    const emoji = '👨‍👩‍👧👍🏽'
    const relaxed = evaluateEvidenceQuote(
      buildContext(envelope([{ quote: emoji }]), { content: `family ${emoji} ok` }),
      buildRule({ minChars: 3, onViolation: 'flag' }),
    )
    expect(relaxed.check.evidence).toMatchObject({ violations: [{ reason: 'too_short' }] })
  })

  it('resolves ambiguity by the nearest claimed start and records it', () => {
    const source = 'net 30 days. Later: net 30 days again. Final: net 30 days.'
    const second = source.indexOf('net 30 days', 5)
    const output = envelope([{ quote: 'net 30 days', start: second + 2, end: second + 13 }])
    const outcome = evaluateEvidenceQuote(buildContext(output, { content: source }), buildRule())
    const [item] = (outcome.output as ReturnType<typeof envelope>).data.findings[0].evidence as Array<Record<string, number>>
    expect(item.start).toBe(second)
    expect(item.end).toBe(second + 'net 30 days'.length)
    expect(outcome.check.evidence).toMatchObject({ ambiguous: 1, repaired: 1 })
  })

  it('resolves the source through a fromItem path naming the input field', () => {
    const input = { documents: { contract: CONTENT, annex: 'Annex A lists the penalty table.' } }
    const output = envelope([
      { quote: 'penalty table', field: 'documents.annex' },
      { quote: 'penalty table', field: 'documents.contract' },
      { quote: 'penalty table', field: 'documents..broken' },
    ])
    const outcome = evaluateEvidenceQuote(
      buildContext(output, input),
      buildRule({ source: { fromItem: 'field' }, offsets: undefined, onViolation: 'flag' }),
    )
    expect(outcome.check.evidence).toMatchObject({
      items: 3,
      violations: [
        { itemPath: 'data.findings[0].evidence[1]', reason: 'not_found' },
        { itemPath: 'data.findings[0].evidence[2]', reason: 'source_missing' },
      ],
    })
  })

  it('drops across nested wildcard items without shifting siblings', () => {
    const output = {
      data: {
        findings: [
          { id: 'a', evidence: [{ quote: 'fake one' }, { quote: 'deliver within' }, { quote: 'fake two' }] },
          { id: 'b', evidence: [{ quote: 'fake three' }, { quote: 'per week' }] },
        ],
      },
    }
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule({ offsets: undefined }))
    const findings = (outcome.output as typeof output).data.findings
    expect(findings.map((finding) => finding.evidence.map((item) => item.quote))).toEqual([['deliver within'], ['per week']])
    expect(outcome.check.evidence).toMatchObject({ items: 5, dropped: 3 })
  })

  it('caps violations at 20 and never records quote or input text', () => {
    const secretSource = 'TOP-SECRET-INPUT body text that must never leak into evidence.'
    const evidenceItems = Array.from({ length: 25 }, (_, position) => ({ quote: `hallucinated secret ${position}` }))
    const outcome = evaluateEvidenceQuote(
      buildContext(envelope([...evidenceItems, { quote: 'never  leak' }]), { content: secretSource }),
      buildRule({ onViolation: 'flag' }),
    )
    const evidence = outcome.check.evidence as { violations: unknown[]; items: number; repaired: number }
    expect(evidence.items).toBe(26)
    expect(evidence.violations).toHaveLength(20)
    expect(evidence.repaired).toBe(1)
    const serialized = JSON.stringify(outcome.check)
    expect(serialized).not.toMatch(/hallucinated|secret|TOP-SECRET|leak|body text/i)
  })

  it('never mutates the context output', () => {
    const output = deepFreeze(envelope([{ quote: 'invented clause' }, { quote: 'Late  delivery', start: 0, end: 0 }]))
    const snapshot = JSON.parse(JSON.stringify(output))
    const outcome = evaluateEvidenceQuote(buildContext(output), buildRule())
    expect(output).toEqual(snapshot)
    expect(outcome.output).not.toBe(output)
    expect((outcome.output as ReturnType<typeof envelope>).data.findings[0].evidence).toEqual([
      { quote: 'Late delivery', start: startOf('Late delivery'), end: startOf('Late delivery') + 13 },
    ])
  })

  it('computes offsets in utf16 or codepoint units', () => {
    const source = '😀😀 clause ✔ accepted'
    const quote = 'clause ✔ accepted'
    const utf16 = evaluateEvidenceQuote(buildContext(envelope([{ quote }]), { content: source }), buildRule())
    const codepoint = evaluateEvidenceQuote(
      buildContext(envelope([{ quote }]), { content: source }),
      buildRule({ offsetUnit: 'codepoint' }),
    )
    const [utf16Item] = (utf16.output as ReturnType<typeof envelope>).data.findings[0].evidence as Array<Record<string, number>>
    const [codepointItem] = (codepoint.output as ReturnType<typeof envelope>).data.findings[0].evidence as Array<Record<string, unknown>>
    expect(utf16Item.start).toBe(5)
    expect(utf16Item.end).toBe(source.length)
    expect(codepointItem.start).toBe(3)
    expect(codepointItem.end).toBe(Array.from(source).length)
    expect(codepointItem.quote).toBe(quote)
  })
})
