import { parseModelAnswerText, readStructuredOutputFailure } from '../lib/runtime/structuredOutputFailure'

function named(name: string, fields: Record<string, unknown> = {}): Error {
  const error = new Error(name)
  error.name = name
  return Object.assign(error, fields)
}

describe('readStructuredOutputFailure', () => {
  it('recovers the answer text of a no-object failure, with its usage', () => {
    expect(
      readStructuredOutputFailure(
        named('AI_NoObjectGeneratedError', { text: '{"kind":"research","data":{}}', usage: { inputTokens: 3, outputTokens: 1 } }),
      ),
    ).toEqual({ reason: 'no_object', recovered: { kind: 'research', data: {} }, usage: { inputTokens: 3, outputTokens: 1 } })
  })

  it('reports a tool loop that ended without an answer, with nothing recovered', () => {
    expect(readStructuredOutputFailure(named('AI_NoOutputGeneratedError'))).toEqual({
      reason: 'no_output',
      recovered: undefined,
      usage: null,
    })
  })

  it('finds the failure one level down the cause chain', () => {
    const wrapped = named('Error', { cause: named('AI_NoObjectGeneratedError', { text: 'not json' }) })
    expect(readStructuredOutputFailure(wrapped)).toMatchObject({ reason: 'no_object', recovered: undefined })
  })

  it('ignores every other error', () => {
    expect(readStructuredOutputFailure(named('AI_APICallError'))).toBeNull()
    expect(readStructuredOutputFailure(new TypeError('boom'))).toBeNull()
    expect(readStructuredOutputFailure('boom')).toBeNull()
  })
})

describe('parseModelAnswerText', () => {
  it('parses plain and fenced JSON and gives up on prose', () => {
    expect(parseModelAnswerText(' {"a":1} ')).toEqual({ a: 1 })
    expect(parseModelAnswerText('Here it is:\n```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(parseModelAnswerText('I could not decide.')).toBeUndefined()
    expect(parseModelAnswerText(undefined)).toBeUndefined()
  })
})
