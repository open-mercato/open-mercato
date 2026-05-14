import {
  resolveRecall,
  tokenizeRecall,
} from '../backend/forms/[id]/studio/recall'

describe('tokenizeRecall', () => {
  it('finds three namespaces and ignores escapes', () => {
    const tokens = tokenizeRecall('Hi @{name} — id @{hidden.patient_id} — total @{var.phq_total} — literal @@{escape}')
    expect(tokens).toHaveLength(3)
    expect(tokens[0]).toMatchObject({ identifier: 'name', namespace: 'field', name: 'name' })
    expect(tokens[1]).toMatchObject({ identifier: 'hidden.patient_id', namespace: 'hidden', name: 'patient_id' })
    expect(tokens[2]).toMatchObject({ identifier: 'var.phq_total', namespace: 'variable', name: 'phq_total' })
  })

  it('rejects identifiers that do not match the grammar', () => {
    expect(tokenizeRecall('Invalid @{1abc}')).toHaveLength(0)
    expect(tokenizeRecall('Invalid @{Capital}')).toHaveLength(0)
  })
})

describe('resolveRecall', () => {
  const baseContext = {
    answers: { name: 'Pat', age: 30 },
    hidden: { patient_id: 'abc-123' },
    variables: { phq_total: 17 },
  }

  it('substitutes tokens across namespaces', () => {
    const out = resolveRecall('Hi @{name}, age @{age}, id @{hidden.patient_id}, score @{var.phq_total}', baseContext, 'en')
    expect(out).toBe('Hi Pat, age 30, id abc-123, score 17')
  })

  it('returns empty string for unresolved tokens, no throw', () => {
    expect(resolveRecall('Hello @{unknown}', baseContext, 'en')).toBe('Hello ')
  })

  it('warns when verbose=true on unresolved token', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    resolveRecall('@{ghost}', { ...baseContext, verbose: true }, 'en')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('escapes @@{ to literal @{', () => {
    expect(resolveRecall('Literal @@{name}', baseContext, 'en')).toBe('Literal @{name}')
  })

  it('redacts sensitive fields when listed in the context', () => {
    const ctx = { ...baseContext, sensitiveFields: new Set(['name']) }
    expect(resolveRecall('Hi @{name}', ctx, 'en')).toBe('Hi ')
  })

  it('formats numbers with locale', () => {
    expect(resolveRecall('Score @{var.phq_total}', { ...baseContext, variables: { phq_total: 1234.5 } }, 'en-US')).toBe('Score 1,234.5')
  })

  it('returns empty string for null/undefined input', () => {
    expect(resolveRecall(null, baseContext, 'en')).toBe('')
    expect(resolveRecall(undefined, baseContext, 'en')).toBe('')
  })
})
