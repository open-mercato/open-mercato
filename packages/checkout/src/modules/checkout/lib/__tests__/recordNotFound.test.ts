/**
 * @jest-environment node
 */

import { isRecordNotFoundError } from '../recordNotFound'

describe('isRecordNotFoundError', () => {
  it('detects a 404 status on the thrown error (raiseCrudError shape)', () => {
    const error = Object.assign(new Error('Template not found'), { status: 404 })
    expect(isRecordNotFoundError(error)).toBe(true)
  })

  it('detects a 404 status nested under body/response/data', () => {
    expect(isRecordNotFoundError({ body: { status: 404 } })).toBe(true)
    expect(isRecordNotFoundError({ response: { status: 404 } })).toBe(true)
    expect(isRecordNotFoundError({ data: { status: 404 } })).toBe(true)
  })

  it('returns false for optimistic-lock conflicts and other statuses', () => {
    expect(isRecordNotFoundError(Object.assign(new Error('conflict'), { status: 409 }))).toBe(false)
    expect(isRecordNotFoundError(Object.assign(new Error('boom'), { status: 500 }))).toBe(false)
  })

  it('returns false when no status is present or the value is not an object', () => {
    expect(isRecordNotFoundError(new Error('network down'))).toBe(false)
    expect(isRecordNotFoundError(null)).toBe(false)
    expect(isRecordNotFoundError('Not found')).toBe(false)
    expect(isRecordNotFoundError({ status: '404' })).toBe(false)
  })
})
