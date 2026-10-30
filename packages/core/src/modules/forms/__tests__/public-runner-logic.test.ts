import {
  collectMissingRequired,
  deriveLogicState,
} from '../ui/public/state/logic-derivation'
import type { RunnerFieldDescriptor, RunnerSchema } from '../ui/public/types'

const descriptor = (key: string, type: string): RunnerFieldDescriptor => ({
  key,
  type,
  sectionKey: null,
  sensitive: false,
  editableBy: [],
  visibleTo: [],
  required: true,
})

describe('public runner — conditional visibility convergence', () => {
  const schema: RunnerSchema = {
    type: 'object',
    required: ['smoker', 'cigarettes'],
    properties: {
      smoker: { type: 'boolean', 'x-om-type': 'yes_no' },
      cigarettes: {
        type: 'number',
        'x-om-type': 'number',
        'x-om-visibility-if': { '==': [{ var: 'smoker' }, true] },
      },
    },
    'x-om-sections': [
      { key: 's1', title: { en: 'S1' }, fieldKeys: ['smoker', 'cigarettes'] },
    ],
  }

  const fieldIndex: Record<string, RunnerFieldDescriptor> = {
    smoker: descriptor('smoker', 'boolean'),
    cigarettes: descriptor('cigarettes', 'number'),
  }

  it('excludes a field hidden by x-om-visibility-if from the visible set', () => {
    const hiddenState = deriveLogicState({ schema, values: { smoker: false }, hidden: {}, locale: 'en' })
    expect(hiddenState?.visibleFieldKeys.has('cigarettes')).toBe(false)

    const shownState = deriveLogicState({ schema, values: { smoker: true }, hidden: {}, locale: 'en' })
    expect(shownState?.visibleFieldKeys.has('cigarettes')).toBe(true)
  })

  it('ignores a hidden required field when gating section completion', () => {
    const hiddenState = deriveLogicState({ schema, values: { smoker: false }, hidden: {}, locale: 'en' })
    // `cigarettes` is required but hidden — it must not block Next/submit.
    const missing = collectMissingRequired({
      schema,
      fieldIndex,
      sectionFieldKeys: ['smoker', 'cigarettes'],
      values: { smoker: false },
      visibleFieldKeys: hiddenState!.visibleFieldKeys,
    })
    expect(missing).toEqual([])
  })

  it('still flags a visible required field that is empty', () => {
    const shownState = deriveLogicState({ schema, values: { smoker: true }, hidden: {}, locale: 'en' })
    const missing = collectMissingRequired({
      schema,
      fieldIndex,
      sectionFieldKeys: ['smoker', 'cigarettes'],
      values: { smoker: true },
      visibleFieldKeys: shownState!.visibleFieldKeys,
    })
    expect(missing).toEqual(['cigarettes'])
  })

  it('falls back to role-only gating when no logic state is available', () => {
    const missing = collectMissingRequired({
      schema,
      fieldIndex,
      sectionFieldKeys: ['smoker', 'cigarettes'],
      values: { smoker: false },
      visibleFieldKeys: null,
    })
    expect(missing).toEqual(['cigarettes'])
  })

  it('skips info_block fields in required gating', () => {
    const infoSchema: RunnerSchema = {
      type: 'object',
      required: ['intro'],
      properties: { intro: { type: 'string', 'x-om-type': 'info_block' } },
    }
    const missing = collectMissingRequired({
      schema: infoSchema,
      fieldIndex: { intro: descriptor('intro', 'info_block') },
      sectionFieldKeys: ['intro'],
      values: {},
      visibleFieldKeys: null,
    })
    expect(missing).toEqual([])
  })
})

describe('public runner — variables convergence', () => {
  it('computes a derived variable available to the logic state', () => {
    const schema: RunnerSchema = {
      type: 'object',
      properties: {
        a: { type: 'number', 'x-om-type': 'number' },
        b: { type: 'number', 'x-om-type': 'number' },
      },
      'x-om-variables': [
        { name: 'total', type: 'number', formula: { '+': [{ var: 'a' }, { var: 'b' }] } },
      ],
    } as RunnerSchema
    const state = deriveLogicState({ schema, values: { a: 4, b: 7 }, hidden: {}, locale: 'en' })
    expect(state?.variables.total).toBe(11)
  })

  it('makes a computed variable usable in a visibility predicate', () => {
    const schema: RunnerSchema = {
      type: 'object',
      properties: {
        score: { type: 'number', 'x-om-type': 'number' },
        followup: {
          type: 'string',
          'x-om-type': 'text',
          'x-om-visibility-if': { '>=': [{ var: 'var.severity' }, 10] },
        },
      },
      'x-om-variables': [
        { name: 'severity', type: 'number', formula: { var: 'score' } },
      ],
    } as RunnerSchema
    const high = deriveLogicState({ schema, values: { score: 12 }, hidden: {}, locale: 'en' })
    expect(high?.visibleFieldKeys.has('followup')).toBe(true)
    const low = deriveLogicState({ schema, values: { score: 3 }, hidden: {}, locale: 'en' })
    expect(low?.visibleFieldKeys.has('followup')).toBe(false)
  })
})

describe('public runner — recall convergence', () => {
  it('resolves a recalled label and redacts sensitive recall to empty', () => {
    const schema: RunnerSchema = {
      type: 'object',
      properties: {
        name: { type: 'string', 'x-om-type': 'text' },
        ssn: { type: 'string', 'x-om-type': 'text', 'x-om-sensitive': true },
        greeting: { type: 'string', 'x-om-type': 'info_block' },
      },
    } as RunnerSchema
    const state = deriveLogicState({
      schema,
      values: { name: 'Pat', ssn: '123-45-6789' },
      hidden: {},
      locale: 'en',
    })
    expect(state?.resolveRecall('Welcome, @{name}!', 'en')).toBe('Welcome, Pat!')
    // Rule 13: sensitive-field recall resolves to empty string.
    expect(state?.resolveRecall('Your SSN is @{ssn}.', 'en')).toBe('Your SSN is .')
  })
})

describe('public runner — jumps convergence', () => {
  const schema: RunnerSchema = {
    type: 'object',
    properties: {
      age: { type: 'number', 'x-om-type': 'number' },
      adult_q: { type: 'string', 'x-om-type': 'text' },
      info: { type: 'string', 'x-om-type': 'info_block' },
    },
    'x-om-sections': [
      { key: 'page_1', kind: 'page', title: { en: 'P1' }, fieldKeys: ['age'] },
      { key: 'page_2', kind: 'page', title: { en: 'P2' }, fieldKeys: ['adult_q'] },
      { key: 'too_young', kind: 'ending', title: { en: 'Sorry' }, fieldKeys: ['info'] },
    ],
    'x-om-jumps': [
      {
        from: { type: 'page', pageKey: 'page_1' },
        rules: [{ if: { '<': [{ var: 'age' }, 18] }, goto: { type: 'ending', endingKey: 'too_young' } }],
        otherwise: { type: 'page', pageKey: 'page_2' },
      },
    ],
  } as RunnerSchema

  it('routes a minor to the ending and an adult to the next page', () => {
    const minor = deriveLogicState({ schema, values: { age: 14 }, hidden: {}, locale: 'en' })
    expect(minor?.nextTarget('page_1')).toEqual({ type: 'ending', endingKey: 'too_young' })

    const adult = deriveLogicState({ schema, values: { age: 30 }, hidden: {}, locale: 'en' })
    expect(adult?.nextTarget('page_1')).toEqual({ type: 'page', pageKey: 'page_2' })
  })

  it('returns next for a page without jump rules', () => {
    const state = deriveLogicState({ schema, values: { age: 30 }, hidden: {}, locale: 'en' })
    expect(state?.nextTarget('page_2')).toEqual({ type: 'next' })
  })
})
