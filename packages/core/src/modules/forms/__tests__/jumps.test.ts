import {
  SchemaHelperError,
  setJumps,
  type FormSchema,
  type JumpRuleEntry,
} from '../backend/forms/[id]/studio/schema-helpers'
import { evaluateFormLogic } from '../services/form-logic-evaluator'

const baseSchema: FormSchema = {
  type: 'object',
  properties: {
    age: { type: 'number', 'x-om-type': 'number' } as never,
    info: { type: 'string', 'x-om-type': 'info_block' } as never,
  },
  'x-om-sections': [
    { key: 'page_1', kind: 'page', title: { en: 'P1' }, fieldKeys: ['age'] } as never,
    { key: 'page_2', kind: 'page', title: { en: 'P2' }, fieldKeys: [] } as never,
    { key: 'disclaimer', kind: 'ending', title: { en: 'Disclaimer' }, fieldKeys: ['info'] } as never,
  ],
}

describe('setJumps', () => {
  it('writes and clears x-om-jumps (R-9 minimalism)', () => {
    const rules: JumpRuleEntry[] = [
      {
        from: { type: 'page', pageKey: 'page_1' },
        rules: [
          { if: { '<': [{ var: 'age' }, 18] }, goto: { type: 'ending', endingKey: 'disclaimer' } },
        ],
        otherwise: { type: 'page', pageKey: 'page_2' },
      },
    ]
    const next = setJumps({ schema: baseSchema, rules })
    expect((next as Record<string, unknown>)['x-om-jumps']).toHaveLength(1)
    const cleared = setJumps({ schema: next, rules: [] })
    expect((cleared as Record<string, unknown>)['x-om-jumps']).toBeUndefined()
  })

  it('rejects dangling target references at save time', () => {
    expect(() =>
      setJumps({
        schema: baseSchema,
        rules: [
          {
            from: { type: 'page', pageKey: 'page_1' },
            rules: [{ if: true, goto: { type: 'page', pageKey: 'ghost' } }],
          },
        ],
      }),
    ).toThrow(SchemaHelperError)
  })

  it('rejects jump predicates outside the jsonlogic grammar', () => {
    expect(() =>
      setJumps({
        schema: baseSchema,
        rules: [
          {
            from: { type: 'page', pageKey: 'page_1' },
            rules: [{ if: { map: [[1, 2], { '+': [1, 1] }] }, goto: { type: 'next' } }],
          },
        ],
      }),
    ).toThrow()
  })

  it('round-trips through the evaluator — matching rule wins; otherwise fallback', () => {
    const schema = setJumps({
      schema: baseSchema,
      rules: [
        {
          from: { type: 'page', pageKey: 'page_1' },
          rules: [
            { if: { '<': [{ var: 'age' }, 18] }, goto: { type: 'ending', endingKey: 'disclaimer' } },
          ],
          otherwise: { type: 'page', pageKey: 'page_2' },
        },
      ],
    })
    const minor = evaluateFormLogic(schema, { answers: { age: 14 }, hidden: {}, locale: 'en' })
    expect(minor.nextTarget('page_1')).toEqual({ type: 'ending', endingKey: 'disclaimer' })
    const adult = evaluateFormLogic(schema, { answers: { age: 30 }, hidden: {}, locale: 'en' })
    expect(adult.nextTarget('page_1')).toEqual({ type: 'page', pageKey: 'page_2' })
  })
})
