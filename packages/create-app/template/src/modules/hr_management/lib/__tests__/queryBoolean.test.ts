/** @jest-environment node */
/**
 * Pins the query-boolean contract, whose failure mode is a filter that means the opposite.
 *
 * `z.coerce.boolean()` — the obvious choice — turns the string `'false'` into `true`, so
 * `?isActive=false` returned active rows and nothing reported it. The cases below are the tokens a
 * client sends; the last one is the one that must fail rather than guess.
 */
import { booleanQueryParam } from '../queryBoolean'

const schema = booleanQueryParam()

describe('booleanQueryParam', () => {
  it('reads the true tokens as true', () => {
    expect(schema.parse('true')).toBe(true)
    expect(schema.parse('1')).toBe(true)
    expect(schema.parse(true)).toBe(true)
  })

  it('reads the false tokens as false', () => {
    expect(schema.parse('false')).toBe(false)
    expect(schema.parse('0')).toBe(false)
    expect(schema.parse(false)).toBe(false)
  })

  it('stays undefined when the parameter is absent', () => {
    expect(schema.parse(undefined)).toBeUndefined()
  })

  it('rejects a value it cannot read rather than coercing it to true', () => {
    for (const value of ['yes', 'no', '', 2, {}]) {
      expect(schema.safeParse(value).success).toBe(false)
    }
  })
})
