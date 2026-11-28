import { z } from 'zod'
import { guardWriteBody, withIgnoredFieldsReport } from '../write-payload'

describe('write payload alias opt-out', () => {
  const schema = z.object({ id: z.string(), isDone: z.boolean().optional() })

  it.each([true, false])('reports an unused duplicate with aliasing off (snake value %s)', (snakeValue) => {
    const body = { id: 'x', isDone: true, is_done: snakeValue }
    const guarded = guardWriteBody(schema, body, { aliasSnakeCaseKeys: false })
    expect(schema.parse(guarded.body)).toEqual({ id: 'x', isDone: true })
    expect(guarded.body).toEqual(body)
    expect(guarded.aliased).toEqual([])
    expect(guarded.ignoredFields).toEqual([{ key: 'is_done', reason: 'misspelled' }])
    expect(withIgnoredFieldsReport({ ok: true }, guarded)).toEqual({
      ok: true,
      ignoredFields: [{ key: 'is_done', reason: 'misspelled' }],
    })
  })

  it.each([true, false])('strictly rejects an unused duplicate with aliasing off (snake value %s)', (snakeValue) => {
    expect(() => guardWriteBody(schema, { id: 'x', isDone: true, is_done: snakeValue }, {
      aliasSnakeCaseKeys: false,
      rejectUnknownFields: true,
    })).toThrow(expect.objectContaining({
      status: 400,
      body: { error: 'This field is not writable on this endpoint.', fields: ['is_done'] },
    }))
  })

  it.each([undefined, true])('retains conflicting duplicate rejection with default aliasing (%s)', (aliasSnakeCaseKeys) => {
    expect(() => guardWriteBody(schema, { id: 'x', isDone: true, is_done: false }, { aliasSnakeCaseKeys }))
      .toThrow(expect.objectContaining({ status: 400, body: expect.objectContaining({ fields: ['is_done'] }) }))
    const guarded = guardWriteBody(schema, { id: 'x', isDone: true, is_done: true }, { aliasSnakeCaseKeys })
    expect(schema.parse(guarded.body)).toEqual({ id: 'x', isDone: true })
    expect(guarded.ignoredFields).toEqual([])
  })

  it.each([undefined, true, false])('preserves explicitly declared snake properties (%s)', (aliasSnakeCaseKeys) => {
    const declared = z.object({ is_done: z.boolean(), isDone: z.boolean().optional() })
    const body = { is_done: false, isDone: true }
    const guarded = guardWriteBody(declared, body, { aliasSnakeCaseKeys, rejectUnknownFields: true })
    expect(declared.parse(guarded.body)).toEqual(body)
    expect(guarded.ignoredFields).toEqual([])
    expect(guarded.aliased).toEqual([])
    const snakeOnly = z.object({ is_done: z.boolean() })
    expect(snakeOnly.parse(guardWriteBody(snakeOnly, { is_done: false }, { aliasSnakeCaseKeys }).body))
      .toEqual({ is_done: false })
  })

  it.each([undefined, false])('still rejects immutable snake fields with aliasing %s', (aliasSnakeCaseKeys) => {
    expect(() => guardWriteBody(schema, { id: 'x', entity_id: 'other' }, {
      aliasSnakeCaseKeys,
      immutableFields: ['entityId'],
    })).toThrow(expect.objectContaining({
      status: 400,
      body: { error: 'This field cannot be changed after creation.', fields: ['entityId'] },
    }))
  })

  it('keeps nested data and unrelated unknown reporting unchanged with aliasing off', () => {
    const nested = z.object({ isDone: z.boolean(), extraData: z.object({ nested_key: z.string() }) })
    const guarded = guardWriteBody(nested, {
      isDone: true,
      is_done: false,
      extraData: { nested_key: 'kept' },
      unknown_key: 'reported',
    }, { aliasSnakeCaseKeys: false })
    expect(nested.parse(guarded.body)).toEqual({ isDone: true, extraData: { nested_key: 'kept' } })
    expect(guarded.ignoredFields).toEqual([
      { key: 'is_done', reason: 'misspelled' },
      { key: 'unknown_key', reason: 'unknown' },
    ])
  })
})
