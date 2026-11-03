import {
  checkSubmissionTamper,
  pickHiddenFromUrl,
} from '../runner/tamper-check'

describe('checkSubmissionTamper', () => {
  const schema = {
    properties: {
      age: { type: 'number', 'x-om-type': 'number' },
      info: { type: 'string', 'x-om-type': 'info_block' },
    },
    'x-om-sections': [
      { key: 'page_1', kind: 'page', title: { en: 'P1' }, fieldKeys: ['age'] },
      { key: 'page_2', kind: 'page', title: { en: 'P2' }, fieldKeys: [] },
      { key: 'disclaimer', kind: 'ending', title: { en: 'Disclaimer' }, fieldKeys: ['info'] },
    ],
    'x-om-jumps': [
      {
        from: { type: 'page', pageKey: 'page_1' },
        rules: [
          { if: { '<': [{ var: 'age' }, 18] }, goto: { type: 'ending', endingKey: 'disclaimer' } },
        ],
        otherwise: { type: 'page', pageKey: 'page_2' },
      },
    ],
  }

  it('accepts a claimed ending the evaluator actually reaches', () => {
    const result = checkSubmissionTamper({
      schema,
      answers: { age: 14 },
      hidden: {},
      claimedEndingKey: 'disclaimer',
      locale: 'en',
    })
    expect(result.ok).toBe(true)
    expect(result.reachedEndingKey).toBe('disclaimer')
  })

  it('rejects a claimed ending when answers do not trigger it', () => {
    const result = checkSubmissionTamper({
      schema,
      answers: { age: 30 },
      hidden: {},
      claimedEndingKey: 'disclaimer',
      locale: 'en',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('ending_mismatch')
    expect(result.reachedEndingKey).toBeNull()
  })

  it('rejects unknown ending keys outright', () => {
    const result = checkSubmissionTamper({
      schema,
      answers: { age: 30 },
      hidden: {},
      claimedEndingKey: 'ghost',
      locale: 'en',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_ending')
  })

  it('accepts no-ending claim when natural flow reaches submit', () => {
    const result = checkSubmissionTamper({
      schema,
      answers: { age: 30 },
      hidden: {},
      claimedEndingKey: null,
      locale: 'en',
    })
    expect(result.ok).toBe(true)
    expect(result.reachedEndingKey).toBeNull()
  })
})

describe('pickHiddenFromUrl', () => {
  it('picks declared hidden field values from URL params, falling back to defaults', () => {
    const schema = {
      'x-om-hidden-fields': [
        { name: 'patient_id' },
        { name: 'utm_source', defaultValue: 'direct' },
      ],
    }
    const params = new URLSearchParams('patient_id=abc-123&unrelated=foo')
    const hidden = pickHiddenFromUrl(schema, params)
    expect(hidden).toEqual({
      patient_id: 'abc-123',
      utm_source: 'direct',
    })
  })

  it('ignores undeclared query keys', () => {
    const schema = { 'x-om-hidden-fields': [{ name: 'patient_id' }] }
    const params = new URLSearchParams('referrer=newsletter')
    expect(pickHiddenFromUrl(schema, params)).toEqual({})
  })

  it('accepts a plain Record<string, string> shape', () => {
    const schema = { 'x-om-hidden-fields': [{ name: 'utm', defaultValue: 'default' }] }
    expect(pickHiddenFromUrl(schema, { utm: 'campaign-1' })).toEqual({ utm: 'campaign-1' })
    expect(pickHiddenFromUrl(schema, {})).toEqual({ utm: 'default' })
  })
})
