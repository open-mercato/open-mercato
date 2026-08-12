/**
 * Reading the answer out of a provider payload at a tenant-configured path, and
 * failing cleanly when it is not there.
 *
 * The failure arms matter as much as the happy one: a `normalize` that throws is
 * classified by the callback route as a CONNECTOR FAILURE, which settles the run
 * and wakes the parked step down its `error` handle immediately. A `normalize`
 * that guessed would instead resume a workflow with something nobody promised.
 */

import { readJsonPath } from '../lib/jsonPath'
import { GenericHttpNormalizeError, normalizeGenericHttpCallback } from '../lib/normalize'
import { httpAgentResultSchema } from '../data/validators'

describe('json path', () => {
  const payload = {
    result: { answer: 'ship it', nested: { deep: 'value' } },
    items: [{ text: 'first' }, { text: 'second' }],
    falsy: { zero: 0, blank: '', off: false, nothing: null },
  }

  it.each([
    ['result.answer', 'ship it'],
    ['result.nested.deep', 'value'],
    ['items.1.text', 'second'],
    ['falsy.zero', 0],
    ['falsy.off', false],
    ['falsy.nothing', null],
  ])('resolves %s', (path, expected) => {
    expect(readJsonPath(payload, path)).toEqual(expected)
  })

  it.each([
    ['a missing key', 'result.missing'],
    ['a key under a scalar', 'result.answer.deeper'],
    ['a named index into an array', 'items.first.text'],
    ['an index past the end', 'items.9.text'],
    ['a path into nothing', 'nope.at.all'],
  ])('returns undefined for %s', (_label, path) => {
    expect(readJsonPath(payload, path)).toBeUndefined()
  })

  it('never walks the prototype chain', () => {
    // `toString` exists on every object; a path reader that used plain property
    // access would return a function here.
    expect(readJsonPath(payload, 'toString')).toBeUndefined()
    expect(readJsonPath(payload, '__proto__')).toBeUndefined()
  })
})

describe('normalize', () => {
  it('extracts the answer at the configured path and wraps it in the researcher envelope', () => {
    const result = normalizeGenericHttpCallback(
      { status: 'done', result: { answer: 'the renewal is at risk' } },
      'result.answer',
    )
    expect(result).toEqual({ kind: 'researcher', data: { answer: 'the renewal is at risk' } })
    // The envelope is what `defineExternalAgent` declared and what
    // `completeExternalRun` validates the payload against, so the two must agree.
    expect(httpAgentResultSchema.safeParse(result).success).toBe(true)
  })

  it('reads a DIFFERENT tenant path out of the same payload', () => {
    // The whole point of the connector: two tenants, two providers, one code path.
    const payload = { data: [{ output: { text: 'from the other provider' } }] }
    expect(normalizeGenericHttpCallback(payload, 'data.0.output.text')).toEqual({
      kind: 'researcher',
      data: { answer: 'from the other provider' },
    })
  })

  it('stringifies a scalar, because a provider answering 42 has answered', () => {
    expect(normalizeGenericHttpCallback({ score: 42 }, 'score')).toEqual({
      kind: 'researcher',
      data: { answer: '42' },
    })
    expect(normalizeGenericHttpCallback({ reached: false }, 'reached')).toEqual({
      kind: 'researcher',
      data: { answer: 'false' },
    })
  })

  it.each([
    ['nothing at the path', { result: {} }, 'result.answer'],
    ['null at the path', { result: { answer: null } }, 'result.answer'],
    ['an empty string at the path', { result: { answer: '   ' } }, 'result.answer'],
    ['an object at the path', { result: { answer: { text: 'hi' } } }, 'result.answer'],
    ['an array at the path', { result: { answer: ['hi'] } }, 'result.answer'],
    ['a payload of another shape entirely', { totally: 'different' }, 'result.answer'],
  ])('fails cleanly on %s', (_label, payload, path) => {
    expect(() => normalizeGenericHttpCallback(payload, path)).toThrow(GenericHttpNormalizeError)
    expect(() => normalizeGenericHttpCallback(payload, path)).toThrow(new RegExp(path.replace('.', '\\.')))
  })

  it('never interpolates the payload into a refusal — only the path and the type', () => {
    const secretish = 'jane.doe@example.com said no'
    try {
      normalizeGenericHttpCallback({ result: { answer: { transcript: secretish } } }, 'result.answer')
      throw new Error('expected a refusal')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('an object')
      expect(message).toContain('result.answer')
      expect(message).not.toContain(secretish)
    }
  })
})
