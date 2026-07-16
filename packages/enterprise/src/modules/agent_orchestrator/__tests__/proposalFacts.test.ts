import {
  deriveFactsFromInput,
  deriveProposedFields,
  deriveReasoning,
  formatFactValue,
  resolveDeclaredFacts,
  resolvePath,
} from '../components/proposalFactsData'

const liabilityFinding = {
  actions: [
    {
      type: 'flag_liability',
      payload: { responsibility_verdict: 'accept_responsibility', responsibility_verdict_reason: 'Covered.' },
    },
  ],
  confidence: 0.85,
  rationale: 'Policy active at loss; culprit is our insured.',
}

const decisionPayload = {
  actions: [{ type: 'make_decision', payload: { outcome: 'wyplata', amount: 14500, preparePosition: false } }],
  confidence: 0.8,
  rationale: 'Liability accepted; amount from the value sub-process reserve.',
}

const runInput = {
  claimId: 'a0cbbc14-0c49-461a-b1b3-3a5a9d0775b7',
  claimNumber: 'SZK-2026-000001',
  liability: liabilityFinding,
  value: null,
}

describe('resolvePath', () => {
  it('resolves nested object paths and array indexes', () => {
    expect(resolvePath(runInput, 'liability.actions.0.payload.responsibility_verdict')).toBe(
      'accept_responsibility',
    )
    expect(resolvePath(runInput, 'claimNumber')).toBe('SZK-2026-000001')
  })

  it('returns undefined for missing segments, null roots, and bad indexes', () => {
    expect(resolvePath(runInput, 'liability.actions.9.payload')).toBeUndefined()
    expect(resolvePath(runInput, 'value.actions.0')).toBeUndefined()
    expect(resolvePath(runInput, 'liability.actions.x')).toBeUndefined()
    expect(resolvePath(null, 'anything')).toBeUndefined()
  })
})

describe('formatFactValue', () => {
  it('formats percent from fractions and whole numbers', () => {
    expect(formatFactValue(0.85, 'percent')).toBe('85%')
    expect(formatFactValue(85, 'percent')).toBe('85%')
  })

  it('formats numbers, booleans, and trims strings', () => {
    expect(formatFactValue(14500, 'number')).toBe((14500).toLocaleString())
    expect(formatFactValue(true)).toBe('✓')
    expect(formatFactValue(false, 'boolean')).toBe('✗')
    expect(formatFactValue('  ok  ')).toBe('ok')
    expect(formatFactValue('')).toBeNull()
    expect(formatFactValue(null)).toBeNull()
  })
})

describe('resolveDeclaredFacts', () => {
  it('resolves facts per declared source and drops unresolvable entries', () => {
    const resolved = resolveDeclaredFacts(
      [
        { label: 'Verdict', source: 'input', path: 'liability.actions.0.payload.responsibility_verdict' },
        { label: 'Amount', source: 'payload', path: 'actions.0.payload.amount', format: 'number' },
        { label: 'Missing', source: 'output', path: 'nothing.here' },
      ],
      { input: runInput, payload: decisionPayload, output: null },
    )
    expect(resolved).toEqual([
      { label: 'Verdict', value: 'accept_responsibility' },
      { label: 'Amount', value: (14500).toLocaleString() },
    ])
  })
})

describe('deriveFactsFromInput', () => {
  it('shows primitives directly and summarizes nested proposal-shaped findings', () => {
    const facts = deriveFactsFromInput(runInput)
    expect(facts).toEqual([
      { label: 'Claim Id', value: 'a0cbbc14-0c49-461a-b1b3-3a5a9d0775b7' },
      { label: 'Claim Number', value: 'SZK-2026-000001' },
      { label: 'Liability', value: 'flag_liability · 85%' },
    ])
  })

  it('returns nothing for non-object input', () => {
    expect(deriveFactsFromInput(null)).toEqual([])
    expect(deriveFactsFromInput('text')).toEqual([])
  })
})

describe('deriveProposedFields', () => {
  it('flattens the first action payload primitives', () => {
    expect(deriveProposedFields(decisionPayload)).toEqual([
      { label: 'Outcome', value: 'wyplata' },
      { label: 'Amount', value: (14500).toLocaleString() },
      { label: 'Prepare Position', value: '✗' },
    ])
  })

  it('returns nothing when the payload is not proposal-shaped', () => {
    expect(deriveProposedFields({ note: 'plain' })).toEqual([])
    expect(deriveProposedFields(null)).toEqual([])
  })
})

describe('deriveReasoning', () => {
  it('leads with the proposal rationale, then labelled upstream rationales', () => {
    expect(deriveReasoning(decisionPayload.rationale, runInput)).toEqual([
      { label: null, text: 'Liability accepted; amount from the value sub-process reserve.' },
      { label: 'Liability', text: 'Policy active at loss; culprit is our insured.' },
    ])
  })

  it('returns an empty list with no rationale anywhere', () => {
    expect(deriveReasoning(null, { claimId: 'x' })).toEqual([])
  })
})
